import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

// promisify() loses the options overload of scrypt, hence the hand-rolled wrapper.
function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

// scrypt from node:crypto rather than argon2: no native module to compile or
// prebuild for every architecture the image may run on (x64 and arm64 for a
// Raspberry Pi), and for a single-secret login behind rate limiting it is an
// accepted choice. The parameters follow the OWASP password storage cheat
// sheet (N=2^16, r=8, p=2, ~64 MiB), comfortably within a small box's RAM.
const SCRYPT_LOG_N = 16;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 128 * (1 << SCRYPT_LOG_N) * SCRYPT_R * 2;

/** Password rules are deliberately minimal; the length floor only stops the obvious. */
export const MIN_PASSWORD_LENGTH = 8;
/** Upper bound so a multi-megabyte body cannot turn scrypt into a DoS lever. */
export const MAX_PASSWORD_LENGTH = 1024;

export class PasswordPolicyError extends Error {}

export function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new PasswordPolicyError("Password must be a string.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`);
  }
}

async function deriveKey(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: 1 << logN,
    r,
    p,
    maxmem: MAX_MEMORY
  });
}

/**
 * Produces a PHC-style string ("$scrypt$ln=16,r=8,p=2$<salt>$<hash>"). The
 * algorithm and parameters travel with the hash, so a future switch to other
 * parameters or to argon2id can verify old hashes and re-hash on next login.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P);

  return `$scrypt$ln=${SCRYPT_LOG_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const PHC_PATTERN = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

/** Constant-time comparison; a malformed stored hash simply never verifies. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(storedHash);

  if (!match) {
    return false;
  }

  const [, logN, r, p, saltB64, hashB64] = match;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  if (expected.length !== KEY_LENGTH) {
    return false;
  }

  let actual: Buffer;

  try {
    actual = await deriveKey(password, salt, Number(logN), Number(r), Number(p));
  } catch {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
