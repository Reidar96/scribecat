import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  normalize: async (path: string) => path
}));

vi.mock("./drafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drafts")>()),
  flushDrafts: vi.fn(async () => undefined)
}));

const { useAppStore } = await import("@/store/useAppStore");

const NOTE = "/vault/Diary/day.md";

describe("clearSelectedFile", () => {
  beforeEach(() => {
    useAppStore.setState({
      folderPath: "/vault",
      filePaths: [NOTE],
      selectedFilePath: NOTE,
      selectedFileContent: "unsaved text",
      selectedFileBaseContent: "saved text",
      fileDocuments: {
        [NOTE]: { content: "unsaved text", baseContent: "saved text" }
      },
      isFileLoading: true,
      isSaving: true,
      isDirty: true,
      fileError: "old",
      saveError: "old",
      saveConflict: { filePath: NOTE }
    });
  });

  it("clears only the active editor mirror and keeps the document for later reopening", () => {
    useAppStore.getState().clearSelectedFile();

    const state = useAppStore.getState();
    expect(state.selectedFilePath).toBeNull();
    expect(state.selectedFileContent).toBeNull();
    expect(state.selectedFileBaseContent).toBeNull();
    expect(state.isFileLoading).toBe(false);
    expect(state.isSaving).toBe(false);
    expect(state.isDirty).toBe(false);
    expect(state.fileDocuments[NOTE]).toEqual({
      content: "unsaved text",
      baseContent: "saved text"
    });
  });
});
