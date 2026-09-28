import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, string>());
const dirs = vi.hoisted(() => new Set<string>());
vi.mock("@/platform/paths", () => ({
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
}));
vi.mock("@/lib/fileSystem", () => ({ getRelativeDisplayPath: (root: string, path: string) => path.slice(root.length + 1) }));
vi.mock("@/lib/fileVersions", () => ({ deleteFileVersions: vi.fn(async () => undefined) }));
vi.mock("@/platform/vaultFs", () => ({
  exists: async (path: string) => files.has(path) || dirs.has(path),
  stat: async (path: string) => {
    if (!files.has(path) && !dirs.has(path)) throw new Error("missing item");
    return { isDirectory: dirs.has(path), isFile: files.has(path), isSymlink: false };
  },
  mkdir: async (path: string) => {
    const parts = path.split("/");
    for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  },
  readDir: async (path: string) => [...dirs, ...files.keys()]
    .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
    .map((key) => ({ name: key.slice(path.length + 1), isDirectory: dirs.has(key), isFile: files.has(key), isSymlink: false })),
  readTextFile: async (path: string) => files.get(path) ?? "",
  writeTextFile: async (path: string, content: string) => { files.set(path, content); },
  remove: async (path: string) => {
    for (const key of [...files.keys()]) if (key === path || key.startsWith(`${path}/`)) files.delete(key);
    for (const key of [...dirs]) if (key === path || key.startsWith(`${path}/`)) dirs.delete(key);
  },
  rename: async (from: string, to: string) => {
    if (!files.has(from) && !dirs.has(from)) throw new Error("missing item");
    for (const [key, value] of [...files]) if (key === from || key.startsWith(`${from}/`)) { files.set(to + key.slice(from.length), value); files.delete(key); }
    for (const key of [...dirs]) if (key === from || key.startsWith(`${from}/`)) { dirs.add(to + key.slice(from.length)); dirs.delete(key); }
  }
}));

const { trashNote, listTrashedNotes, restoreTrashedNote, permanentlyDeleteTrashedNote, listTrashedChildren } = await import("./noteTrash");

describe("vault note trash", () => {
  beforeEach(() => { vi.clearAllMocks(); files.clear(); dirs.clear(); dirs.add("/vault"); dirs.add("/vault/Ideas"); files.set("/vault/Ideas/Note.md", "# Markdown stays readable\n"); });

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


describe("folder trash", () => {
  beforeEach(() => {
    vi.clearAllMocks(); files.clear(); dirs.clear();
    for (const path of ["/vault", "/vault/Project", "/vault/Project/Nested", "/vault/Project/Empty"]) dirs.add(path);
    files.set("/vault/Project/One.md", "# One");
    files.set("/vault/Project/Nested/Two.md", "# Two");
    files.set("/vault/Project/Nested/image.png", "image bytes");
  });

  it("keeps the full tree, attachments and empty folders when restored as a whole", async () => {
    await trashNote("/vault", "/vault/Project", "folder");
    expect(dirs.has("/vault/Project")).toBe(false);
    const [entry] = await listTrashedNotes("/vault");
    expect((await listTrashedChildren("/vault", entry)).map((item) => item.name)).toEqual(["Empty", "Nested", "One.md"]);
    await restoreTrashedNote("/vault", entry);
    expect(files.get("/vault/Project/Nested/Two.md")).toBe("# Two");
    expect(files.get("/vault/Project/Nested/image.png")).toBe("image bytes");
    expect(dirs.has("/vault/Project/Empty")).toBe(true);
    expect(await listTrashedNotes("/vault")).toEqual([]);
  });

  it("restores a single file, then a subfolder, then merges the rest of the folder", async () => {
    await trashNote("/vault", "/vault/Project", "folder");
    const [entry] = await listTrashedNotes("/vault");
    await restoreTrashedNote("/vault", entry, "Nested/Two.md");
    expect(files.get("/vault/Project/Nested/Two.md")).toBe("# Two");
    expect(files.has("/vault/Project/One.md")).toBe(false);
    await restoreTrashedNote("/vault", entry, "Nested");
    expect(files.get("/vault/Project/Nested/image.png")).toBe("image bytes");
    await restoreTrashedNote("/vault", entry);
    expect(files.get("/vault/Project/One.md")).toBe("# One");
    expect(await listTrashedNotes("/vault")).toEqual([]);
  });

  it("checks every conflict before moving any part of a folder", async () => {
    await trashNote("/vault", "/vault/Project", "folder");
    const [entry] = await listTrashedNotes("/vault");
    dirs.add("/vault/Project"); dirs.add("/vault/Project/Nested");
    files.set("/vault/Project/Nested/Two.md", "new content");
    await expect(restoreTrashedNote("/vault", entry)).rejects.toThrow("already exists");
    expect(files.has("/vault/Project/One.md")).toBe(false);
    expect(files.get("/vault/Project/Nested/Two.md")).toBe("new content");
    expect(await listTrashedChildren("/vault", entry)).toHaveLength(3);
  });

  it("retains restored version histories when the remaining folder is deleted permanently", async () => {
    const { deleteFileVersions } = await import("@/lib/fileVersions");
    await trashNote("/vault", "/vault/Project", "folder");
    const [entry] = await listTrashedNotes("/vault");
    await restoreTrashedNote("/vault", entry, "One.md");
    expect(deleteFileVersions).not.toHaveBeenCalled();
    await permanentlyDeleteTrashedNote("/vault", entry);
    expect(deleteFileVersions).toHaveBeenCalledWith("/vault", "Project/Nested/Two.md");
    expect(deleteFileVersions).not.toHaveBeenCalledWith("/vault", "Project/One.md");
    expect(files.get("/vault/Project/One.md")).toBe("# One");
    expect(await listTrashedNotes("/vault")).toEqual([]);
  });

  it("rejects paths outside the trashed folder", async () => {
    await trashNote("/vault", "/vault/Project", "folder");
    const [entry] = await listTrashedNotes("/vault");
    await expect(restoreTrashedNote("/vault", entry, "../outside.md")).rejects.toThrow("Invalid trash path");
  });
});
