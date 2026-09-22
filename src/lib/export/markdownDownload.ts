import { getVaultStorage, platform } from "@/platform";
import { isRemoteVaultPath } from "@/platform/remote/vaultRoot";

import { getDefaultExportBaseName, sanitizeExportName } from "./exporter";
import { mimeTypeFor } from "./zipArchive";

/**
 * Getting the notes themselves out, as the `.md` files they already are.
 *
 * ScribeCat has no "export to Markdown", because on the desktop the file
 * manager is that export. The two cases where the notes are somewhere the
 * user cannot open in a file manager are the browser and a server vault
 * opened from the desktop app; only there do these actions earn a place in
 * the menus, next to a local folder they would be a slower Explorer.
 */

/** True when the open vault's files are not on this machine. */
export function notesLiveElsewhere(folderPath: string | null): boolean {
  return platform.localFs === null || (folderPath !== null && isRemoteVaultPath(folderPath));
}

export function canDownloadMarkdown(folderPath: string | null): boolean {
  return platform.downloads !== null && notesLiveElsewhere(folderPath);
}

/** The ZIP needs the storage to pack the folder (a server route); see VaultStorage.packFolder. */
export function canDownloadFolderArchive(folderPath: string | null): boolean {
  return canDownloadMarkdown(folderPath) && getVaultStorage().packFolder !== null;
}

/** Hands the note's text to the platform as `<name>.md`; false if the user cancelled a save dialog. */
export async function downloadNoteAsMarkdown(filePath: string, markdown: string): Promise<boolean> {
  if (!platform.downloads) {
    return false;
  }

  const fileName = `${sanitizeExportName(getDefaultExportBaseName(filePath))}.md`;

  return platform.downloads.saveFile({ fileName, data: markdown, mimeType: mimeTypeFor(fileName) });
}

/**
 * The folder (or the whole vault, when `folderPath` is its root) as a ZIP
 * of its raw files, packed by the storage. `archiveName` is what the file is
 * called; the vault root has no usable name of its own, so the caller
 * passes one.
 */
export async function downloadFolderAsArchive(folderPath: string, archiveName: string): Promise<boolean> {
  const packFolder = getVaultStorage().packFolder;

  if (!platform.downloads || !packFolder) {
    return false;
  }

  const fileName = `${sanitizeExportName(archiveName)}.zip`;
  const data = await packFolder(folderPath);

  return platform.downloads.saveFile({ fileName, data, mimeType: mimeTypeFor(fileName) });
}
