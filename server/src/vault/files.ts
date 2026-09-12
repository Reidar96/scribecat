import { readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertVaultPath, resolveVaultFile, VaultPathError } from "./paths.js";

const VAULT_META_DIR_NAME = ".scribedog";

export type MarkdownFileRecord = {
  /** Vault-relative, forward slashes: "Notes/Idea.md". */
  relativePath: string;
  mtimeMs: number;
};

export type NoteContent = {
  relativePath: string;
  content: string;
  mtimeMs: number;
};

export class NoteNotFoundError extends Error {}

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/**
 * Mirrors collectMarkdownFiles in the desktop app's src/lib/fileSystem.ts:
 * recurse into real directories only (a symlinked directory could point
 * anywhere), skip the metadata directory, pick up .md files.
 */
async function collectMarkdownFiles(
  rootPath: string,
  currentPath: string,
  accumulator: MarkdownFileRecord[]
): Promise<void> {
  let entries: import("node:fs").Dirent[];

  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === VAULT_META_DIR_NAME) {
        continue;
      }

      await collectMarkdownFiles(rootPath, entryPath, accumulator);
      continue;
    }

    if (entry.isFile() && isMarkdownFile(entry.name)) {
      const mtimeMs = await stat(entryPath)
        .then((info) => info.mtimeMs)
        .catch(() => 0);

      accumulator.push({
        relativePath: path.relative(rootPath, entryPath).split(path.sep).join("/"),
        mtimeMs
      });
    }
  }
}

export type Vault = {
  /** The vault root with symlinks resolved; every path check compares against this. */
  readonly realPath: string;
  listMarkdownFiles(): Promise<MarkdownFileRecord[]>;
  readNote(rawPath: unknown): Promise<NoteContent>;
  /** Overwrites an existing note. Creating files is a later stage. */
  writeNote(rawPath: unknown, content: string): Promise<NoteContent>;
};

export async function openVault(vaultPath: string): Promise<Vault> {
  let realPath: string;

  try {
    realPath = await realpath(vaultPath);
  } catch {
    throw new Error(`Vault path "${vaultPath}" does not exist or is not accessible.`);
  }

  if (!(await stat(realPath)).isDirectory()) {
    throw new Error(`Vault path "${vaultPath}" is not a directory.`);
  }

  async function resolveExistingNote(rawPath: unknown): Promise<{ relativePath: string; absolutePath: string }> {
    const relativePath = assertVaultPath(rawPath);
    const absolutePath = await resolveVaultFile(realPath, relativePath);

    let info: import("node:fs").Stats;

    try {
      info = await stat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NoteNotFoundError(`"${relativePath}" does not exist.`);
      }

      throw error;
    }

    if (!info.isFile()) {
      throw new VaultPathError(`"${relativePath}" is not a file.`);
    }

    return { relativePath, absolutePath };
  }

  return {
    realPath,

    async listMarkdownFiles() {
      const accumulator: MarkdownFileRecord[] = [];
      await collectMarkdownFiles(realPath, realPath, accumulator);

      return accumulator.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true, sensitivity: "base" })
      );
    },

    async readNote(rawPath) {
      const { relativePath, absolutePath } = await resolveExistingNote(rawPath);
      const [content, info] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);

      return { relativePath, content, mtimeMs: info.mtimeMs };
    },

    async writeNote(rawPath, content) {
      const { relativePath, absolutePath } = await resolveExistingNote(rawPath);

      // Write-then-rename so a container stopped mid-write leaves the old note
      // intact rather than a truncated one.
      const tempPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${process.pid}.tmp`);
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, absolutePath);

      const info = await stat(absolutePath);

      return { relativePath, content, mtimeMs: info.mtimeMs };
    }
  };
}
