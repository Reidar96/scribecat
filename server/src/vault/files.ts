import { lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertVaultPath, resolveVaultEntry, VaultPathError } from "./paths.js";

const VAULT_META_DIR_NAME = ".scribedog";

export type MarkdownFileRecord = {
  /** Vault-relative, forward slashes: "Notes/Idea.md". */
  relativePath: string;
  mtimeMs: number;
};

/** Mirrors `DirEntry` of the desktop app's filesystem layer. */
export type VaultDirectoryEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

/** Mirrors `FileInfo`; times as epoch milliseconds, null where unknown. */
export type VaultFileInfo = {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number | null;
  birthtimeMs: number | null;
};

export class NoteNotFoundError extends Error {}

/** An entry that does not exist (ENOENT). */
export class EntryNotFoundError extends Error {}

/** A target that is already there, or a directory that is not empty (EEXIST, ENOTEMPTY). */
export class EntryConflictError extends Error {}

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

function translateFsError(error: unknown, relativePath: string): never {
  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ENOENT") {
    throw new EntryNotFoundError(`"${relativePath}" does not exist.`);
  }

  if (code === "EEXIST" || code === "ENOTEMPTY") {
    throw new EntryConflictError(`"${relativePath}" already exists or is not empty.`);
  }

  if (code === "EISDIR" || code === "ERR_FS_EISDIR") {
    throw new VaultPathError(`"${relativePath}" is a folder, not a file.`);
  }

  if (code === "ENOTDIR") {
    throw new VaultPathError(`"${relativePath}" is not a folder.`);
  }

  throw error;
}

/**
 * The vault as the frontend's filesystem layer sees it: the primitives of
 * `VaultStorage` in src/platform/types.ts, plus the markdown listing. Every
 * path goes through assertVaultPath and resolveVaultEntry, which are the
 * security boundary; the methods themselves are thin wrappers over node:fs.
 */
export type Vault = {
  /** The vault root with symlinks resolved; every path check compares against this. */
  readonly realPath: string;
  listMarkdownFiles(): Promise<MarkdownFileRecord[]>;
  readDir(rawPath: unknown): Promise<VaultDirectoryEntry[]>;
  stat(rawPath: unknown): Promise<VaultFileInfo>;
  exists(rawPath: unknown): Promise<boolean>;
  mkdir(rawPath: unknown, recursive: boolean): Promise<void>;
  readText(rawPath: unknown): Promise<string>;
  /** Creates or overwrites; the parent folder must exist. */
  writeText(rawPath: unknown, content: string): Promise<{ mtimeMs: number }>;
  readBytes(rawPath: unknown): Promise<Buffer>;
  writeBytes(rawPath: unknown, data: Buffer): Promise<{ mtimeMs: number }>;
  rename(rawFrom: unknown, rawTo: unknown): Promise<void>;
  remove(rawPath: unknown, recursive: boolean): Promise<void>;
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

  async function resolve(rawPath: unknown, options: { allowRoot?: boolean } = {}) {
    const relativePath = assertVaultPath(rawPath, options);
    const absolutePath = await resolveVaultEntry(realPath, relativePath);

    return { relativePath, absolutePath };
  }

  // Write-then-rename so a container stopped mid-write leaves the old file
  // intact rather than a truncated one.
  async function writeAtomically(absolutePath: string, data: string | Buffer, relativePath: string) {
    const tempPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${process.pid}.tmp`);

    try {
      await writeFile(tempPath, data, typeof data === "string" ? "utf8" : undefined);
      await rename(tempPath, absolutePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      translateFsError(error, relativePath);
    }

    return { mtimeMs: (await stat(absolutePath)).mtimeMs };
  }

  /**
   * The root and the metadata directory itself never go away or get a new
   * name through the API: removing `.scribedog` would take the server's own
   * files with it, and the frontend never asks for either.
   */
  function assertMutableEntry(relativePath: string): void {
    if (relativePath === "" || relativePath.toLowerCase() === VAULT_META_DIR_NAME) {
      throw new VaultPathError(`"${relativePath || "/"}" cannot be renamed or removed.`);
    }
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

    async readDir(rawPath) {
      const { relativePath, absolutePath } = await resolve(rawPath, { allowRoot: true });

      try {
        const entries = await readdir(absolutePath, { withFileTypes: true });

        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymlink: entry.isSymbolicLink()
        }));
      } catch (error) {
        return translateFsError(error, relativePath);
      }
    },

    async stat(rawPath) {
      const { relativePath, absolutePath } = await resolve(rawPath, { allowRoot: true });

      try {
        const [info, linkInfo] = await Promise.all([stat(absolutePath), lstat(absolutePath)]);

        return {
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          isSymlink: linkInfo.isSymbolicLink(),
          size: info.size,
          mtimeMs: info.mtimeMs,
          birthtimeMs: info.birthtimeMs > 0 ? info.birthtimeMs : null
        };
      } catch (error) {
        return translateFsError(error, relativePath);
      }
    },

    async exists(rawPath) {
      const { absolutePath } = await resolve(rawPath, { allowRoot: true });

      try {
        await lstat(absolutePath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }

        throw error;
      }
    },

    async mkdir(rawPath, recursive) {
      const { relativePath, absolutePath } = await resolve(rawPath);

      try {
        await mkdir(absolutePath, { recursive });
      } catch (error) {
        translateFsError(error, relativePath);
      }
    },

    async readText(rawPath) {
      const { relativePath, absolutePath } = await resolve(rawPath);

      try {
        return await readFile(absolutePath, "utf8");
      } catch (error) {
        return translateFsError(error, relativePath);
      }
    },

    async writeText(rawPath, content) {
      const { relativePath, absolutePath } = await resolve(rawPath);

      return writeAtomically(absolutePath, content, relativePath);
    },

    async readBytes(rawPath) {
      const { relativePath, absolutePath } = await resolve(rawPath);

      try {
        return await readFile(absolutePath);
      } catch (error) {
        return translateFsError(error, relativePath);
      }
    },

    async writeBytes(rawPath, data) {
      const { relativePath, absolutePath } = await resolve(rawPath);

      return writeAtomically(absolutePath, data, relativePath);
    },

    async rename(rawFrom, rawTo) {
      const from = await resolve(rawFrom);
      const to = await resolve(rawTo);
      assertMutableEntry(from.relativePath);
      assertMutableEntry(to.relativePath);

      // Like the desktop app's rename (std::fs::rename): a file at the target
      // is replaced, a folder must not exist there. The frontend checks for a
      // free name first and only ever moves within the vault.
      try {
        await rename(from.absolutePath, to.absolutePath);
      } catch (error) {
        translateFsError(error, from.relativePath);
      }
    },

    async remove(rawPath, recursive) {
      const { relativePath, absolutePath } = await resolve(rawPath);
      assertMutableEntry(relativePath);

      // Like the desktop app's remove (std::fs): a folder goes only when
      // recursive is asked for or it is empty; a file goes either way.
      try {
        const info = await lstat(absolutePath);

        if (info.isDirectory()) {
          if (recursive) {
            await rm(absolutePath, { recursive: true, force: false });
          } else {
            await rmdir(absolutePath);
          }
        } else {
          await rm(absolutePath, { force: false });
        }
      } catch (error) {
        translateFsError(error, relativePath);
      }
    }
  };
}
