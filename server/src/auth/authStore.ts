import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password.js";

/**
 * Where the server keeps its own state inside the vault. `.scribecat/` is the
 * same metadata directory the desktop app uses for versions and checkpoints
 * (and skips when listing notes); `server/` underneath keeps the two apart.
 */
export const SERVER_META_DIR = path.join(".scribecat", "server");
const AUTH_FILE_NAME = "auth.json";
const SESSION_SECRET_FILE_NAME = "session-secret";
const SESSION_SECRET_BYTES = 32;

type AuthFile = {
  version: 1;
  passwordHash: string;
  /**
   * Every session token carries the epoch it was issued under. Changing the
   * password bumps this counter, which invalidates every existing session at
   * once without a server-side session store.
   */
  sessionEpoch: number;
  updatedAt: string;
};

export class AuthSetupError extends Error {}

async function writeFileAtomically(filePath: string, content: string | Buffer): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function isAuthFile(value: unknown): value is AuthFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.version === 1 &&
    typeof candidate.passwordHash === "string" &&
    candidate.passwordHash.length > 0 &&
    typeof candidate.sessionEpoch === "number" &&
    Number.isInteger(candidate.sessionEpoch)
  );
}

export type AuthStore = {
  /** Secret behind the HMAC on session tokens; generated once per vault. */
  readonly sessionSecret: Buffer;
  /**
   * Read on every request through the guard, so it has to be a live value:
   * changing the password bumps it and every token issued under the old epoch
   * stops verifying.
   */
  readonly sessionEpoch: number;
  verifyPassword(password: string): Promise<boolean>;
  /**
   * Replaces the password and bumps the session epoch. The caller has already
   * verified the current password (and re-wrapped the stored API keys, see
   * secrets/secretStore.ts) by the time this runs.
   */
  changePassword(newPassword: string): Promise<void>;
};

export type OpenAuthStoreOptions = {
  vaultPath: string;
  initPassword: string | null;
  log: { info(message: string): void; warn(message: string): void };
};

/**
 * Loads (or on first start creates) the password hash and the session secret.
 *
 * The init password only ever creates a hash that does not exist yet. If a
 * hash is already there the variable is ignored and we say so in the log, so
 * that a compose file that still carries the variable cannot silently reset
 * the password on every redeploy.
 */
export async function openAuthStore(options: OpenAuthStoreOptions): Promise<AuthStore> {
  const metaDir = path.join(options.vaultPath, SERVER_META_DIR);
  await mkdir(metaDir, { recursive: true, mode: 0o700 });

  const authFilePath = path.join(metaDir, AUTH_FILE_NAME);
  const secretFilePath = path.join(metaDir, SESSION_SECRET_FILE_NAME);

  let sessionSecret: Buffer;

  try {
    sessionSecret = Buffer.from((await readFile(secretFilePath, "utf8")).trim(), "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    sessionSecret = randomBytes(SESSION_SECRET_BYTES);
    await writeFileAtomically(secretFilePath, sessionSecret.toString("hex"));
    options.log.info("Generated a new session secret.");
  }

  if (sessionSecret.length < 16) {
    throw new AuthSetupError(`${secretFilePath} is not a valid session secret. Delete the file to have a new one generated.`);
  }

  const existing = await readJsonIfExists(authFilePath);
  let authFile: AuthFile;

  if (existing !== null) {
    if (!isAuthFile(existing)) {
      throw new AuthSetupError(`${authFilePath} is not a valid auth file.`);
    }

    authFile = existing;

    if (options.initPassword !== null) {
      options.log.warn(
        "SCRIBECAT_INIT_PASSWORD is set but ignored because a password already exists. You can remove the variable from your compose file."
      );
    }
  } else {
    if (options.initPassword === null) {
      throw new AuthSetupError(
        "No password has been set for this vault yet. Set SCRIBECAT_INIT_PASSWORD for the first start (it is only used until a password exists)."
      );
    }

    try {
      assertPasswordPolicy(options.initPassword);
    } catch (error) {
      throw new AuthSetupError(`SCRIBECAT_INIT_PASSWORD rejected: ${(error as Error).message}`);
    }

    authFile = {
      version: 1,
      passwordHash: await hashPassword(options.initPassword),
      sessionEpoch: 1,
      updatedAt: new Date().toISOString()
    };
    await writeFileAtomically(authFilePath, `${JSON.stringify(authFile, null, 2)}\n`);
    options.log.info("Initial password stored from SCRIBECAT_INIT_PASSWORD. The variable can now be removed.");
  }

  let current = authFile;

  return {
    sessionSecret,
    get sessionEpoch() {
      return current.sessionEpoch;
    },
    verifyPassword: (password) => verifyPassword(password, current.passwordHash),
    async changePassword(newPassword: string) {
      assertPasswordPolicy(newPassword);

      const next: AuthFile = {
        version: 1,
        passwordHash: await hashPassword(newPassword),
        sessionEpoch: current.sessionEpoch + 1,
        updatedAt: new Date().toISOString()
      };

      await writeFileAtomically(authFilePath, `${JSON.stringify(next, null, 2)}\n`);
      current = next;
    }
  };
}
