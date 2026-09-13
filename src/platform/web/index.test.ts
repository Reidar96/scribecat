// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  secretStatus: vi.fn(),
  storeSecret: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn()
}));

vi.mock("./serverApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serverApi")>();

  return { ...actual, serverApi: { ...actual.serverApi, ...api } };
});

const { platform } = await import("./index");
const { secretRef } = await import("@/platform/secretRef");
const { LLM_TARGET_HEADER } = await import("./serverApi");
const { SessionError } = await import("@/platform/errors");

const fetchMock = vi.fn();

/**
 * What the platform knows about the stored keys is cached for the tab and
 * dropped on sign-out, so signing out is also how a test starts from nothing.
 */
async function resetPlatformState() {
  for (const fn of Object.values(api)) {
    fn.mockReset();
  }

  await platform.session?.logout();
}

describe("web platform credentials", () => {
  beforeEach(async () => {
    await resetPlatformState();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("reports a stored key as a placeholder, never as its value", async () => {
    api.secretStatus.mockResolvedValue({ state: "ready", ids: ["openai"], discardedAt: null });

    expect(await platform.credentials.getApiKey("openai")).toBe(secretRef("openai"));
    expect(await platform.credentials.getApiKey("mistral")).toBe("");
  });

  it("asks the server once and again after a key was stored", async () => {
    api.secretStatus.mockResolvedValue({ state: "ready", ids: [], discardedAt: null });

    await platform.credentials.getApiKey("openai");
    await platform.credentials.getApiKey("openai");

    expect(api.secretStatus).toHaveBeenCalledTimes(1);

    api.storeSecret.mockResolvedValue(undefined);
    api.secretStatus.mockResolvedValue({ state: "ready", ids: ["openai"], discardedAt: null });
    await platform.credentials.storeApiKey("openai", "sk-1");

    expect(await platform.credentials.getApiKey("openai")).toBe(secretRef("openai"));
    expect(api.storeSecret).toHaveBeenCalledWith("openai", "sk-1");
  });

  it("reports a locked store rather than throwing", async () => {
    api.secretStatus.mockRejectedValue(new Error("no session"));

    expect(await platform.credentials.getStatus()).toEqual({ state: "locked", discardedAt: null });
    expect(await platform.credentials.getApiKey("openai")).toBe("");
  });

  it("passes the discard notice through", async () => {
    api.secretStatus.mockResolvedValue({ state: "ready", ids: [], discardedAt: "2026-09-13T00:00:00.000Z" });

    expect(await platform.credentials.getStatus()).toEqual({ state: "ready", discardedAt: "2026-09-13T00:00:00.000Z" });
  });
});

describe("web platform http", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends a cloud AI request through the server's proxy", async () => {
    await platform.http.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretRef("openai")}` }
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("/api/llm/request");
    expect((init.headers as Headers).get(LLM_TARGET_HEADER)).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Headers).get("authorization")).toBe(`Bearer ${secretRef("openai")}`);
    expect(init.credentials).toBe("same-origin");
  });

  it("leaves a local endpoint and our own origin alone", async () => {
    await platform.http.fetch("http://localhost:11434/api/chat", { method: "POST" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");

    await platform.http.fetch(`${window.location.origin}/api/health`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${window.location.origin}/api/health`);
  });
});

describe("web platform session", () => {
  beforeEach(async () => {
    await resetPlatformState();
  });

  it("reports a wrong current password as such", async () => {
    api.changePassword.mockRejectedValue(new SessionError("invalid_password", "Wrong password."));

    await expect(platform.session?.changePassword("old", "new-password")).rejects.toMatchObject({
      code: "invalid_password"
    });
  });

  it("wraps anything else the server says into a SessionError", async () => {
    const { ApiError } = await import("./serverApi");

    api.changePassword.mockRejectedValue(new ApiError(400, "weak_password", "Too short."));

    await expect(platform.session?.changePassword("old", "x")).rejects.toMatchObject({ code: "weak_password" });
  });
});
