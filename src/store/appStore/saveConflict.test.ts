import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));

// The file as it sits on disk: content plus the mtime a stat would report.
const disk = vi.hoisted(() => ({ content: "# Note\n", mtimeMs: 1_000 }));

const fsMock = vi.hoisted(() => ({
  writeMarkdownFile: vi.fn(async (_path: string, content: string) => {
    disk.content = content;
    disk.mtimeMs += 10_000;
  }),
  readMarkdownFile: vi.fn(async () => disk.content),
  readMarkdownFileMtime: vi.fn(async () => disk.mtimeMs)
}));

vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  ...fsMock,
  cleanupOrphanedImages: vi.fn(async () => undefined)
}));

const versioning = vi.hoisted(() => ({
  snapshotFileVersion: vi.fn(),
  snapshotFileVersionNow: vi.fn(async () => undefined)
}));

vi.mock("./versioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./versioning")>()),
  ...versioning
}));

vi.mock("./drafts", () => ({
  discardDraft: vi.fn(),
  flushDrafts: vi.fn(async () => undefined),
  moveDraftFor: vi.fn(),
  scheduleDraft: vi.fn(),
  moveFolderDraftsFor: vi.fn(),
  deleteFolderDraftsFor: vi.fn(),
  loadDraftDocuments: vi.fn(async () => ({}))
}));

const { useAppStore } = await import("@/store/useAppStore");
const { EXTERNAL_CHANGE_TOLERANCE_MS, isExternallyModified } = await import("./documents");

const VAULT = "/vault";
const NOTE = "/vault/note.md";

describe("isExternallyModified", () => {
  it("is false within the tolerance and true beyond it", () => {
    expect(isExternallyModified(1_000, 1_000)).toBe(false);
    expect(isExternallyModified(1_000, 1_000 + EXTERNAL_CHANGE_TOLERANCE_MS)).toBe(false);
    expect(isExternallyModified(1_000, 1_000 + EXTERNAL_CHANGE_TOLERANCE_MS + 1)).toBe(true);
    // A clock or a sync client can also set the file *back*.
    expect(isExternallyModified(10_000, 1_000)).toBe(true);
  });

  // Nothing to compare is not a conflict: the save behaves as it always did.
  it("is false when either side is unknown or the file is gone", () => {
    expect(isExternallyModified(undefined, 5_000)).toBe(false);
    expect(isExternallyModified(null, 5_000)).toBe(false);
    expect(isExternallyModified(1_000, null)).toBe(false);
  });
});

describe("saveSelectedFile with an external change", () => {
  beforeEach(() => {
    disk.content = "# Note\n";
    disk.mtimeMs = 1_000;
    vi.clearAllMocks();

    useAppStore.setState({
      folderPath: VAULT,
      filePaths: [NOTE],
      emptyFolderPaths: [],
      fileDocuments: { [NOTE]: { content: "# Note\n\nmine", baseContent: "# Note\n", baseMtimeMs: 1_000 } },
      selectedFilePath: NOTE,
      selectedFileContent: "# Note\n\nmine",
      selectedFileBaseContent: "# Note\n",
      isDirty: true,
      saveConflict: null,
      manualOrder: {}
    });
  });

  it("saves when the file is as it was read, and adopts the written mtime", async () => {
    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);

    expect(fsMock.writeMarkdownFile).toHaveBeenCalledWith(NOTE, "# Note\n\nmine");
    const state = useAppStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.fileDocuments[NOTE].baseMtimeMs).toBe(11_000);
    expect(state.fileMtimeMs[NOTE]).toBe(11_000);
  });

  it("refuses a manual save over someone else's write and asks", async () => {
    disk.content = "# Note\n\ntheirs";
    disk.mtimeMs = 50_000;

    expect(await useAppStore.getState().saveSelectedFile()).toBe(false);

    expect(fsMock.writeMarkdownFile).not.toHaveBeenCalled();
    const state = useAppStore.getState();
    expect(state.saveConflict).toEqual({ filePath: NOTE });
    expect(state.isDirty).toBe(true);
    expect(state.isSaving).toBe(false);
    expect(state.saveError).toBeNull();
  });

  // A timer must not open a dialog mid-sentence.
  it("skips an auto-save over someone else's write without asking", async () => {
    disk.mtimeMs = 50_000;

    expect(await useAppStore.getState().saveSelectedFile({ trigger: "auto" })).toBe(false);

    expect(fsMock.writeMarkdownFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().saveConflict).toBeNull();
    expect(useAppStore.getState().isDirty).toBe(true);
  });

  it("overwrites on force, with the disk version snapshotted first", async () => {
    disk.content = "# Note\n\ntheirs";
    disk.mtimeMs = 50_000;
    await useAppStore.getState().saveSelectedFile();

    expect(await useAppStore.getState().saveSelectedFile({ force: true })).toBe(true);

    expect(versioning.snapshotFileVersionNow).toHaveBeenCalledWith(VAULT, NOTE, "# Note\n\ntheirs");
    expect(versioning.snapshotFileVersionNow.mock.invocationCallOrder[0]).toBeLessThan(
      fsMock.writeMarkdownFile.mock.invocationCallOrder[0]
    );
    expect(disk.content).toBe("# Note\n\nmine");
    expect(useAppStore.getState().saveConflict).toBeNull();
    expect(useAppStore.getState().isDirty).toBe(false);
  });

  it("dismissSaveConflict leaves the document dirty", async () => {
    disk.mtimeMs = 50_000;
    await useAppStore.getState().saveSelectedFile();

    useAppStore.getState().dismissSaveConflict();

    expect(useAppStore.getState().saveConflict).toBeNull();
    expect(useAppStore.getState().isDirty).toBe(true);
    expect(disk.content).toBe("# Note\n");
  });

  // A note the app has never read from disk with an mtime (created by a
  // write, restored draft of an unwritten folder note) saves as before.
  it("saves without a baseline mtime", async () => {
    useAppStore.setState({
      fileDocuments: { [NOTE]: { content: "# Note\n\nmine", baseContent: "# Note\n" } }
    });
    disk.mtimeMs = 50_000;

    expect(await useAppStore.getState().saveSelectedFile()).toBe(true);
    expect(useAppStore.getState().saveConflict).toBeNull();
  });
});
