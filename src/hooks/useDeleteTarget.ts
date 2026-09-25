import { useCallback, useEffect, useRef, useState } from "react";
import { join } from "@/platform/paths";

import type { BatchEntry } from "@/components/FileTree";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { getFolderNoteFolderPath, isFolderNotePath } from "@/lib/folderNotes";

export type DeleteTarget =
  | { kind: "file" | "folder"; path: string }
  | { kind: "multiple"; paths: Array<{ kind: "file" | "folder"; path: string }> };

type PendingDelete = {
  target: DeleteTarget;
  selectedFilePathBefore: string | null;
};

type UseDeleteTargetOptions = {
  folderPath: string | null;
  selectedFilePath: string | null;
  fileTreeSelection: BatchEntry[];
  deleteFilePath: (filePath: string) => Promise<boolean>;
  deleteFolderPath: (folderPath: string) => Promise<boolean>;
  onStageDelete?: (target: DeleteTarget) => void;
  onUndoDelete?: (target: DeleteTarget, selectedFilePathBefore: string | null) => void;
};

const UNDO_WINDOW_MS = 6_500;

export function useDeleteTarget({
  folderPath,
  selectedFilePath,
  fileTreeSelection,
  deleteFilePath,
  deleteFolderPath,
  onStageDelete,
  onUndoDelete
}: UseDeleteTargetOptions) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const executeDelete = useCallback(
    async (target: DeleteTarget) => {
      if (target.kind === "multiple") {
        // Sequential: each store call reads fresh state via get(), so parallel
        // calls would clobber each other's writes.
        for (const entry of target.paths) {
          await (entry.kind === "file"
            ? deleteFilePath(entry.path)
            : deleteFolderPath(entry.path));
        }
        return;
      }

      await (target.kind === "file"
        ? deleteFilePath(target.path)
        : deleteFolderPath(target.path));
    },
    [deleteFilePath, deleteFolderPath]
  );

  const finalizePendingDelete = useCallback(async () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    clearPendingTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    await executeDelete(pending.target);
  }, [clearPendingTimer, executeDelete]);

  useEffect(
    () => () => {
      // A staged delete is hidden from the UI immediately but kept on disk for
      // a short undo window. If the component is torn down (switching vault or
      // closing the app), commit it rather than silently forgetting the user's
      // confirmed delete.
      const pending = pendingDeleteRef.current;
      clearPendingTimer();
      if (pending) {
        void executeDelete(pending.target);
      }
    },
    [clearPendingTimer, executeDelete]
  );

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

    // Only one undo slot is shown. Confirming another delete commits the
    // previous one first so store writes remain sequential and deterministic.
    if (pendingDeleteRef.current) {
      await finalizePendingDelete();
    }

    const staged: PendingDelete = {
      target: deleteTarget,
      selectedFilePathBefore: selectedFilePath
    };

    pendingDeleteRef.current = staged;
    setPendingDelete(staged);
    setDeleteTarget(null);
    onStageDelete?.(staged.target);

    pendingTimerRef.current = window.setTimeout(() => {
      void finalizePendingDelete();
    }, UNDO_WINDOW_MS);

    setIsDeleting(false);
  };

  const undoPendingDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    clearPendingTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    onUndoDelete?.(pending.target, pending.selectedFilePathBefore);
  };

  return {
    deleteTarget,
    isDeleting,
    pendingDelete,
    requestDeleteFile,
    requestDeleteFolder,
    requestDeleteMultiple,
    requestDeleteFromToolbar,
    cancelDeleteTarget,
    confirmDeleteTarget,
    undoPendingDelete,
    finalizePendingDelete
  };
}
