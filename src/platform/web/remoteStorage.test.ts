import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readDir: vi.fn(),
  stat: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readText: vi.fn(),
  writeText: vi.fn(),
  readBytes: vi.fn(),
  writeBytes: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  packFolder: vi.fn()
}));

vi.mock("./serverApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serverApi")>();

  return { ...actual, serverApi: { ...actual.serverApi, ...api } };
});

const { ApiError } = await import("./serverApi");
const { PlatformUnavailableError } = await import("@/platform/errors");
const { REMOTE_VAULT_ROOT, remoteVaultStorage } = await import("./remoteStorage");

describe("remote vault storage (web platform)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) {
      fn.mockReset();
    }
  });

  it("maps the server's relative paths onto the virtual root and back", async () => {
    api.listFiles.mockResolvedValue([
      { relativePath: "Welcome.md", mtimeMs: 2 },
      { relativePath: "Notes/Idea.md", mtimeMs: 1 }
    ]);

    const records = await remoteVaultStorage.listMarkdownFiles(REMOTE_VAULT_ROOT);

    expect(records).toEqual([
      { filePath: "/vault/Notes/Idea.md", relativePath: "Notes/Idea.md", mtimeMs: 1 },
      { filePath: "/vault/Welcome.md", relativePath: "Welcome.md", mtimeMs: 2 }
    ]);

    api.readText.mockResolvedValue("# Idea");
    await expect(remoteVaultStorage.readTextFile("/vault/Notes/Idea.md")).resolves.toBe("# Idea");
    expect(api.readText).toHaveBeenCalledWith("Notes/Idea.md");

    api.writeText.mockResolvedValue({ mtimeMs: 3 });
    await remoteVaultStorage.writeTextFile("/vault/Notes/Idea.md", "# Idea!");
    expect(api.writeText).toHaveBeenCalledWith("Notes/Idea.md", "# Idea!");

    api.rename.mockResolvedValue(undefined);
    await remoteVaultStorage.rename("/vault/Notes/Idea.md", "/vault/Plan.md");
    expect(api.rename).toHaveBeenCalledWith("Notes/Idea.md", "Plan.md");

    api.remove.mockResolvedValue(undefined);
    await remoteVaultStorage.remove("/vault/Notes", { recursive: true });
    expect(api.remove).toHaveBeenCalledWith("Notes", true);
    await remoteVaultStorage.remove("/vault/Plan.md");
    expect(api.remove).toHaveBeenCalledWith("Plan.md", false);

    api.mkdir.mockResolvedValue(undefined);
    await remoteVaultStorage.mkdir("/vault/A/B", { recursive: true });
    expect(api.mkdir).toHaveBeenCalledWith("A/B", true);

    api.exists.mockResolvedValue(true);
    await expect(remoteVaultStorage.exists("/vault/.scribecat/order.json")).resolves.toBe(true);
    expect(api.exists).toHaveBeenCalledWith(".scribecat/order.json");

    // The root itself is a valid directory to list.
    api.readDir.mockResolvedValue([{ name: "Notes", isDirectory: true, isFile: false, isSymlink: false }]);
    await expect(remoteVaultStorage.readDir("/vault")).resolves.toHaveLength(1);
    expect(api.readDir).toHaveBeenCalledWith("");
  });

  it("turns the server's epoch times into the Date fields the desktop shape has", async () => {
    api.stat.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 5, mtimeMs: 1000, birthtimeMs: null });

    const info = await remoteVaultStorage.stat("/vault/a.md");

    expect(info.mtime?.getTime()).toBe(1000);
    expect(info.birthtime).toBeNull();
    expect(info.size).toBe(5);
  });

  it("moves bytes both ways", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    api.readBytes.mockResolvedValue(bytes);
    await expect(remoteVaultStorage.readFile("/vault/images/x.png")).resolves.toBe(bytes);

    api.writeBytes.mockResolvedValue({ mtimeMs: 1 });
    await remoteVaultStorage.writeFile("/vault/images/y.png", bytes);
    expect(api.writeBytes).toHaveBeenCalledWith("images/y.png", bytes);
  });

  it("packs a folder, the root included, through the server", async () => {
    const zip = new Uint8Array([80, 75, 3, 4]);
    api.packFolder.mockResolvedValue(zip);

    await expect(remoteVaultStorage.packFolder?.("/vault/Notes")).resolves.toBe(zip);
    expect(api.packFolder).toHaveBeenCalledWith("Notes");

    await remoteVaultStorage.packFolder?.("/vault");
    expect(api.packFolder).toHaveBeenLastCalledWith("");
  });

  it("refuses paths outside the virtual root before they reach the server", async () => {
    await expect(remoteVaultStorage.readTextFile("/elsewhere/Idea.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.readTextFile("/vault/../Idea.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.exists("/etc/passwd")).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(api.readText).not.toHaveBeenCalled();
    expect(api.exists).not.toHaveBeenCalled();
  });

  it("offers the full set of capabilities", () => {
    expect(Object.values(remoteVaultStorage.capabilities).every((enabled) => enabled === true)).toBe(true);
  });

  it("passes server errors through unchanged", async () => {
    api.writeText.mockRejectedValue(new ApiError(500, "internal", "boom"));
    await expect(remoteVaultStorage.writeTextFile("/vault/a.md", "")).rejects.toBeInstanceOf(ApiError);
  });
});
