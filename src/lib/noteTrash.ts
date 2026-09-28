import { dirname, join } from "@/platform/paths";
import { exists, mkdir, readDir, readTextFile, remove, rename, stat, writeTextFile } from "@/platform/vaultFs";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { deleteFileVersions } from "@/lib/fileVersions";

export type TrashedNote = { id: string; relativePath: string; deletedAt: string; kind?: "file" | "folder" };
export type TrashedChild = { subpath: string; name: string; kind: "file" | "folder" };

function safeRelative(path: string): string {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid trash path");
  return path;
}

async function payloadPath(root: string, note: TrashedNote): Promise<string> {
  if (!/^[\w-]+$/.test(note.id)) throw new Error("Invalid trash entry");
  return join(await trashFolder(root), `${note.id}.${note.kind === "folder" ? "folder" : "md"}`);
}

async function trashFolder(root: string): Promise<string> {
  return join(root, ".scribecat", "trash");
}

export async function trashNote(root: string, filePath: string, kind: "file" | "folder" = "file"): Promise<void> {
  const folder = await trashFolder(root);
  await mkdir(folder, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const metadata = await join(folder, `${id}.json`);
  const target = await join(folder, `${id}.${kind === "folder" ? "folder" : "md"}`);
  await writeTextFile(metadata, JSON.stringify({ id, kind, relativePath: safeRelative(getRelativeDisplayPath(root, filePath)), deletedAt: new Date().toISOString() }));
  try { await rename(filePath, target); }
  catch (error) { await remove(metadata).catch(() => undefined); throw error; }
}

export async function listTrashedNotes(root: string): Promise<TrashedNote[]> {
  const folder = await trashFolder(root);
  if (!(await exists(folder))) return [];
  const entries = await readDir(folder);
  const notes = await Promise.all(entries.filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .map(async (entry) => {
      try {
        const parsed = JSON.parse(await readTextFile(await join(folder, entry.name))) as TrashedNote;
        safeRelative(parsed.relativePath);
        return parsed.id === entry.name.slice(0, -5) && typeof parsed.deletedAt === "string" && await exists(await payloadPath(root, parsed)) ? parsed : null;
      } catch { return null; }
    }));
  return notes.filter((note): note is TrashedNote => note !== null).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function listTrashedChildren(root: string, note: TrashedNote, subpath = ""): Promise<TrashedChild[]> {
  if (note.kind !== "folder") return [];
  const path = subpath ? await join(await payloadPath(root, note), safeRelative(subpath)) : await payloadPath(root, note);
  return (await readDir(path)).filter((entry) => !entry.isSymlink && (entry.isFile || entry.isDirectory)).map((entry) => ({
    subpath: subpath ? `${subpath}/${entry.name}` : entry.name, name: entry.name, kind: entry.isDirectory ? "folder" as const : "file" as const
  })).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1);
}

async function checkRestore(source: string, target: string): Promise<void> {
  if (!(await exists(target))) return;
  const sourceInfo = await stat(source);
  const targetInfo = await stat(target);
  if (!sourceInfo.isDirectory || !targetInfo.isDirectory || sourceInfo.isSymlink || targetInfo.isSymlink) throw new Error(`An item already exists at ${target}`);
  for (const child of await readDir(source)) await checkRestore(await join(source, child.name), await join(target, child.name));
}

async function restorePath(source: string, target: string): Promise<void> {
  if (!(await exists(target))) { await rename(source, target); return; }
  for (const child of await readDir(source)) await restorePath(await join(source, child.name), await join(target, child.name));
  await remove(source, { recursive: true });
}

export async function restoreTrashedNote(root: string, note: TrashedNote, subpath = ""): Promise<string> {
  const relative = safeRelative(note.relativePath) + (subpath ? `/${safeRelative(subpath)}` : "");
  const target = await join(root, relative);
  const source = subpath ? await join(await payloadPath(root, note), subpath) : await payloadPath(root, note);
  await checkRestore(source, target);
  await mkdir(await dirname(target), { recursive: true });
  await restorePath(source, target);
  if (!subpath) await remove(await join(await trashFolder(root), `${note.id}.json`));
  return target;
}

export async function permanentlyDeleteTrashedNote(root: string, note: TrashedNote): Promise<void> {
  const folder = await trashFolder(root);
  const payload = await payloadPath(root, note);
  const deleteHistory = async (path: string, relative: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory) {
      for (const child of await readDir(path)) if (!child.isSymlink) await deleteHistory(await join(path, child.name), `${relative}/${child.name}`);
    } else if (!(await exists(await join(root, relative)))) await deleteFileVersions(root, relative);
  };
  await deleteHistory(payload, safeRelative(note.relativePath));
  await remove(payload, { recursive: note.kind === "folder" });
  await remove(await join(folder, `${note.id}.json`));
}
