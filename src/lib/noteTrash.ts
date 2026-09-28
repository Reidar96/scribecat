import { dirname, join } from "@/platform/paths";
import { exists, mkdir, readDir, readTextFile, remove, rename, writeTextFile } from "@/platform/vaultFs";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { deleteFileVersions } from "@/lib/fileVersions";

export type TrashedNote = { id: string; relativePath: string; deletedAt: string };

async function trashFolder(root: string): Promise<string> {
  return join(root, ".scribecat", "trash");
}

export async function trashNote(root: string, filePath: string): Promise<void> {
  const folder = await trashFolder(root);
  await mkdir(folder, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const metadata = await join(folder, `${id}.json`);
  const target = await join(folder, `${id}.md`);
  await writeTextFile(metadata, JSON.stringify({ id, relativePath: getRelativeDisplayPath(root, filePath), deletedAt: new Date().toISOString() }));
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
        return parsed.id && parsed.relativePath && await exists(await join(folder, `${parsed.id}.md`)) ? parsed : null;
      } catch { return null; }
    }));
  return notes.filter((note): note is TrashedNote => note !== null).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restoreTrashedNote(root: string, note: TrashedNote): Promise<string> {
  const target = await join(root, ...note.relativePath.split("/").filter(Boolean));
  if (await exists(target)) throw new Error(`A note already exists at ${note.relativePath}`);
  await mkdir(await dirname(target), { recursive: true });
  const folder = await trashFolder(root);
  await rename(await join(folder, `${note.id}.md`), target);
  await remove(await join(folder, `${note.id}.json`));
  return target;
}

export async function permanentlyDeleteTrashedNote(root: string, note: TrashedNote): Promise<void> {
  const folder = await trashFolder(root);
  await remove(await join(folder, `${note.id}.md`));
  await remove(await join(folder, `${note.id}.json`));
  await deleteFileVersions(root, note.relativePath);
}
