import { beforeEach, describe, expect, it, vi } from "vitest";

const { listFiles, readNote, saveNote } = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readNote: vi.fn(),
  saveNote: vi.fn()
}));

vi.mock("./serverApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serverApi")>();

  return { ...actual, serverApi: { ...actual.serverApi, listFiles, readNote, saveNote } };
});

const { ApiError } = await import("./serverApi");
const { PlatformUnavailableError } = await import("@/platform/errors");
const { REMOTE_VAULT_ROOT, remoteVaultStorage } = await import("./remoteStorage");

describe("remote vault storage (web platform)", () => {
  beforeEach(() => {
    listFiles.mockReset();
    readNote.mockReset();
    saveNote.mockReset();
  });

  it("maps the server's relative paths onto the virtual root and back", async () => {
    listFiles.mockResolvedValue([
      { relativePath: "Welcome.md", mtimeMs: 2 },
      { relativePath: "Notes/Idea.md", mtimeMs: 1 }
    ]);

    const records = await remoteVaultStorage.listMarkdownFiles(REMOTE_VAULT_ROOT);

    expect(records).toEqual([
      { filePath: "/vault/Notes/Idea.md", relativePath: "Notes/Idea.md", mtimeMs: 1 },
      { filePath: "/vault/Welcome.md", relativePath: "Welcome.md", mtimeMs: 2 }
    ]);

    readNote.mockResolvedValue({ relativePath: "Notes/Idea.md", content: "# Idea", mtimeMs: 1 });
    await expect(remoteVaultStorage.readTextFile("/vault/Notes/Idea.md")).resolves.toBe("# Idea");
    expect(readNote).toHaveBeenCalledWith("Notes/Idea.md");

    saveNote.mockResolvedValue({ relativePath: "Notes/Idea.md", content: "# Idea!", mtimeMs: 3 });
    await remoteVaultStorage.writeTextFile("/vault/Notes/Idea.md", "# Idea!");
    expect(saveNote).toHaveBeenCalledWith("Notes/Idea.md", "# Idea!");
  });

  it("refuses paths outside the virtual root before they reach the server", async () => {
    await expect(remoteVaultStorage.readTextFile("/elsewhere/Idea.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.readTextFile("/vault/../Idea.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(readNote).not.toHaveBeenCalled();
  });

  it("reports what this stage does not offer as unavailable rather than failing oddly", async () => {
    // Sidecar files (.scribedog/…) are read by every vault open; their
    // readers fall back to defaults on any error.
    await expect(remoteVaultStorage.readTextFile("/vault/.scribedog/order.json")).rejects.toBeInstanceOf(
      PlatformUnavailableError
    );
    await expect(remoteVaultStorage.exists("/vault/.scribedog/order.json")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.rename("/vault/a.md", "/vault/b.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.remove("/vault/a.md")).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(remoteVaultStorage.mkdir("/vault/x")).rejects.toBeInstanceOf(PlatformUnavailableError);

    // Creating a note: the file API only overwrites, so the server's 404 is
    // "not yet", not "gone".
    saveNote.mockRejectedValue(new ApiError(404, "not_found", "does not exist"));
    await expect(remoteVaultStorage.writeTextFile("/vault/New.md", "")).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  it("offers nothing beyond list/read/overwrite yet", () => {
    expect(Object.values(remoteVaultStorage.capabilities).every((enabled) => enabled === false)).toBe(true);
  });

  it("passes other server errors through unchanged", async () => {
    saveNote.mockRejectedValue(new ApiError(500, "internal", "boom"));
    await expect(remoteVaultStorage.writeTextFile("/vault/a.md", "")).rejects.toBeInstanceOf(ApiError);
  });
});
