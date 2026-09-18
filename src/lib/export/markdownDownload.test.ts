import { beforeEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({
  localFs: null as object | null,
  downloads: null as { saveFile: ReturnType<typeof vi.fn> } | null,
  packFolder: null as ReturnType<typeof vi.fn> | null
}));

vi.mock("@/platform", () => ({
  platform: {
    get localFs() {
      return shell.localFs;
    },
    get downloads() {
      return shell.downloads;
    },
    vault: { allowFolderAccess: async () => undefined }
  },
  getVaultStorage: () => ({ packFolder: shell.packFolder }),
  requireLocalFs: () => {
    throw new Error("no local fs");
  },
  PlatformUnavailableError: class extends Error {}
}));

vi.mock("@/lib/fileSystem", () => ({ listMarkdownFiles: async () => [] }));

const { canDownloadFolderArchive, canDownloadMarkdown, downloadFolderAsArchive, downloadNoteAsMarkdown, notesLiveElsewhere } =
  await import("./markdownDownload");

describe("markdown downloads", () => {
  beforeEach(() => {
    shell.localFs = null;
    shell.downloads = { saveFile: vi.fn(async () => true) };
    shell.packFolder = vi.fn(async () => new Uint8Array([80, 75]));
  });

  it("is offered in the browser and for a server vault on the desktop, not for a local folder", () => {
    // Browser: no local filesystem at all.
    expect(notesLiveElsewhere("/vault")).toBe(true);
    expect(canDownloadMarkdown("/vault")).toBe(true);

    // Desktop: depends on where the open vault is.
    shell.localFs = {};
    expect(notesLiveElsewhere("C:\Notes")).toBe(false);
    expect(canDownloadMarkdown("C:\Notes")).toBe(false);
    expect(canDownloadMarkdown(null)).toBe(false);
    expect(notesLiveElsewhere("/@remote/notes.example.com")).toBe(true);
    expect(canDownloadMarkdown("/@remote/notes.example.com")).toBe(true);

    // A shell without downloads offers nothing, wherever the notes are.
    shell.localFs = null;
    shell.downloads = null;
    expect(canDownloadMarkdown("/vault")).toBe(false);
  });

  it("offers the archive only when the storage can pack a folder", () => {
    expect(canDownloadFolderArchive("/vault")).toBe(true);
    shell.packFolder = null;
    expect(canDownloadFolderArchive("/vault")).toBe(false);
  });

  it("downloads a note under its display name with the Markdown type", async () => {
    await expect(downloadNoteAsMarkdown("/vault/Notes/Idea: draft.md", "# Idea\n")).resolves.toBe(true);

    expect(shell.downloads?.saveFile).toHaveBeenCalledWith({
      fileName: "Idea_ draft.md",
      data: "# Idea\n",
      mimeType: "text/markdown"
    });
  });

  it("packs a folder through the storage and downloads it under the given name", async () => {
    await expect(downloadFolderAsArchive("/vault/Notes", "Notes")).resolves.toBe(true);

    expect(shell.packFolder).toHaveBeenCalledWith("/vault/Notes");
    expect(shell.downloads?.saveFile).toHaveBeenCalledWith({
      fileName: "Notes.zip",
      data: new Uint8Array([80, 75]),
      mimeType: "application/zip"
    });
  });

  it("reports a cancelled save dialog", async () => {
    shell.downloads = { saveFile: vi.fn(async () => false) };

    await expect(downloadNoteAsMarkdown("/vault/A.md", "")).resolves.toBe(false);
    await expect(downloadFolderAsArchive("/vault", "vault")).resolves.toBe(false);
  });
});
