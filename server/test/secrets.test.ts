import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SERVER_META_DIR } from "../src/auth/authStore.js";
import { createKeyCookie, KEY_COOKIE_NAME, readKeyCookie } from "../src/secrets/keyCookie.js";
import { resolveSecretRefs, secretRef, secretRefIds } from "../src/secrets/secretRef.js";
import { openSecretStore } from "../src/secrets/secretStore.js";
import { createTempVault, createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

const OTHER_PASSWORD = "a different long password";

describe("secret store", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("stores a key encrypted and reads it back", async () => {
    const store = openSecretStore(vaultPath);
    const { dataKey } = await store.unlock(TEST_PASSWORD);

    await store.set(dataKey, "openai", "sk-secret-value");

    expect(await store.get(dataKey, "openai")).toBe("sk-secret-value");

    const raw = await readFile(path.join(vaultPath, SERVER_META_DIR, "secrets.json"), "utf8");

    expect(raw).not.toContain("sk-secret-value");
    expect(raw).toContain("openai");
  });

  it("keeps the keys readable across a password change", async () => {
    const store = openSecretStore(vaultPath);
    const { dataKey } = await store.unlock(TEST_PASSWORD);
    await store.set(dataKey, "anthropic", "sk-ant-1");

    await store.rewrap(TEST_PASSWORD, OTHER_PASSWORD);

    const { dataKey: afterChange, discarded } = await store.unlock(OTHER_PASSWORD);

    expect(discarded).toBe(false);
    expect(await store.get(afterChange, "anthropic")).toBe("sk-ant-1");
    // Same data key, so the key cookie handed out before the change still fits.
    expect(afterChange.equals(dataKey)).toBe(true);
  });

  it("discards unreadable entries after a password reset", async () => {
    const store = openSecretStore(vaultPath);
    const { dataKey } = await store.unlock(TEST_PASSWORD);
    await store.set(dataKey, "openai", "sk-lost");

    // A reset replaces auth.json; the password that opens the wrapped key is
    // gone with it.
    const { dataKey: afterReset, discarded } = await store.unlock(OTHER_PASSWORD);

    expect(discarded).toBe(true);
    expect(await store.get(afterReset, "openai")).toBeNull();

    const status = await store.status(afterReset);
    expect(status.state).toBe("ready");
    expect(status.ids).toEqual([]);
    expect(status.discardedAt).not.toBeNull();

    // Storing something new clears the notice.
    await store.set(afterReset, "openai", "sk-new");
    expect((await store.status(afterReset)).discardedAt).toBeNull();
  });

  it("refuses a data key that does not belong to the file", async () => {
    const store = openSecretStore(vaultPath);
    const { dataKey } = await store.unlock(TEST_PASSWORD);
    await store.set(dataKey, "openai", "sk-1");

    const stranger = Buffer.alloc(32, 7);

    expect((await store.status(stranger)).state).toBe("locked");
    await expect(store.get(stranger, "openai")).rejects.toThrow();
    await expect(store.set(stranger, "openai", "sk-2")).rejects.toThrow();
  });

  it("removes an entry and rejects an unusable id or value", async () => {
    const store = openSecretStore(vaultPath);
    const { dataKey } = await store.unlock(TEST_PASSWORD);

    await store.set(dataKey, "embedding:mistral", "sk-emb");
    expect((await store.status(dataKey)).ids).toEqual(["embedding:mistral"]);

    await store.remove(dataKey, "embedding:mistral");
    expect((await store.status(dataKey)).ids).toEqual([]);

    await expect(store.set(dataKey, "../escape", "x")).rejects.toThrow();
    await expect(store.set(dataKey, "openai", "")).rejects.toThrow();
  });

  it("reports locked while there is no data key at all", async () => {
    const store = openSecretStore(vaultPath);

    expect(await store.status(null)).toEqual({ state: "locked", ids: [], discardedAt: null });
  });
});

describe("key cookie", () => {
  const session = { secret: Buffer.alloc(32, 1), maxAgeMs: 1000, cookiePath: "/", secure: true };

  it("round-trips the data key under the same epoch", () => {
    const dataKey = Buffer.alloc(32, 9);
    const cookie = createKeyCookie(session, dataKey, 3);

    expect(readKeyCookie(session, cookie, 3)?.equals(dataKey)).toBe(true);
  });

  it("stops working after a password change and against another secret", () => {
    const cookie = createKeyCookie(session, Buffer.alloc(32, 9), 3);

    expect(readKeyCookie(session, cookie, 4)).toBeNull();
    expect(readKeyCookie({ ...session, secret: Buffer.alloc(32, 2) }, cookie, 3)).toBeNull();
    expect(readKeyCookie(session, undefined, 3)).toBeNull();
    expect(readKeyCookie(session, "not base64url at all!!", 3)).toBeNull();
  });
});

describe("secret placeholders", () => {
  it("finds the ids it produced", () => {
    expect(secretRefIds([`Bearer ${secretRef("openai")}`, secretRef("embedding:mistral"), "nothing here"])).toEqual([
      "openai",
      "embedding:mistral"
    ]);
  });

  it("substitutes only what it knows", () => {
    const values = new Map([["openai", "sk-real"]]);

    expect(resolveSecretRefs(`Bearer ${secretRef("openai")}`, values)).toBe("Bearer sk-real");
    expect(resolveSecretRefs(`Bearer ${secretRef("mistral")}`, values)).toBe(`Bearer ${secretRef("mistral")}`);
  });
});

describe("secret routes", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("needs a session", async () => {
    expect((await context.app.inject({ method: "GET", url: "/api/secrets" })).statusCode).toBe(401);
  });

  it("stores a key, lists it and never hands it back", async () => {
    const cookie = await context.login();

    expect(
      (
        await context.app.inject({
          method: "PUT",
          url: "/api/secrets/openai",
          headers: { cookie },
          payload: { value: "sk-browser" }
        })
      ).statusCode
    ).toBe(204);

    const status = await context.app.inject({ method: "GET", url: "/api/secrets", headers: { cookie } });

    expect(status.json()).toMatchObject({ state: "ready", ids: ["openai"] });
    expect(status.body).not.toContain("sk-browser");
  });

  it("clears a key when an empty value is saved", async () => {
    const cookie = await context.login();

    await context.app.inject({ method: "PUT", url: "/api/secrets/openai", headers: { cookie }, payload: { value: "sk-1" } });
    await context.app.inject({ method: "PUT", url: "/api/secrets/openai", headers: { cookie }, payload: { value: "  " } });

    expect((await context.app.inject({ method: "GET", url: "/api/secrets", headers: { cookie } })).json()).toMatchObject({ ids: [] });
  });

  it("reports locked and refuses writes without the key cookie", async () => {
    const full = await context.login();
    const sessionOnly = full.split("; ").find((entry) => !entry.startsWith(`${KEY_COOKIE_NAME}=`)) ?? "";

    expect((await context.app.inject({ method: "GET", url: "/api/secrets", headers: { cookie: sessionOnly } })).json()).toMatchObject({
      state: "locked"
    });

    const write = await context.app.inject({
      method: "PUT",
      url: "/api/secrets/openai",
      headers: { cookie: sessionOnly },
      payload: { value: "sk-1" }
    });

    expect(write.statusCode).toBe(409);
    expect(write.json()).toMatchObject({ error: "secrets_locked" });
  });

  it("keeps the stored keys through a password change", async () => {
    const cookie = await context.login();

    await context.app.inject({ method: "PUT", url: "/api/secrets/openai", headers: { cookie }, payload: { value: "sk-keep" } });

    const changed = await context.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: { currentPassword: TEST_PASSWORD, newPassword: OTHER_PASSWORD }
    });

    const refreshed = changed.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");

    expect((await context.app.inject({ method: "GET", url: "/api/secrets", headers: { cookie: refreshed } })).json()).toMatchObject({
      state: "ready",
      ids: ["openai"]
    });
  });
});
