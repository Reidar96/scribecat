import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLoginThrottle } from "../src/auth/loginThrottle.js";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { KEY_COOKIE_NAME } from "../src/secrets/keyCookie.js";
import { createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

describe("login throttle", () => {
  const options = { maxAttempts: 3, lockSeconds: 60, maxLockSeconds: 900 };

  it("allows attempts up to the limit and then locks", () => {
    const throttle = createLoginThrottle(options);
    const now = 1_000_000;

    expect(throttle.check("a", now).allowed).toBe(true);
    expect(throttle.recordFailure("a", now)).toBeNull();
    expect(throttle.recordFailure("a", now)).toBeNull();
    expect(throttle.recordFailure("a", now)).toEqual({ lockedForSeconds: 60 });

    const locked = throttle.check("a", now + 1000);
    expect(locked.allowed).toBe(false);
    expect(locked.allowed === false && locked.retryAfterSeconds).toBe(59);
  });

  it("escalates 1 minute, 5 minutes, 15 minutes and stays there", () => {
    const throttle = createLoginThrottle(options);
    let now = 0;
    const durations: number[] = [];

    for (let series = 0; series < 4; series += 1) {
      let locked: { lockedForSeconds: number } | null = null;

      for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
        locked = throttle.recordFailure("a", now) ?? locked;
      }

      durations.push(locked?.lockedForSeconds ?? 0);
      // Wait out the lock before the next series.
      now += (locked?.lockedForSeconds ?? 0) * 1000 + 1000;
      expect(throttle.check("a", now).allowed).toBe(true);
    }

    expect(durations).toEqual([60, 300, 900, 900]);
  });

  it("counts each address on its own and forgets one that signs in", () => {
    const throttle = createLoginThrottle(options);

    for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
      throttle.recordFailure("a");
    }

    expect(throttle.check("a").allowed).toBe(false);
    expect(throttle.check("b").allowed).toBe(true);

    throttle.recordSuccess("a");
    expect(throttle.check("a").allowed).toBe(true);
    expect(throttle.size()).toBe(0);
  });

  it("never locks for longer than the cap, even with a large base", () => {
    const throttle = createLoginThrottle({ maxAttempts: 1, lockSeconds: 1000, maxLockSeconds: 100 });

    expect(throttle.recordFailure("a", 0)).toEqual({ lockedForSeconds: 100 });
  });
});

describe("login route with throttling", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext({ SCRIBECAT_LOGIN_MAX_ATTEMPTS: "2", SCRIBECAT_LOGIN_LOCK_SECONDS: "60" });
  });

  afterEach(async () => {
    await context.cleanup();
  });

  const attempt = (password: string, ip = "203.0.113.5") =>
    context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password }, remoteAddress: ip });

  it("answers 429 with Retry-After once the limit is reached", async () => {
    expect((await attempt("wrong password")).statusCode).toBe(401);
    expect((await attempt("wrong password")).statusCode).toBe(401);

    const locked = await attempt(TEST_PASSWORD);

    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(locked.json()).toMatchObject({ error: "too_many_attempts" });
  });

  it("keeps the lock to the address that earned it", async () => {
    await attempt("wrong password");
    await attempt("wrong password");

    expect((await attempt(TEST_PASSWORD)).statusCode).toBe(429);
    expect((await attempt(TEST_PASSWORD, "198.51.100.9")).statusCode).toBe(200);
  });

  it("counts the address the proxy vouches for, not one the client claims", async () => {
    // Caddy appends the real client address to X-Forwarded-For, so with one
    // proxy in front the rightmost entry is the one to trust. A client that
    // prepends addresses of its own cannot get a fresh bucket that way.
    const forwarded = (claimed: string) =>
      context.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "wrong password" },
        remoteAddress: "172.21.0.3",
        headers: { "x-forwarded-for": `${claimed}, 198.51.100.44` }
      });

    expect((await forwarded("1.2.3.4")).statusCode).toBe(401);
    expect((await forwarded("9.9.9.9")).statusCode).toBe(401);

    const locked = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: TEST_PASSWORD },
      remoteAddress: "172.21.0.3",
      headers: { "x-forwarded-for": "5.5.5.5, 198.51.100.44" }
    });

    expect(locked.statusCode).toBe(429);
  });

  it("clears the count after a successful login", async () => {
    await attempt("wrong password");
    expect((await attempt(TEST_PASSWORD)).statusCode).toBe(200);
    expect((await attempt("wrong password")).statusCode).toBe(401);
    expect((await attempt("wrong password")).statusCode).toBe(401);
    expect((await attempt(TEST_PASSWORD)).statusCode).toBe(429);
  });
});

describe("origin check", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext({ SCRIBECAT_ALLOWED_ORIGINS: "https://notes.example.com" });
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("lets a same-origin request through", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "PUT",
      url: "/api/fs/text",
      headers: { cookie, origin: "http://localhost:80" },
      payload: { path: "Notes/Idea.md", content: "# Idea\n" }
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuses a state-changing request from another site", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "PUT",
      url: "/api/fs/text",
      headers: { cookie, origin: "https://evil.example" },
      payload: { path: "Notes/Idea.md", content: "changed\n" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "forbidden_origin" });
    expect(await context.vault.readText("Notes/Idea.md")).toBe("# Idea\n");
  });

  it("refuses a login from another site", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { password: TEST_PASSWORD }
    });

    expect(response.statusCode).toBe(403);
  });

  it("falls back to Referer when Origin is missing", async () => {
    const cookie = await context.login();

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/fs/mkdir",
          headers: { cookie, referer: "https://evil.example/page" },
          payload: { path: "Evil", recursive: true }
        })
      ).statusCode
    ).toBe(403);

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/fs/mkdir",
          headers: { cookie, referer: "http://localhost/app" },
          payload: { path: "Fine", recursive: true }
        })
      ).statusCode
    ).toBe(204);
  });

  it("accepts an origin from SCRIBECAT_ALLOWED_ORIGINS", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "POST",
      url: "/api/fs/mkdir",
      headers: { cookie, origin: "https://notes.example.com" },
      payload: { path: "Allowed", recursive: true }
    });

    expect(response.statusCode).toBe(204);
  });

  it("leaves requests without either header alone (curl, scripts)", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "POST",
      url: "/api/fs/mkdir",
      headers: { cookie },
      payload: { path: "Scripted", recursive: true }
    });

    expect(response.statusCode).toBe(204);
  });

  it("refuses a cross-site WebSocket handshake", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "GET",
      url: "/api/events",
      headers: { cookie, origin: "https://evil.example", upgrade: "websocket", connection: "upgrade" }
    });

    expect(response.statusCode).toBe(403);
  });

  it("leaves reads alone", async () => {
    const cookie = await context.login();
    const response = await context.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { cookie, origin: "https://evil.example" }
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("changing the password", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    context.app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie }, payload: { currentPassword, newPassword } });

  it("needs a session", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/password",
      payload: { currentPassword: TEST_PASSWORD, newPassword: "a new long password" }
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a wrong current password", async () => {
    const cookie = await context.login();

    expect((await change(cookie, "not the password", "a new long password")).statusCode).toBe(401);
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } })).statusCode).toBe(
      200
    );
  });

  it("refuses a new password that breaks the policy or repeats the old one", async () => {
    const cookie = await context.login();

    expect((await change(cookie, TEST_PASSWORD, "short")).statusCode).toBe(400);
    expect((await change(cookie, TEST_PASSWORD, TEST_PASSWORD)).statusCode).toBe(400);
  });

  it("switches the password, ends every other session and keeps the caller signed in", async () => {
    const mine = await context.login();
    const other = await context.login();

    const response = await change(mine, TEST_PASSWORD, "a new long password");

    expect(response.statusCode).toBe(200);

    // The other session is gone, mine continues with the cookies from the
    // response.
    expect((await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie: other } })).statusCode).toBe(401);

    const refreshed = response.cookies
      .filter((entry) => [SESSION_COOKIE_NAME, KEY_COOKIE_NAME].includes(entry.name))
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");

    expect((await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie: refreshed } })).statusCode).toBe(200);

    // And the old password no longer works.
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } })).statusCode).toBe(
      401
    );
    expect(
      (await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "a new long password" } })).statusCode
    ).toBe(200);
  });
});
