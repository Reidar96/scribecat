import { useState } from "react";

import type { MoveRequest } from "@/components/MoveToDialog";
import type { BatchEntry } from "@/components/FileTree";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { join } from "@/platform/paths";
import type { MoveTreeEntryInput } from "@/store/useAppStore";

type UseMoveTargetOptions = {
  folderPath: string | null;
  moveTreeEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
};

type PendingMove = MoveRequest & {
  /** Absolute paths, in the order they were selected. */
  entries: BatchEntry[];
};

/**
 * State behind the "Move to…" dialog. The move itself goes through the
 * store's moveTreeEntry, the same action a drop in the tree runs, so relative
 * image paths, version history and the manual order travel with the entry.
 */
export function useMoveTarget({ folderPath, moveTreeEntry }: UseMoveTargetOptions) {
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const requestMove = (entries: BatchEntry[]) => {
    if (!folderPath || entries.length === 0) {
      return;
    }

    const sources = entries.map((entry) => ({
      kind: entry.kind,
      relativePath: getRelativeDisplayPath(folderPath, entry.path)
    }));

    setPendingMove({
      entries,
      sources,
      label:
        entries.length === 1
          ? sources[0].relativePath.slice(sources[0].relativePath.lastIndexOf("/") + 1)
          : null
    });
  };

  const cancelMove = () => {
    if (!isMoving) {
      setPendingMove(null);
    }
  };

  const confirmMove = async (targetRelativePath: string) => {
    if (!pendingMove || !folderPath) {
      return;
    }

    setIsMoving(true);

    try {
      const targetParentDirectory = targetRelativePath
        ? await join(folderPath, targetRelativePath)
        : folderPath;

      // One after the other: each move rewrites the tree state the next one
      // starts from, and the store's own checks (name taken, folder into
      // itself) report per entry.
      for (const entry of pendingMove.entries) {
        await moveTreeEntry({
          kind: entry.kind,
          sourcePath: entry.path,
          targetParentDirectory,
          targetIndex: Number.MAX_SAFE_INTEGER
        });
      }
    } finally {
      setIsMoving(false);
      setPendingMove(null);
    }
  };

  return {
    moveRequest: pendingMove,
    isMoving,
    requestMove,
    cancelMove,
    confirmMove
  };
}
