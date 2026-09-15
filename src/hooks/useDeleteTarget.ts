import { useState } from "react";
import { join } from "@tauri-apps/api/path";

import type { BatchEntry } from "@/components/FileTree";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { getFolderNoteFolderPath, isFolderNotePath } from "@/lib/folderNotes";

export type DeleteTarget =
  | { kind: "file" | "folder"; path: string }
  | { kind: "multiple"; paths: Array<{ kind: "file" | "folder"; path: string }> };

type UseDeleteTargetOptions = {
  folderPath: string | null;
  selectedFilePath: string | null;
  fileTreeSelection: BatchEntry[];
  deleteFilePath: (filePath: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
};

export function useDeleteTarget({
  folderPath,
  selectedFilePath,
  fileTreeSelection,
  deleteFilePath,
  deleteFolderPath
}: UseDeleteTargetOptions) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const requestDeleteFile = (filePath: string) => {
    setDeleteTarget({ kind: "file", path: filePath });
  };

  const requestDeleteFolder = (targetFolderPath: string) => {
    setDeleteTarget({ kind: "folder", path: targetFolderPath });
  };

  const requestDeleteMultiple = (paths: Array<{ kind: "file" | "folder"; path: string }>) => {
    if (paths.length === 0) {
      return;
    }

    if (paths.length === 1) {
      setDeleteTarget(paths[0]);
      return;
    }

    setDeleteTarget({ kind: "multiple", paths });
  };

  // Toolbar delete button: acts on the file tree's current multi-selection
  // (fileTreeSelection) rather than just the single file open in the editor,
  // so it stays consistent with the context menu's batch delete.
  const requestDeleteFromToolbar = () => {
    if (fileTreeSelection.length === 0) {
      if (selectedFilePath) {
        requestDeleteFile(selectedFilePath);
      }
      return;
    }

    if (!folderPath) {
      return;
    }

    // An open folder note has the folder row as its row in the tree. Deleting
    // from the toolbar then means the note that is on screen, not the folder
    // with everything in it — the folder itself is deleted from its own
    // context menu, where the choice is explicit.
    if (
      fileTreeSelection.length === 1 &&
      fileTreeSelection[0].kind === "folder" &&
      selectedFilePath &&
      isFolderNotePath(selectedFilePath) &&
      getFolderNoteFolderPath(getRelativeDisplayPath(folderPath, selectedFilePath)) ===
        fileTreeSelection[0].path
    ) {
      requestDeleteFile(selectedFilePath);
      return;
    }

    void Promise.all(
      fileTreeSelection.map(async (entry) => ({
        kind: entry.kind,
        path: entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
      }))
    ).then(requestDeleteMultiple);
  };

  const cancelDeleteTarget = () => {
    if (isDeleting) {
      return;
    }

    setDeleteTarget(null);
  };

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) {
      return;
    }

    setIsDeleting(true);

    if (deleteTarget.kind === "multiple") {
      // Sequential: each store call reads fresh state via get(), so parallel
      // calls would clobber each other's writes.
      for (const entry of deleteTarget.paths) {
        await (entry.kind === "file" ? deleteFilePath(entry.path) : deleteFolderPath(entry.path));
      }

      setIsDeleting(false);
      setDeleteTarget(null);
      return;
    }

    const didDelete =
      deleteTarget.kind === "file"
        ? await deleteFilePath(deleteTarget.path)
        : await deleteFolderPath(deleteTarget.path);
    setIsDeleting(false);

    if (didDelete) {
      setDeleteTarget(null);
    }
  };

  return {
    deleteTarget,
    isDeleting,
    requestDeleteFile,
    requestDeleteFolder,
    requestDeleteMultiple,
    requestDeleteFromToolbar,
    cancelDeleteTarget,
    confirmDeleteTarget
  };
}
