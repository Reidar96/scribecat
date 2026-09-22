import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openAuthStore, SERVER_META_DIR } from "../src/auth/authStore.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken, type SessionConfig } from "../src/auth/session.js";
import { createTempVault, createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

describe("password hashing", () => {
  it("verifies the password it hashed and rejects others", async () => {
    const hash = await hashPassword("hunter2hunter2");

    expect(hash.startsWith("$scrypt$")).toBe(true);
    expect(await verifyPassword("hunter2hunter2", hash)).toBe(true);
    expect(await verifyPassword("hunter2hunter3", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never verifies against a malformed stored hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "$argon2id$v=19$m=1$x$y")).toBe(false);
    expect(await verifyPassword("anything", "$scrypt$ln=16,r=8,p=2$AAAA$AAAA")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });
});

describe("session tokens", () => {
  const config: SessionConfig = {
    secret: Buffer.from("0123456789abcdef0123456789abcdef"),
    maxAgeMs: 60 * 24 * 60 * 60 * 1000,
    cookiePath: "/",
    secure: true
  };

  it("round-trips a valid token", () => {
    const token = createSessionToken(config, 1, 1_000_000);
    const verified = verifySessionToken(config, token, 1, 1_000_001);

    expect(verified).not.toBeNull();
    expect(verified?.payload.epoch).toBe(1);
    expect(verified?.shouldRefresh).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    const token = createSessionToken({ ...config, secret: Buffer.from("another secret entirely.........") }, 1);
    expect(verifySessionToken(config, token, 1)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(config, 1);
    const [payload, signature] = token.split(".");
    const original = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...original, exp: 9e15 })).toString("base64url");

    expect(verifySessionToken(config, `${forged}.${signature}`, 1)).toBeNull();
    expect(verifySessionToken(config, `${payload}.${signature}x`, 1)).toBeNull();
    expect(verifySessionToken(config, payload, 1)).toBeNull();
    expect(verifySessionToken(config, "", 1)).toBeNull();
    expect(verifySessionToken(config, undefined, 1)).toBeNull();
  });

  it("rejects an expired token and one from another epoch", () => {
    const issuedAt = 1_000_000;
    const token = createSessionToken(config, 1, issuedAt);

    expect(verifySessionToken(config, token, 1, issuedAt + config.maxAgeMs)).toBeNull();
    expect(verifySessionToken(config, token, 2, issuedAt + 1)).toBeNull();
  });

  it("asks for a refresh once the token is a day old", () => {
    const issuedAt = 1_000_000;
    const token = createSessionToken(config, 1, issuedAt);

    expect(verifySessionToken(config, token, 1, issuedAt + 23 * 60 * 60 * 1000)?.shouldRefresh).toBe(false);
    expect(verifySessionToken(config, token, 1, issuedAt + 25 * 60 * 60 * 1000)?.shouldRefresh).toBe(true);
  });
});

describe("auth store", () => {
  const log = { info: () => {}, warn: () => {} };
  const vaults: string[] = [];

  // Every test gets its own vault; drop them afterwards rather than leaving
  // one temp folder per run behind.
  async function tempVault(): Promise<string> {
    const vaultPath = await createTempVault();
    vaults.push(vaultPath);
    return vaultPath;
  }

  afterEach(async () => {
    await Promise.all(vaults.splice(0).map((vaultPath) => rm(vaultPath, { recursive: true, force: true })));
  });

  it("creates the hash from the init password on first start only", async () => {
    const vaultPath = await tempVault();
    const warnings: string[] = [];
    const warnLog = { info: () => {}, warn: (message: string) => warnings.push(message) };

    const first = await openAuthStore({ vaultPath, initPassword: "first password", log: warnLog });
    expect(await first.verifyPassword("first password")).toBe(true);
    expect(warnings).toHaveLength(0);

    // A redeploy with a different init password must not reset anything.
    const second = await openAuthStore({ vaultPath, initPassword: "second password", log: warnLog });
    expect(await second.verifyPassword("first password")).toBe(true);
    expect(await second.verifyPassword("second password")).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ignored/);

    // And once a hash exists the variable is not needed at all.
    const third = await openAuthStore({ vaultPath, initPassword: null, log: warnLog });
    expect(await third.verifyPassword("first password")).toBe(true);
    expect(third.sessionSecret.equals(first.sessionSecret)).toBe(true);
  });

  it("refuses to start without a password and without an init password", async () => {
    const vaultPath = await tempVault();
    await expect(openAuthStore({ vaultPath, initPassword: null, log })).rejects.toThrow(/SCRIBECAT_INIT_PASSWORD/);
  });

  it("refuses an init password that breaks the policy", async () => {
    const vaultPath = await tempVault();
    await expect(openAuthStore({ vaultPath, initPassword: "short", log })).rejects.toThrow(/at least/);
  });

  it("stores the hash and the secret under .scribecat/server", async () => {
    const vaultPath = await tempVault();
    await openAuthStore({ vaultPath, initPassword: "first password", log });

    const authFile = JSON.parse(await readFile(path.join(vaultPath, SERVER_META_DIR, "auth.json"), "utf8"));
    expect(authFile.passwordHash).toMatch(/^\$scrypt\$/);
    expect(authFile.sessionEpoch).toBe(1);
    expect(authFile.passwordHash).not.toContain("first password");
  });
});

describe("auth routes", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("rejects a wrong password without setting a cookie", async () => {
    const response = await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong password" } });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toHaveLength(0);
  });

  it("rejects a malformed body", async () => {
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: {} })).statusCode).toBe(400);
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: 42 } })).statusCode).toBe(400);
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "short" } })).statusCode).toBe(401);
  });

  it("sets a httpOnly, SameSite=Lax session cookie on the right path", async () => {
    const response = await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } });

    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(60 * 24 * 60 * 60);
    // Secure is off only because the test context runs without TLS.
    expect(cookie?.secure).toBeUndefined();
  });

  it("marks the cookie Secure by default", async () => {
    const secureContext = await createTestContext({ SCRIBECAT_COOKIE_SECURE: "" });

    try {
      const response = await secureContext.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } });
      expect(response.cookies[0]?.secure).toBe(true);
    } finally {
      await secureContext.cleanup();
    }
  });

  it("guards the file API and reports the session state", async () => {
    expect((await context.app.inject({ method: "GET", url: "/api/files" })).statusCode).toBe(401);
    expect((await context.app.inject({ method: "GET", url: "/api/auth/session" })).json()).toEqual({ authenticated: false });

    const cookie = await context.login();

    expect((await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie } })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).json()).toEqual({
      authenticated: true,
      via: "cookie"
    });
  });

  it("rejects a forged cookie", async () => {
    // The cookie header carries the session token and the key cookie; only
    // the session token decides whether a request is let through.
    const session = (await context.login()).split("; ").find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? "";
    const forged = `${session.slice(0, -4)}AAAA`;

    expect((await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie: forged } })).statusCode).toBe(401);
    expect(
      (await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie: `${SESSION_COOKIE_NAME}=garbage` } })).statusCode
    ).toBe(401);
  });

  it("logs out by clearing the cookie", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });

    expect(response.statusCode).toBe(204);
    const cleared = response.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);
    expect(cleared?.value).toBe("");
    expect(cleared?.path).toBe("/");
    expect(cleared?.expires?.getTime()).toBeLessThan(Date.now());
  });
});
