import { readMarkdownFile } from "@/lib/fileSystem";
import { isFolderNotePath } from "@/lib/folderNotes";

import { normalizePathKey } from "./pathUtils";
import { stagedOnlyPathKeys } from "./stagedPaths";
import type { FileDocumentState } from "./types";

export function isDocumentDirty(document: FileDocumentState): boolean {
  return document.content !== document.baseContent;
}

export function pruneDocumentsToCurrentFolder(
  fileDocuments: Record<string, FileDocumentState>,
  filePaths: string[],
  selectedFilePath: string | null
): Record<string, FileDocumentState> {
  const filePathSet = new Set(filePaths);
  // A note the agent has only proposed is not on disk, and its document is not
  // dirty either — so both rules below would throw it away, and the file the
  // user just opened to review would close itself on the next watcher tick.
  // "Not on disk" means deleted for every other file and "not written yet" for
  // this one, which is the whole distinction.
  const stagedOnly = stagedOnlyPathKeys();
  const isStagedOnly = (filePath: string) => stagedOnly.has(normalizePathKey(filePath));
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
      isStagedOnly(filePath) ||
      isOpenUnwrittenFolderNote(filePath)
    ) {
      nextDocuments[filePath] = document;
    }
  }

  if (
    selectedFilePath &&
    !filePathSet.has(selectedFilePath) &&
    !isStagedOnly(selectedFilePath) &&
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
  filePaths: string[]
): Promise<Record<string, FileDocumentState>> {
  const filePathSet = new Set(filePaths);
  const nextDocuments: Record<string, FileDocumentState> = { ...fileDocuments };
  const cleanPathsToReload = Object.entries(fileDocuments)
    .filter(([filePath, document]) => filePathSet.has(filePath) && !isDocumentDirty(document))
    .map(([filePath]) => filePath);

  await Promise.all(
    cleanPathsToReload.map(async (filePath) => {
      try {
        const markdown = await readMarkdownFile(filePath);
        nextDocuments[filePath] = {
          content: markdown,
          baseContent: markdown
        };
      } catch {
        delete nextDocuments[filePath];
      }
    })
  );

  return nextDocuments;
}
