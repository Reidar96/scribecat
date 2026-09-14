import { readFile } from "node:fs/promises";
import path from "node:path";

import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SERVER_META_DIR } from "../src/auth/authStore.js";
import { openTokenStore } from "../src/auth/tokenStore.js";
import { REVOKED_CLOSE_CODE } from "../src/vault/eventRoutes.js";
import { createTempVault, createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

type IssuedResponse = { id: string; name: string; token: string; createdAt: string; lastUsedAt: string | null };

async function issueToken(context: TestContext, name = "Laptop", password = TEST_PASSWORD): Promise<IssuedResponse> {
  const response = await context.app.inject({
    method: "POST",
    url: `${context.config.basePath}/api/auth/tokens`,
    payload: { password, name }
  });

  if (response.statusCode !== 201) {
    throw new Error(`token issue failed: ${response.statusCode} ${response.body}`);
  }

  return response.json<IssuedResponse>();
}

describe("token store", () => {
  const silentLog = { warn: () => {} };

  it("issues tokens it can verify and never stores the secret", async () => {
    const vaultPath = await createTempVault();
    const store = await openTokenStore({ vaultPath, log: silentLog });

    const issued = await store.issue("Laptop", 1);

    expect(issued.token.startsWith("sdt_")).toBe(true);
    expect(store.verify(issued.token, 1)?.id).toBe(issued.id);
    expect(store.verify(issued.token, 2)).toBeNull();
    expect(store.verify(`${issued.token}x`, 1)).toBeNull();
    expect(store.verify("sdt_nonsense", 1)).toBeNull();
    expect(store.verify(undefined, 1)).toBeNull();

    const onDisk = await readFile(path.join(vaultPath, SERVER_META_DIR, "tokens.json"), "utf8");
    expect(onDisk).not.toContain(issued.token.split("_")[2]);
    expect(onDisk).toContain(issued.id);
  });

  it("survives a restart and drops tokens from an older epoch", async () => {
    const vaultPath = await createTempVault();
    const first = await openTokenStore({ vaultPath, log: silentLog });
    const old = await first.issue("Old", 1);
    const current = await first.issue("Current", 2);

    const reopened = await openTokenStore({ vaultPath, log: silentLog });
    expect(reopened.verify(old.token, 2)).toBeNull();
    expect(reopened.verify(current.token, 2)?.name).toBe("Current");
    expect(reopened.list(2).map((token) => token.name)).toEqual(["Current"]);

    const revoked: string[] = [];
    reopened.onRevoked((id) => revoked.push(id));
    await reopened.dropOutdated(2);
    expect(revoked).toEqual([old.id]);
    expect((await openTokenStore({ vaultPath, log: silentLog })).list(1)).toEqual([]);
  });

  it("records the last use no more than once a minute", async () => {
    const vaultPath = await createTempVault();
    const store = await openTokenStore({ vaultPath, log: silentLog });
    const issued = await store.issue("Laptop", 1);
    const start = new Date("2026-09-14T10:00:00Z");

    store.verify(issued.token, 1, start);
    store.verify(issued.token, 1, new Date(start.getTime() + 30_000));
    expect(store.list(1)[0].lastUsedAt).toBe(start.toISOString());

    const later = new Date(start.getTime() + 61_000);
    store.verify(issued.token, 1, later);
    expect(store.list(1)[0].lastUsedAt).toBe(later.toISOString());
  });
});

describe("access tokens over the API", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("issues a token against the password and rejects a wrong one", async () => {
    const issued = await issueToken(context);

    expect(issued.name).toBe("Laptop");
    expect(issued.lastUsedAt).toBeNull();

    const wrong = await context.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { password: "not the password", name: "Laptop" }
    });

    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: "invalid_password" });

    const unnamed = await context.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { password: TEST_PASSWORD, name: "   " }
    });

    expect(unnamed.statusCode).toBe(400);
  });

  it("counts wrong passwords on the token route toward the login lock", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await context.app.inject({ method: "POST", url: "/api/auth/tokens", payload: { password: "wrong wrong", name: "x" } });
    }

    const locked = await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } });
    expect(locked.statusCode).toBe(429);

    const lockedIssue = await context.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { password: TEST_PASSWORD, name: "x" }
    });
    expect(lockedIssue.statusCode).toBe(429);
  });

  it("lets a bearer token use the file API without a cookie", async () => {
    const issued = await issueToken(context);
    const headers = { authorization: `Bearer ${issued.token}` };

    const unauthenticated = await context.app.inject({ method: "GET", url: "/api/files" });
    expect(unauthenticated.statusCode).toBe(401);

    const listed = await context.app.inject({ method: "GET", url: "/api/files", headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ files: { relativePath: string }[] }>().files.map((file) => file.relativePath)).toContain("Notes/Idea.md");

    const written = await context.app.inject({
      method: "PUT",
      url: "/api/fs/text",
      headers,
      payload: { path: "FromDesktop.md", content: "# Desktop\n" }
    });
    expect(written.statusCode).toBe(200);

    const session = await context.app.inject({ method: "GET", url: "/api/auth/session", headers });
    expect(session.json()).toEqual({ authenticated: true, via: "token" });

    const bogus = await context.app.inject({ method: "GET", url: "/api/files", headers: { authorization: "Bearer sdt_no_such" } });
    expect(bogus.statusCode).toBe(401);
  });

  it("does not check the origin of a token request, but still checks a cookie request", async () => {
    const issued = await issueToken(context);
    const cookie = await context.login();

    const tokenRequest = await context.app.inject({
      method: "POST",
      url: "/api/fs/mkdir",
      headers: { authorization: `Bearer ${issued.token}`, origin: "https://evil.example" },
      payload: { path: "FromToken", recursive: false }
    });
    expect(tokenRequest.statusCode).toBe(204);

    const cookieRequest = await context.app.inject({
      method: "POST",
      url: "/api/fs/mkdir",
      headers: { cookie, origin: "https://evil.example" },
      payload: { path: "FromCookie", recursive: false }
    });
    expect(cookieRequest.statusCode).toBe(403);

    // A cookie plus a bearer header is a browser request as far as CSRF is
    // concerned: the cookie is what a cross-site page could ride on.
    const both = await context.app.inject({
      method: "POST",
      url: "/api/fs/mkdir",
      headers: { cookie, authorization: `Bearer ${issued.token}`, origin: "https://evil.example" },
      payload: { path: "FromBoth", recursive: false }
    });
    expect(both.statusCode).toBe(403);
  });

  it("lists devices without their tokens and marks the caller", async () => {
    const laptop = await issueToken(context, "Laptop");
    const phone = await issueToken(context, "Phone");
    const cookie = await context.login();

    const fromBrowser = await context.app.inject({ method: "GET", url: "/api/auth/tokens", headers: { cookie } });
    expect(fromBrowser.statusCode).toBe(200);
    expect(fromBrowser.body).not.toContain(laptop.token);
    expect(fromBrowser.json()).toEqual({
      tokens: [
        { id: laptop.id, name: "Laptop", createdAt: laptop.createdAt, lastUsedAt: null, current: false },
        { id: phone.id, name: "Phone", createdAt: phone.createdAt, lastUsedAt: null, current: false }
      ]
    });

    const fromLaptop = await context.app.inject({
      method: "GET",
      url: "/api/auth/tokens",
      headers: { authorization: `Bearer ${laptop.token}` }
    });
    const tokens = fromLaptop.json<{ tokens: { id: string; current: boolean; lastUsedAt: string | null }[] }>().tokens;
    expect(tokens.find((token) => token.id === laptop.id)?.current).toBe(true);
    expect(tokens.find((token) => token.id === laptop.id)?.lastUsedAt).not.toBeNull();
    expect(tokens.find((token) => token.id === phone.id)?.current).toBe(false);
  });

  it("revokes a token, after which it is refused", async () => {
    const laptop = await issueToken(context, "Laptop");
    const phone = await issueToken(context, "Phone");
    const cookie = await context.login();

    const revoked = await context.app.inject({ method: "DELETE", url: `/api/auth/tokens/${laptop.id}`, headers: { cookie } });
    expect(revoked.statusCode).toBe(204);

    const again = await context.app.inject({ method: "DELETE", url: `/api/auth/tokens/${laptop.id}`, headers: { cookie } });
    expect(again.statusCode).toBe(404);

    const refused = await context.app.inject({ method: "GET", url: "/api/files", headers: { authorization: `Bearer ${laptop.token}` } });
    expect(refused.statusCode).toBe(401);

    const stillFine = await context.app.inject({ method: "GET", url: "/api/files", headers: { authorization: `Bearer ${phone.token}` } });
    expect(stillFine.statusCode).toBe(200);
  });

  it("ends every token with a password change and forbids the change to a token", async () => {
    const issued = await issueToken(context);
    const cookie = await context.login();

    const viaToken = await context.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { authorization: `Bearer ${issued.token}` },
      payload: { currentPassword: TEST_PASSWORD, newPassword: "another fine password" }
    });
    expect(viaToken.statusCode).toBe(403);

    const changed = await context.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: { currentPassword: TEST_PASSWORD, newPassword: "another fine password" }
    });
    expect(changed.statusCode).toBe(200);

    const refused = await context.app.inject({ method: "GET", url: "/api/files", headers: { authorization: `Bearer ${issued.token}` } });
    expect(refused.statusCode).toBe(401);

    const newCookie = await context.login("another fine password");
    const list = await context.app.inject({ method: "GET", url: "/api/auth/tokens", headers: { cookie: newCookie } });
    expect(list.json()).toEqual({ tokens: [] });
  });
});

describe("live updates with a token", () => {
  let context: TestContext;
  let baseUrl: string;

  beforeEach(async () => {
    context = await createTestContext({}, { watch: true });
    const address = await context.app.listen({ host: "127.0.0.1", port: 0 });
    baseUrl = address.replace(/^http/, "ws");
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("accepts the upgrade with a bearer header and closes the socket when the token is revoked", async () => {
    const issued = await issueToken(context);

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const candidate = new WebSocket(`${baseUrl}/api/events`, { headers: { authorization: `Bearer ${issued.token}` } });
      candidate.once("open", () => resolve(candidate));
      candidate.once("error", reject);
      candidate.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    });

    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    const cookie = await context.login();
    await context.app.inject({ method: "DELETE", url: `/api/auth/tokens/${issued.id}`, headers: { cookie } });

    expect(await closed).toBe(REVOKED_CLOSE_CODE);

    await expect(
      new Promise((resolve, reject) => {
        const retry = new WebSocket(`${baseUrl}/api/events`, { headers: { authorization: `Bearer ${issued.token}` } });
        retry.once("open", resolve);
        retry.once("error", reject);
        retry.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
      })
    ).rejects.toThrow(/401/);
  });
});
