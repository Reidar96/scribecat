import { describe, expect, it, vi } from "vitest";

// Tauri's path API as it behaves on Windows: backslashes in, backslashes out.
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("\\"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("\\")),
  normalize: async (path: string) => path.replace(/\//g, "\\")
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

const { platform } = await import("./index");

describe("desktop path arithmetic", () => {
  it("keeps a local folder on the shell's own path rules", async () => {
    expect(await platform.paths.join("C:\\Notes", "Ideas", "One.md")).toBe("C:\\Notes\\Ideas\\One.md");
    expect(await platform.paths.dirname("C:\\Notes\\One.md")).toBe("C:\\Notes");
  });

  it("keeps a server vault POSIX, so listed and built paths spell the same", async () => {
    const root = "/@remote/notes.example.com/anna";

    expect(await platform.paths.join(root, "Ideas", "One.md")).toBe(`${root}/Ideas/One.md`);
    expect(await platform.paths.join(`${root}/Ideas`, "..", "Two.md")).toBe(`${root}/Two.md`);
    expect(await platform.paths.dirname(`${root}/Ideas/One.md`)).toBe(`${root}/Ideas`);
    expect(await platform.paths.normalize(`${root}/Ideas/./One.md`)).toBe(`${root}/Ideas/One.md`);
  });
});
