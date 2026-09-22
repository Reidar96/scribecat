import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "scribecat_session";

/** A token older than this gets re-issued on the next request (sliding expiration). */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export type SessionPayload = {
  /** Issued at, unix ms. */
  iat: number;
  /** Expires at, unix ms. */
  exp: number;
  /** Must match the auth store's current epoch, see authStore.ts. */
  epoch: number;
};

export type SessionConfig = {
  secret: Buffer;
  maxAgeMs: number;
  /** Cookie Path attribute: the base path, or "/" when the app runs at the root. */
  cookiePath: string;
  secure: boolean;
};

/**
 * Stateless, HMAC-signed session tokens. No server-side session store means a
 * container restart or an image update does not log anyone out, which is what
 * "stay logged in" has to mean on a box that gets redeployed. Revocation is by
 * epoch (password change) or expiry; both are checked in verifySessionToken.
 */

function sign(secret: Buffer, payloadPart: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

export function createSessionToken(config: SessionConfig, epoch: number, now = Date.now()): string {
  const payload: SessionPayload = { iat: now, exp: now + config.maxAgeMs, epoch };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${payloadPart}.${sign(config.secret, payloadPart)}`;
}

export type VerifiedSession = {
  payload: SessionPayload;
  /** True when the token is old enough that the caller should issue a fresh one. */
  shouldRefresh: boolean;
};

export function verifySessionToken(
  config: SessionConfig,
  token: string | undefined,
  currentEpoch: number,
  now = Date.now()
): VerifiedSession | null {
  if (!token || typeof token !== "string") {
    return null;
  }

  const separator = token.indexOf(".");

  if (separator <= 0 || separator === token.length - 1) {
    return null;
  }

  const payloadPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);
  const expected = Buffer.from(sign(config.secret, payloadPart), "utf8");
  const actual = Buffer.from(signaturePart, "utf8");

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!isSessionPayload(payload)) {
    return null;
  }

  if (payload.epoch !== currentEpoch) {
    return null;
  }

  if (payload.exp <= now || payload.iat > now + 60_000) {
    return null;
  }

  return { payload, shouldRefresh: now - payload.iat >= REFRESH_AFTER_MS };
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number" &&
    typeof candidate.epoch === "number" &&
    Number.isFinite(candidate.iat) &&
    Number.isFinite(candidate.exp) &&
    Number.isInteger(candidate.epoch)
  );
}

export type CookieOptions = {
  path: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge?: number;
};

export function sessionCookieOptions(config: SessionConfig): CookieOptions {
  return {
    path: config.cookiePath,
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    maxAge: Math.floor(config.maxAgeMs / 1000)
  };
}

/** Same attributes minus maxAge, so the browser matches and drops the cookie. */
export function clearedSessionCookieOptions(config: SessionConfig): CookieOptions {
  return {
    path: config.cookiePath,
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax"
  };
}
