import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { SERVER_META_DIR } from "../auth/authStore.js";

/**
 * Encrypted storage for the API keys of the cloud AI providers.
 *
 * The desktop app puts these in the OS credential store; a Linux container has
 * none, so they live in the data volume instead, encrypted. The threat model
 * is the one from the plan: someone reads the folder without the server
 * running (a copied SD card, a backup, a stray `cp`). Notes stay readable on
 * purpose (Markdown portability), API keys do not.
 *
 * Two layers, which is what makes a password change cheap:
 *
 * - a random data key (DEK) encrypts every entry;
 * - the login password, stretched with scrypt, encrypts the data key.
 *
 * Changing the password therefore re-encrypts 32 bytes, not every secret, and
 * the entries are untouched. Resetting the password (deleting auth.json, the
 * documented way back in) cannot recover the data key: the entries are then
 * unreadable and get discarded on the next login, which the UI reports.
 *
 * The data key itself never rests on disk unencrypted and the server does not
 * hold it in memory between requests: it is handed to the browser in a second
 * httpOnly cookie at login (see keyCookie.ts) and comes back with each request
 * that needs it. So a stolen disk has the ciphertext and no key, and a
 * restarted container does not lock anyone out.
 */

const SECRETS_FILE_NAME = "secrets.json";

const KDF_LOG_N = 16;
const KDF_R = 8;
const KDF_P = 1;
const SALT_LENGTH = 16;
const DEK_LENGTH = 32;
const IV_LENGTH = 12;
const KEY_ID_LENGTH = 16;
const MAX_MEMORY = 128 * (1 << KDF_LOG_N) * KDF_R * 2;

/** A key is a provider id ("openai") or a namespaced one ("rag:mistral"). */
const SECRET_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
/** Long enough for any provider key, short enough that the file stays small. */
export const MAX_SECRET_LENGTH = 8 * 1024;

export class SecretStoreError extends Error {}

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, length, { ...options, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

type SealedValue = { iv: string; ciphertext: string; tag: string };

type SecretsFile = {
  version: 1;
  kdf: { algorithm: "scrypt"; ln: number; r: number; p: number; salt: string };
  /** The data key, encrypted with the key derived from the password. */
  wrappedKey: SealedValue;
  /** Checksum of the data key, so a stale key from before a reset is spotted. */
  keyId: string;
  entries: Record<string, SealedValue>;
  /**
   * Set when entries had to be thrown away because the password had been
   * reset. Cleared as soon as a new secret is stored; the UI shows it once so
   * the keys do not just silently vanish.
   */
  discardedAt?: string;
  updatedAt: string;
};

function seal(dataKey: Buffer, plaintext: string): SealedValue {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

function open(dataKey: Buffer, value: SealedValue): string {
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function keyIdOf(dataKey: Buffer): string {
  return createHash("sha256").update(dataKey).digest().subarray(0, KEY_ID_LENGTH).toString("base64");
}

function isSealedValue(value: unknown): value is SealedValue {
  const candidate = value as Record<string, unknown> | null;

  return (
    !!candidate &&
    typeof candidate === "object" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string" &&
    typeof candidate.tag === "string"
  );
}

function isSecretsFile(value: unknown): value is SecretsFile {
  const candidate = value as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== "object" || candidate.version !== 1) {
    return false;
  }

  const kdf = candidate.kdf as Record<string, unknown> | undefined;

  return (
    !!kdf &&
    typeof kdf.salt === "string" &&
    typeof kdf.ln === "number" &&
    typeof kdf.r === "number" &&
    typeof kdf.p === "number" &&
    isSealedValue(candidate.wrappedKey) &&
    typeof candidate.keyId === "string" &&
    !!candidate.entries &&
    typeof candidate.entries === "object"
  );
}

export function assertSecretId(rawId: unknown): string {
  if (typeof rawId !== "string" || !SECRET_ID_PATTERN.test(rawId)) {
    throw new SecretStoreError("Not a usable key name.");
  }

  return rawId;
}

export type UnlockResult = {
  /** The data key, to be handed to the client in the key cookie. */
  dataKey: Buffer;
  /** True when unreadable entries were thrown away during this unlock. */
  discarded: boolean;
};

export type SecretStatus = {
  state: "ready" | "locked";
  /** Ids that currently hold a value, in file order. */
  ids: string[];
  /** Set once after entries were lost to a password reset. */
  discardedAt: string | null;
};

export type SecretStore = {
  /**
   * Called with the password at login: returns the data key, creating the
   * store on first use and starting over (with `discarded`) when the wrapped
   * key cannot be opened, which is what a password reset looks like from here.
   */
  unlock(password: string): Promise<UnlockResult>;
  /** Password change: same data key, wrapped under the new password. */
  rewrap(currentPassword: string, newPassword: string): Promise<void>;
  status(dataKey: Buffer | null): Promise<SecretStatus>;
  get(dataKey: Buffer, id: string): Promise<string | null>;
  set(dataKey: Buffer, id: string, value: string): Promise<void>;
  remove(dataKey: Buffer, id: string): Promise<void>;
};

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

export function openSecretStore(vaultPath: string): SecretStore {
  const metaDir = path.join(vaultPath, SERVER_META_DIR);
  const filePath = path.join(metaDir, SECRETS_FILE_NAME);

  async function read(): Promise<SecretsFile | null> {
    let raw: string;

    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SecretStoreError(`${filePath} is not readable JSON. Delete it to start over (the stored keys are lost).`);
    }

    if (!isSecretsFile(parsed)) {
      throw new SecretStoreError(`${filePath} is not a valid secrets file. Delete it to start over (the stored keys are lost).`);
    }

    return parsed;
  }

  async function write(file: SecretsFile): Promise<void> {
    await mkdir(metaDir, { recursive: true, mode: 0o700 });
    await writeFileAtomically(filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  async function wrap(password: string, dataKey: Buffer, entries: Record<string, SealedValue>, discardedAt?: string): Promise<SecretsFile> {
    const salt = randomBytes(SALT_LENGTH);
    const wrappingKey = await scrypt(password, salt, DEK_LENGTH, { N: 1 << KDF_LOG_N, r: KDF_R, p: KDF_P });

    return {
      version: 1,
      kdf: { algorithm: "scrypt", ln: KDF_LOG_N, r: KDF_R, p: KDF_P, salt: salt.toString("base64") },
      wrappedKey: seal(wrappingKey, dataKey.toString("base64")),
      keyId: keyIdOf(dataKey),
      entries,
      ...(discardedAt ? { discardedAt } : {}),
      updatedAt: new Date().toISOString()
    };
  }

  async function unwrap(file: SecretsFile, password: string): Promise<Buffer | null> {
    const salt = Buffer.from(file.kdf.salt, "base64");
    const wrappingKey = await scrypt(password, salt, DEK_LENGTH, { N: 1 << file.kdf.ln, r: file.kdf.r, p: file.kdf.p });

    try {
      const dataKey = Buffer.from(open(wrappingKey, file.wrappedKey), "base64");

      return dataKey.length === DEK_LENGTH ? dataKey : null;
    } catch {
      return null;
    }
  }

  /** The data key the caller presents has to be the one this file was sealed with. */
  async function requireCurrent(dataKey: Buffer): Promise<SecretsFile> {
    const file = await read();

    if (!file) {
      throw new SecretStoreError("No keys have been stored for this vault yet.");
    }

    const expected = Buffer.from(file.keyId, "base64");
    const actual = Buffer.from(keyIdOf(dataKey), "base64");

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new SecretStoreError("The stored keys belong to another password. Sign in again.");
    }

    return file;
  }

  return {
    async unlock(password) {
      const file = await read();

      if (!file) {
        const dataKey = randomBytes(DEK_LENGTH);
        await write(await wrap(password, dataKey, {}));

        return { dataKey, discarded: false };
      }

      const dataKey = await unwrap(file, password);

      if (dataKey) {
        return { dataKey, discarded: false };
      }

      // The password verified against auth.json but does not open the wrapped
      // key: auth.json was replaced (the documented password reset). The
      // entries are unrecoverable, so start a fresh store and remember that
      // there was something here.
      const replacement = randomBytes(DEK_LENGTH);
      await write(await wrap(password, replacement, {}, new Date().toISOString()));

      return { dataKey: replacement, discarded: Object.keys(file.entries).length > 0 };
    },

    async rewrap(currentPassword, newPassword) {
      const file = await read();

      if (!file) {
        return;
      }

      const dataKey = await unwrap(file, currentPassword);

      if (!dataKey) {
        // Nothing sensible to carry over; leave the file alone so the next
        // login discards it with a message instead of failing the password
        // change the user asked for.
        return;
      }

      await write(await wrap(newPassword, dataKey, file.entries, file.discardedAt));
    },

    async status(dataKey) {
      const file = await read();

      if (!file) {
        return { state: dataKey ? "ready" : "locked", ids: [], discardedAt: null };
      }

      if (!dataKey || keyIdOf(dataKey) !== file.keyId) {
        return { state: "locked", ids: [], discardedAt: file.discardedAt ?? null };
      }

      return { state: "ready", ids: Object.keys(file.entries), discardedAt: file.discardedAt ?? null };
    },

    async get(dataKey, id) {
      const file = await requireCurrent(dataKey);
      const entry = file.entries[assertSecretId(id)];

      if (!entry) {
        return null;
      }

      try {
        return open(dataKey, entry);
      } catch {
        throw new SecretStoreError("The stored key could not be decrypted.");
      }
    },

    async set(dataKey, id, value) {
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
        throw new SecretStoreError("The key is empty or too long.");
      }

      const file = await requireCurrent(dataKey);

      await write({
        ...file,
        entries: { ...file.entries, [assertSecretId(id)]: seal(dataKey, value) },
        discardedAt: undefined,
        updatedAt: new Date().toISOString()
      });
    },

    async remove(dataKey, id) {
      const file = await requireCurrent(dataKey);
      const entries = { ...file.entries };

      delete entries[assertSecretId(id)];

      await write({ ...file, entries, updatedAt: new Date().toISOString() });
    }
  };
}
