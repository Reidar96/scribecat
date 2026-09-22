import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import { assertVaultPath, resolveVaultEntry, VAULT_META_DIR_NAME, VaultPathError } from "./paths.js";

/**
 * A folder of the vault as a ZIP of its raw files, streamed. This is the
 * one way to get the notes themselves out of a browser: the frontend can
 * render a note into PDF or DOCX, but a folder tree it cannot write, and
 * the server has the files lying there anyway. The desktop app opening a
 * server vault uses the same route.
 *
 * What goes in: every regular file below the folder, notes and images and
 * whatever else the user keeps there, in real subdirectories. What stays
 * out: the `.scribecat/` metadata at every level (versions, checkpoints,
 * chat sessions, and the server's own `.scribecat/server/` with the
 * password hash), and anything reached through a symlink, which could
 * point anywhere on the disk. Skipping the whole metadata directory is
 * what keeps `.scribecat/server/` out of a recursive archive without a
 * second rule for it.
 */

export type ExportEntry = {
  /** Path inside the archive, forward slashes, relative to the exported folder. */
  archivePath: string;
  absolutePath: string;
};

/**
 * Formats that are compressed already (or are ZIPs themselves); deflating
 * them again costs CPU for nothing.
 */
const STORED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "zip", "pdf", "docx", "odt", "epub"]);

function isMetaDirectory(name: string): boolean {
  return name.toLowerCase() === VAULT_META_DIR_NAME;
}

async function collectEntries(folderPath: string, archivePrefix: string, accumulator: ExportEntry[]): Promise<void> {
  const entries = await readdir(folderPath, { withFileTypes: true });

  // A stable order makes two archives of the same folder identical.
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));

  for (const entry of entries) {
    // Dirent's isDirectory/isFile are false for a symlink, so a link is
    // neither followed nor listed.
    if (entry.isDirectory()) {
      if (isMetaDirectory(entry.name)) {
        continue;
      }

      await collectEntries(path.join(folderPath, entry.name), `${archivePrefix}${entry.name}/`, accumulator);
      continue;
    }

    if (entry.isFile()) {
      accumulator.push({ archivePath: `${archivePrefix}${entry.name}`, absolutePath: path.join(folderPath, entry.name) });
    }
  }
}

/**
 * Validates the folder the way every other route does (assertVaultPath,
 * resolveVaultEntry) and lists what the archive will contain. The vault
 * root ("") is allowed; a metadata directory is not, at any depth and in
 * any spelling, the same rule the walk below applies to what it finds.
 */
export async function collectExportEntries(vaultRealPath: string, rawPath: unknown): Promise<{ relativePath: string; entries: ExportEntry[] }> {
  const relativePath = assertVaultPath(rawPath, { allowRoot: true });

  if (relativePath.split("/").some(isMetaDirectory)) {
    throw new VaultPathError(`"${relativePath}" is the app's metadata, not notes, and is not exported.`);
  }

  const absolutePath = await resolveVaultEntry(vaultRealPath, relativePath);
  let info;

  try {
    info = await stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultPathError(`"${relativePath}" does not exist.`);
    }

    throw error;
  }

  if (!info.isDirectory()) {
    throw new VaultPathError(`"${relativePath}" is not a folder.`);
  }

  const entries: ExportEntry[] = [];
  await collectEntries(absolutePath, "", entries);

  return { relativePath, entries };
}

/**
 * The archive as a Node stream, one file at a time: each file is read in
 * chunks and fed to fflate's streaming writer, whose output is yielded as it
 * appears, so a vault with many images never sits in memory as a whole.
 * fflate's synchronous ZipDeflate is used deliberately: the async variant
 * spawns workers, and a note's worth of bytes deflates in microseconds.
 */
export function createZipStream(entries: ExportEntry[]): Readable {
  return Readable.from(zipChunks(entries));
}

async function* zipChunks(entries: ExportEntry[]): AsyncGenerator<Buffer> {
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;

  const zip = new Zip((error, chunk) => {
    if (error) {
      failure = error;
      return;
    }

    pending.push(chunk);
  });

  function* drain(): Generator<Buffer> {
    if (failure) {
      throw failure;
    }

    while (pending.length > 0) {
      yield Buffer.from(pending.shift() as Uint8Array);
    }
  }

  for (const entry of entries) {
    const extension = entry.archivePath.split(".").pop()?.toLowerCase() ?? "";
    const file = STORED_EXTENSIONS.has(extension) ? new ZipPassThrough(entry.archivePath) : new ZipDeflate(entry.archivePath, { level: 6 });

    file.mtime = (await stat(entry.absolutePath)).mtime;
    zip.add(file);

    for await (const chunk of createReadStream(entry.absolutePath)) {
      file.push(new Uint8Array(chunk as Buffer), false);
      yield* drain();
    }

    file.push(new Uint8Array(0), true);
    yield* drain();
  }

  zip.end();
  yield* drain();
}

/** "Notes" for "Projects/Notes", "vault" for the root. */
export function archiveBaseName(relativePath: string): string {
  return relativePath.split("/").pop() || "vault";
}
