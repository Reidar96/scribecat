import { readMarkdownFile } from "@/lib/fileSystem";
import { isFolderNotePath } from "@/lib/folderNotes";
import type { MarkdownFileRecord } from "@/platform/types";

import type { FileDocumentState } from "./types";

export function isDocumentDirty(document: FileDocumentState): boolean {
  return document.content !== document.baseContent;
}

/**
 * Filesystems round mtimes differently (FAT to two seconds, some sync clients
 * rewrite them on the way through), so the comparison has slack rather than
 * demanding equality.
 */
export const EXTERNAL_CHANGE_TOLERANCE_MS = 1_000;

/**
 * Whether the file on disk is a different one from the one the document was
 * read from. Unknown on either side (never looked up, file missing) is "no":
 * a missing file has nothing to protect, and a baseline nobody recorded
 * cannot be compared, so the save goes ahead as it always did.
 */
export function isExternallyModified(
  baseMtimeMs: number | null | undefined,
  currentMtimeMs: number | null | undefined,
  toleranceMs: number = EXTERNAL_CHANGE_TOLERANCE_MS
): boolean {
  if (baseMtimeMs == null || currentMtimeMs == null) {
    return false;
  }

  return Math.abs(currentMtimeMs - baseMtimeMs) > toleranceMs;
}

export function pruneDocumentsToCurrentFolder(
  fileDocuments: Record<string, FileDocumentState>,
  filePaths: string[],
  selectedFilePath: string | null
): Record<string, FileDocumentState> {
  const filePathSet = new Set(filePaths);
  // A folder note that has not been written yet is the same case, but only
  // while it is the one on screen: opened from the tree, empty and clean, and
  // nothing on disk until the first save. Unselected and clean it is dropped
  // like any other — reopening the folder starts it empty again anyway.
  const isOpenUnwrittenFolderNote = (filePath: string) =>
    filePath === selectedFilePath && isFolderNotePath(filePath);
  const nextDocuments: Record<string, FileDocumentState> = {};

  for (const [filePath, document] of Object.entries(fileDocuments)) {
    if (
      filePathSet.has(filePath) ||
      isDocumentDirty(document) ||
      isOpenUnwrittenFolderNote(filePath)
    ) {
      nextDocuments[filePath] = document;
    }
  }

  if (
    selectedFilePath &&
    !filePathSet.has(selectedFilePath) &&
    !isOpenUnwrittenFolderNote(selectedFilePath)
  ) {
    const selectedDocument = nextDocuments[selectedFilePath];

    if (!selectedDocument || !isDocumentDirty(selectedDocument)) {
      delete nextDocuments[selectedFilePath];
    }
  }

  return nextDocuments;
}

export async function refreshCleanDocumentsFromDisk(
  fileDocuments: Record<string, FileDocumentState>,
  markdownFiles: MarkdownFileRecord[]
): Promise<Record<string, FileDocumentState>> {
  const mtimeByPath = new Map(markdownFiles.map((record) => [record.filePath, record.mtimeMs]));
  const nextDocuments: Record<string, FileDocumentState> = { ...fileDocuments };
  const cleanPathsToReload = Object.entries(fileDocuments)
    .filter(([filePath, document]) => mtimeByPath.has(filePath) && !isDocumentDirty(document))
    .map(([filePath]) => filePath);

  await Promise.all(
    cleanPathsToReload.map(async (filePath) => {
      try {
        const markdown = await readMarkdownFile(filePath);
        nextDocuments[filePath] = {
          content: markdown,
          baseContent: markdown,
          baseMtimeMs: mtimeByPath.get(filePath) ?? null
        };
      } catch {
        delete nextDocuments[filePath];
      }
    })
  );

  return nextDocuments;
}
