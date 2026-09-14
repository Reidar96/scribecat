import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { SERVER_META_DIR } from "./authStore.js";

/**
 * Personal access tokens: how a client without a browser (the desktop app
 * opening a server vault) proves who it is.
 *
 * A token is issued once against the password and then travels as a Bearer
 * header. The server keeps only a SHA-256 of the secret part: the secret has
 * 256 bits of entropy, so a fast hash is as good as a slow one here, and the
 * file on disk never yields a usable token. What the file does hold is the
 * device name and the usage times, which is what the "signed-in devices" list
 * shows.
 *
 * Tokens do not expire. They end when they are revoked one by one (a lost
 * laptop) or when the password changes: every token carries the session epoch
 * it was issued under, the same counter the session cookies use, so a
 * password change retires cookies and tokens together with no second
 * mechanism. Records from an older epoch are dropped whenever the store
 * notices them, they are dead weight in the device list.
 */

const TOKENS_FILE_NAME = "tokens.json";
export const TOKEN_PREFIX = "sdt_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
export const MAX_TOKEN_NAME_LENGTH = 80;

/** How often "last used" is written back; a write per request would be a disk write per keystroke. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

type TokenRecord = {
  id: string;
  name: string;
  /** Hex SHA-256 of the secret part of the token. */
  secretHash: string;
  epoch: number;
  createdAt: string;
  lastUsedAt: string | null;
};

type TokensFile = {
  version: 1;
  tokens: TokenRecord[];
};

/** What the API hands out about a token: everything but the token. */
export type TokenInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type IssuedToken = TokenInfo & {
  /** The full token, shown exactly once. */
  token: string;
};

export type TokenStore = {
  issue(name: string, epoch: number, now?: Date): Promise<IssuedToken>;
  /**
   * The record a presented token stands for, or null. Records the use as a
   * side effect (throttled, see above); the caller is the request guard.
   */
  verify(token: string | undefined, currentEpoch: number, now?: Date): TokenInfo | null;
  list(currentEpoch: number): TokenInfo[];
  /** True when a token with that id existed. */
  revoke(id: string): Promise<boolean>;
  /**
   * Drops every token from an epoch other than the current one and reports
   * each as revoked. Called after a password change so open connections that
   * were authenticated with a now-dead token get closed too.
   */
  dropOutdated(currentEpoch: number): Promise<void>;
  /** Fires with the id of every token that stops being valid. */
  onRevoked(handler: (id: string) => void): () => void;
};

export class TokenStoreError extends Error {}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function isTokenRecord(value: unknown): value is TokenRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.secretHash === "string" &&
    typeof candidate.epoch === "number" &&
    Number.isInteger(candidate.epoch) &&
    typeof candidate.createdAt === "string" &&
    (candidate.lastUsedAt === null || typeof candidate.lastUsedAt === "string")
  );
}

function parseTokensFile(raw: string, filePath: string): TokenRecord[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TokenStoreError(`${filePath} is not readable. Fix or delete the file; deleting it revokes every access token.`);
  }

  const candidate = parsed as { version?: unknown; tokens?: unknown } | null;

  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.tokens) || !candidate.tokens.every(isTokenRecord)) {
    throw new TokenStoreError(`${filePath} is not a valid token file.`);
  }

  return candidate.tokens;
}

/**
 * Whether a string is one of our tokens by shape. The guard uses this to tell
 * an access token from an Authorization header meant for someone else: the
 * LLM proxy, for one, carries the browser's provider header through.
 */
export function isAccessToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

/** `sdt_<id>_<secret>`; null for anything that does not have that shape. */
function parseToken(token: string): { id: string; secret: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const rest = token.slice(TOKEN_PREFIX.length);
  const separator = rest.indexOf("_");

  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }

  return { id: rest.slice(0, separator), secret: rest.slice(separator + 1) };
}

function toInfo(record: TokenRecord): TokenInfo {
  return { id: record.id, name: record.name, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt };
}

export function assertTokenName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TokenStoreError("The device name must not be empty.");
  }

  if (name.length > MAX_TOKEN_NAME_LENGTH) {
    throw new TokenStoreError(`The device name may be at most ${MAX_TOKEN_NAME_LENGTH} characters long.`);
  }
}

export type OpenTokenStoreOptions = {
  vaultPath: string;
  log: { warn(message: string): void };
};

export async function openTokenStore(options: OpenTokenStoreOptions): Promise<TokenStore> {
  const metaDir = path.join(options.vaultPath, SERVER_META_DIR);
  await mkdir(metaDir, { recursive: true, mode: 0o700 });

  const filePath = path.join(metaDir, TOKENS_FILE_NAME);
  let records: TokenRecord[] = [];

  try {
    records = parseTokensFile(await readFile(filePath, "utf8"), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const revokedHandlers = new Set<(id: string) => void>();
  const lastWrittenUse = new Map<string, number>();

  // Writes are serialized: a revoke and a throttled "last used" update can
  // land in the same tick, and the file must always hold the newest list.
  let pendingWrite: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const snapshot: TokensFile = { version: 1, tokens: records };
    const content = `${JSON.stringify(snapshot, null, 2)}\n`;

    pendingWrite = pendingWrite.then(() => writeFileAtomically(filePath, content));

    return pendingWrite;
  }

  function emitRevoked(id: string): void {
    for (const handler of revokedHandlers) {
      try {
        handler(id);
      } catch {
        // A broken subscriber must not keep the others from closing their sockets.
      }
    }
  }

  return {
    async issue(name, epoch, now = new Date()) {
      assertTokenName(name);

      const id = randomBytes(ID_BYTES).toString("hex");
      const secret = randomBytes(SECRET_BYTES).toString("base64url");
      const record: TokenRecord = {
        id,
        name: name.trim(),
        secretHash: hashSecret(secret),
        epoch,
        createdAt: now.toISOString(),
        lastUsedAt: null
      };

      records = [...records, record];
      await persist();

      return { ...toInfo(record), token: `${TOKEN_PREFIX}${id}_${secret}` };
    },

    verify(token, currentEpoch, now = new Date()) {
      if (typeof token !== "string") {
        return null;
      }

      const parsed = parseToken(token);

      if (!parsed) {
        return null;
      }

      const record = records.find((entry) => entry.id === parsed.id);

      if (!record || record.epoch !== currentEpoch) {
        return null;
      }

      const expected = Buffer.from(record.secretHash, "hex");
      const actual = Buffer.from(hashSecret(parsed.secret), "hex");

      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return null;
      }

      const nowMs = now.getTime();

      if (nowMs - (lastWrittenUse.get(record.id) ?? 0) >= LAST_USED_WRITE_INTERVAL_MS) {
        lastWrittenUse.set(record.id, nowMs);
        record.lastUsedAt = now.toISOString();
        persist().catch((error: unknown) => {
          options.log.warn(`Could not record token use: ${(error as Error).message}`);
        });
      }

      return toInfo(record);
    },

    list(currentEpoch) {
      return records.filter((record) => record.epoch === currentEpoch).map(toInfo);
    },

    async revoke(id) {
      const remaining = records.filter((record) => record.id !== id);

      if (remaining.length === records.length) {
        return false;
      }

      records = remaining;
      await persist();
      emitRevoked(id);

      return true;
    },

    async dropOutdated(currentEpoch) {
      const outdated = records.filter((record) => record.epoch !== currentEpoch);

      if (outdated.length === 0) {
        return;
      }

      records = records.filter((record) => record.epoch === currentEpoch);
      await persist();

      for (const record of outdated) {
        emitRevoked(record.id);
      }
    },

    onRevoked(handler) {
      revokedHandlers.add(handler);

      return () => {
        revokedHandlers.delete(handler);
      };
    }
  };
}
