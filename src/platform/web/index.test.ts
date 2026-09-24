// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn()
}));

vi.mock("./serverApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serverApi")>();

  return { ...actual, serverApi: { ...actual.serverApi, ...api } };
});

const { platform } = await import("./index");
const { SessionError } = await import("@/platform/errors");

const fetchMock = vi.fn();

async function resetPlatformState() {
  for (const fn of Object.values(api)) {
    fn.mockReset();
  }

  await platform.session?.logout();
}

describe("web platform http", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses the browser fetch directly", async () => {
    await platform.http.fetch("/api/health", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledWith("/api/health", { method: "GET" });
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

describe("web platform image picker", () => {
  it("attaches the picker input to the document for mobile WebKit and cleans it up", async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {
        expect(document.body.contains(this)).toBe(true);
        expect(this.accept).toContain("image/*");
        this.dispatchEvent(new Event("cancel"));
      });

    await expect(
      platform.imagePicker.pickImages({
        title: "Images",
        filterName: "Images",
        extensions: ["png", "jpg", "heic"]
      })
    ).resolves.toEqual([]);

    expect(document.querySelector('input[type="file"]')).toBeNull();
    click.mockRestore();
  });
});
