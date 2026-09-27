import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/"), dirname: async (p: string) => p.slice(0, p.lastIndexOf("/")) }));
vi.mock("@/lib/fileSystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fileSystem")>()),
  readMarkdownFile: vi.fn(), readMarkdownFileMtime: vi.fn(async () => 1)
}));
const { readMarkdownFile } = await import("@/lib/fileSystem");
const { useAppStore } = await import("@/store/useAppStore");
const note = "/vault/note.md";
function deferred() { let resolve!: (s: string) => void; const promise = new Promise<string>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.mocked(readMarkdownFile).mockReset(); useAppStore.setState({ folderPath: "/vault", fileDocuments: {}, selectedFilePath: null, fileError: null }); });
describe("pending document reads", () => {
  it.each(["loadFileDocument", "selectFilePath"] as const)("%s ignores an old vault's response", async method => {
    const read = deferred(); vi.mocked(readMarkdownFile).mockReturnValueOnce(read.promise);
    const loading = useAppStore.getState()[method](note);
    useAppStore.setState({ folderPath: "/other-vault", fileDocuments: {}, selectedFilePath: null });
    read.resolve("old vault text"); await loading;
    expect(useAppStore.getState().fileDocuments).toEqual({});
  });
  it.each(["loadFileDocument", "selectFilePath"] as const)("%s cannot overwrite edits with a slower duplicate read", async method => {
    const slow = deferred(); vi.mocked(readMarkdownFile).mockReturnValueOnce(slow.promise).mockResolvedValueOnce("saved");
    const pending = useAppStore.getState()[method](note);
    await useAppStore.getState().selectFilePath(note);
    useAppStore.getState().updateSelectedFileContent("unsaved edits");
    slow.resolve("stale"); await pending;
    expect(useAppStore.getState().fileDocuments[note].content).toBe("unsaved edits");
    expect(useAppStore.getState().selectedFileContent).toBe("unsaved edits");
  });
});
