import { strToU8, zipSync, type Zippable } from "fflate";

/**
 * The ZIP an export is packed into when there is no folder to write to (the
 * browser, or the desktop's save dialog): one entry per rendered note, paths
 * with forward slashes, no leading folder. Built in memory, which is fine
 * for a vault of notes and matches how the EPUB and ODT writers already use
 * fflate.
 */

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  epub: "application/epub+zip",
  html: "text/html",
  md: "text/markdown",
  zip: "application/zip"
};

/** The content type a download is declared with; opaque bytes for anything unknown. */
export function mimeTypeFor(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  return MIME_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Formats that are ZIP containers or otherwise compressed already; deflating
 * them again costs time and saves nothing.
 */
const STORED_EXTENSIONS = new Set(["pdf", "docx", "odt", "epub", "zip"]);

export type ArchiveEntries = Map<string, Uint8Array>;

export function createArchive(): ArchiveEntries {
  return new Map();
}

/**
 * Adds a file under `path` ("Sub/Note.pdf"), or under the next free name when
 * that path is taken: "Note (2).pdf", the way a file manager resolves the
 * same clash. Two notes with one name in different source folders end up
 * side by side in a multi-selection export, so this has to be decided here
 * rather than by silently overwriting. Returns the path actually used.
 */
export function addArchiveEntry(entries: ArchiveEntries, path: string, data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? strToU8(data) : data;
  let candidate = path;

  for (let attempt = 2; entries.has(candidate); attempt += 1) {
    const slash = path.lastIndexOf("/");
    const directory = slash === -1 ? "" : path.slice(0, slash + 1);
    const fileName = path.slice(slash + 1);
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : "";

    candidate = `${directory}${stem} (${attempt})${extension}`;
  }

  entries.set(candidate, bytes);

  return candidate;
}

export function buildZipArchive(entries: ArchiveEntries): Uint8Array {
  const archive: Zippable = {};

  for (const [path, bytes] of entries) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";

    archive[path] = STORED_EXTENSIONS.has(extension) ? [bytes, { level: 0 }] : bytes;
  }

  return zipSync(archive);
}
