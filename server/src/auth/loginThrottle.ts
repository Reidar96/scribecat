/**
 * Brute-force protection for the login.
 *
 * A ScribeCat instance has one password and no user name, so an attacker only
 * has to guess a single secret; a fixed "5 tries per minute" would still allow
 * a steady grind. The lock therefore escalates per address: the first series
 * of failures costs `lockSeconds`, the next one five times as long, up to
 * `maxLockSeconds` (with the documented defaults: 1 minute, then 5, then 15).
 * A successful login clears the record completely.
 *
 * In memory on purpose: the state is worth nothing after a restart (the
 * attacker's next attempt starts a new series, which is the same position a
 * fresh deployment is in anyway), and a file would mean a disk write per
 * failed guess, which is its own small denial-of-service lever.
 */

const ESCALATION_FACTOR = 5;

/**
 * A record is kept this long after its last failure so a slow guesser cannot
 * reset the escalation by waiting a few minutes between series.
 */
const RECORD_TTL_MS = 60 * 60 * 1000;

/**
 * Cap on tracked addresses. Reaching it means someone is cycling source
 * addresses; the oldest records go first, which are the least interesting.
 */
const MAX_RECORDS = 10_000;

export type LoginThrottleOptions = {
  maxAttempts: number;
  lockSeconds: number;
  maxLockSeconds: number;
};

type Record_ = {
  /** Failures since the last lock expired (or since the last success). */
  failures: number;
  /** How many locks this address has already collected; drives the escalation. */
  locks: number;
  /** Unix ms the current lock ends, or 0 when not locked. */
  lockedUntil: number;
  lastSeen: number;
};

export type ThrottleCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type LoginThrottle = {
  /** Called before verifying a password. */
  check(key: string, now?: number): ThrottleCheck;
  /** Called after a wrong password; returns the lock it just triggered, if any. */
  recordFailure(key: string, now?: number): { lockedForSeconds: number } | null;
  /** Called after a correct password. */
  recordSuccess(key: string): void;
  /** Tracked addresses; for tests and the log. */
  size(): number;
};

export function createLoginThrottle(options: LoginThrottleOptions): LoginThrottle {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const maxLockSeconds = Math.max(1, Math.floor(options.maxLockSeconds));
  // A base above the cap is a contradictory configuration; the cap wins,
  // because that is the number the operator meant as the worst case.
  const lockSeconds = Math.min(Math.max(1, Math.floor(options.lockSeconds)), maxLockSeconds);

  const records = new Map<string, Record_>();

  function lockDurationSeconds(locks: number): number {
    // locks counts the locks already served, so the first one is the base.
    const scaled = lockSeconds * ESCALATION_FACTOR ** locks;

    return Math.min(maxLockSeconds, scaled);
  }

  function sweep(now: number): void {
    for (const [key, record] of records) {
      if (record.lockedUntil <= now && now - record.lastSeen > RECORD_TTL_MS) {
        records.delete(key);
      }
    }

    if (records.size <= MAX_RECORDS) {
      return;
    }

    // Map iteration is insertion-ordered, and every touch re-inserts, so the
    // head of the map is the least recently seen record.
    const excess = records.size - MAX_RECORDS;
    let removed = 0;

    for (const [key, record] of records) {
      if (removed >= excess) {
        break;
      }

      if (record.lockedUntil <= now) {
        records.delete(key);
        removed += 1;
      }
    }
  }

  function touch(key: string, record: Record_, now: number): void {
    record.lastSeen = now;
    // Re-insert so the map stays ordered by last use for the sweep above.
    records.delete(key);
    records.set(key, record);
  }

  return {
    check(key, now = Date.now()) {
      const record = records.get(key);

      if (!record) {
        return { allowed: true };
      }

      if (record.lockedUntil > now) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)) };
      }

      return { allowed: true };
    },

    recordFailure(key, now = Date.now()) {
      sweep(now);

      const record = records.get(key) ?? { failures: 0, locks: 0, lockedUntil: 0, lastSeen: now };

      record.failures += 1;
      touch(key, record, now);

      if (record.failures < maxAttempts) {
        return null;
      }

      const seconds = lockDurationSeconds(record.locks);

      record.failures = 0;
      record.locks += 1;
      record.lockedUntil = now + seconds * 1000;

      return { lockedForSeconds: seconds };
    },

    recordSuccess(key) {
      records.delete(key);
    },

    size() {
      return records.size;
    }
  };
}

/**
 * The address a login attempt is counted against. Fastify's `request.ip`
 * already resolves `X-Forwarded-For` when `trustProxy` is on, which is what
 * the documented deployment (Caddy in front) needs: without it every attempt
 * would count against the proxy and one attacker would lock out everyone.
 */
export function throttleKeyFor(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : "unknown";
}
