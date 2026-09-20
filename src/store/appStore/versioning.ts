import { getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  createFileVersion,
  deleteFileVersions,
  deleteFolderVersions,
  moveFileVersions,
  moveFolderVersions
} from "@/lib/fileVersions";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

/**
 * Bridges the store slices to the version storage. Creating versions is gated
 * by the setting; keeping an *existing* history in sync with renames, moves
 * and deletions is not — turning versioning off only stops new snapshots, the
 * history that is already on disk must not rot.
 *
 * Every write of a vault markdown file is snapshotted, not just the save
 * path: file creation, project-wide replace, import and the image-path
 * rewrite after a move all change what is on disk, and each of them is a
 * state a user may want back. See writeMarkdownFile in lib/fileSystem.ts for
 * the list of call sites this has to stay in sync with.
 *
 * Every call is fire-and-forget: versioning must never slow down or fail a
 * save, a rename or a delete.
 */

/**
 * Auto-save writes after every pause in typing. Snapshotting each of those
 * would push the states worth going back to out of a capped history within
 * minutes, so throttled snapshots are taken at most this often per file. A
 * deliberate save resets the clock, since it is itself a snapshot.
 */
export const AUTO_SAVE_SNAPSHOT_INTERVAL_MS = 5 * 60_000;

const lastSnapshotAtByFile = new Map<string, number>();

export function snapshotFileVersion(
  folderPath: string | null,
  filePath: string,
  content: string,
  options?: { throttle?: boolean }
): void {
  const { versioningEnabled, maxVersionsPerFile } = useVersioningSettingsStore.getState();

  if (!folderPath || !versioningEnabled) {
    return;
  }

  const now = Date.now();
  const lastSnapshotAt = lastSnapshotAtByFile.get(filePath);

  if (
    options?.throttle &&
    lastSnapshotAt !== undefined &&
    now - lastSnapshotAt < AUTO_SAVE_SNAPSHOT_INTERVAL_MS
  ) {
    return;
  }

  lastSnapshotAtByFile.set(filePath, now);

  void createFileVersion(
    folderPath,
    getRelativeDisplayPath(folderPath, filePath),
    content,
    maxVersionsPerFile
  ).catch(() => undefined);
}

/**
 * The one snapshot that is awaited: the disk version about to be overwritten
 * by a save over an external change. Fire-and-forget would race the write it
 * is meant to protect against. Same gate as snapshotFileVersion, no throttle.
 */
export async function snapshotFileVersionNow(
  folderPath: string | null,
  filePath: string,
  content: string
): Promise<void> {
  const { versioningEnabled, maxVersionsPerFile } = useVersioningSettingsStore.getState();

  if (!folderPath || !versioningEnabled) {
    return;
  }

  await createFileVersion(
    folderPath,
    getRelativeDisplayPath(folderPath, filePath),
    content,
    maxVersionsPerFile
  ).catch(() => undefined);
}

export function moveFileVersionHistory(
  folderPath: string | null,
  oldFilePath: string,
  newFilePath: string
): void {
  if (!folderPath) {
    return;
  }

  void moveFileVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, oldFilePath),
    getRelativeDisplayPath(folderPath, newFilePath)
  ).catch(() => undefined);
}

export function moveFolderVersionHistory(
  folderPath: string | null,
  oldFolderPath: string,
  newFolderPath: string
): void {
  if (!folderPath) {
    return;
  }

  void moveFolderVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, oldFolderPath),
    getRelativeDisplayPath(folderPath, newFolderPath)
  ).catch(() => undefined);
}

export function deleteFileVersionHistory(folderPath: string | null, filePath: string): void {
  if (!folderPath) {
    return;
  }

  void deleteFileVersions(folderPath, getRelativeDisplayPath(folderPath, filePath)).catch(
    () => undefined
  );
}

export function deleteFolderVersionHistory(
  folderPath: string | null,
  deletedFolderPath: string
): void {
  if (!folderPath) {
    return;
  }

  void deleteFolderVersions(
    folderPath,
    getRelativeDisplayPath(folderPath, deletedFolderPath)
  ).catch(() => undefined);
}
