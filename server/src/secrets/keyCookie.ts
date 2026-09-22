import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import type { SessionConfig } from "../auth/session.js";
import { clearedSessionCookieOptions, sessionCookieOptions, type CookieOptions } from "../auth/session.js";

/**
 * The second cookie, carrying the data key that unlocks the stored API keys
 * (see secretStore.ts).
 *
 * Why a cookie and not server memory: the key is derived from the login
 * password, which the server only ever sees during a login. Keeping it in the
 * process would mean losing it on every restart, and sessions deliberately
 * survive restarts, so nobody would ever log in again to hand it back. Keeping
 * it in the volume would defeat the point of encrypting anything.
 *
 * The cookie is encrypted with a key derived from the session secret, and the
 * session epoch travels as associated data, so a cookie from before a password
 * change stops working exactly when the matching session token does. What a
 * stolen disk yields is therefore still only ciphertext: the session secret is
 * on it, but the cookie is in the browser.
 */

export const KEY_COOKIE_NAME = "scribecat_keys";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEK_LENGTH = 32;

function cookieKey(sessionSecret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret, Buffer.alloc(0), "scribecat-key-cookie", 32));
}

export function createKeyCookie(config: SessionConfig, dataKey: Buffer, epoch: number): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(config.secret), iv);

  cipher.setAAD(Buffer.from(String(epoch), "utf8"));

  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);

  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

export function readKeyCookie(config: SessionConfig, value: string | undefined, epoch: number): Buffer | null {
  if (!value) {
    return null;
  }

  const raw = Buffer.from(value, "base64url");

  if (raw.length !== IV_LENGTH + DEK_LENGTH + TAG_LENGTH) {
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(config.secret), raw.subarray(0, IV_LENGTH));

    decipher.setAAD(Buffer.from(String(epoch), "utf8"));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_LENGTH));

    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    return null;
  }
}

/** Same attributes as the session cookie, so the two always travel together. */
export function keyCookieOptions(config: SessionConfig): CookieOptions {
  return sessionCookieOptions(config);
}

export function clearedKeyCookieOptions(config: SessionConfig): CookieOptions {
  return clearedSessionCookieOptions(config);
}
