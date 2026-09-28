import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, string>());
vi.mock("@/platform/paths", () => ({
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));
vi.mock("@/lib/fileSystem", () => ({ getRelativeDisplayPath: (root: string, path: string) => path.slice(root.length + 1) }));
vi.mock("@/lib/fileVersions", () => ({ deleteFileVersions: vi.fn(async () => undefined) }));
vi.mock("@/platform/vaultFs", () => ({
  exists: async (path: string) => files.has(path) || path === "/vault/.scribecat/trash",
  mkdir: vi.fn(async () => undefined),
  readDir: async (path: string) => [...files.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => ({ name: key.slice(path.length + 1), isFile: true })),
  readTextFile: async (path: string) => files.get(path) ?? "",
  writeTextFile: async (path: string, content: string) => { files.set(path, content); },
  remove: async (path: string) => { files.delete(path); },
  rename: async (from: string, to: string) => {
    if (!files.has(from)) throw new Error("missing file");
    files.set(to, files.get(from)!);
    files.delete(from);
  }
}));

const { trashNote, listTrashedNotes, restoreTrashedNote, permanentlyDeleteTrashedNote } = await import("./noteTrash");

describe("vault note trash", () => {
  beforeEach(() => { files.clear(); files.set("/vault/Ideas/Note.md", "# Markdown stays readable\n"); });

  it("moves Markdown to the trash and restores its original path", async () => {
    await trashNote("/vault", "/vault/Ideas/Note.md");
    expect(files.has("/vault/Ideas/Note.md")).toBe(false);
    const [note] = await listTrashedNotes("/vault");
    expect(note.relativePath).toBe("Ideas/Note.md");
    expect(files.get(`/vault/.scribecat/trash/${note.id}.md`)).toBe("# Markdown stays readable\n");
    await restoreTrashedNote("/vault", note);
    expect(files.get("/vault/Ideas/Note.md")).toBe("# Markdown stays readable\n");
    expect(await listTrashedNotes("/vault")).toEqual([]);
  });

  it("refuses to replace an existing note during restore", async () => {
    await trashNote("/vault", "/vault/Ideas/Note.md");
    const [note] = await listTrashedNotes("/vault");
    files.set("/vault/Ideas/Note.md", "new note");
    await expect(restoreTrashedNote("/vault", note)).rejects.toThrow("already exists");
    expect(files.get(`/vault/.scribecat/trash/${note.id}.md`)).toBe("# Markdown stays readable\n");
    await permanentlyDeleteTrashedNote("/vault", note);
    expect(await listTrashedNotes("/vault")).toEqual([]);
  });
});
