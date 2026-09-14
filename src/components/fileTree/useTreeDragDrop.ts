import { useCallback, useState } from "react";

import { join } from "@/platform/paths";

import { isDescendantRelativePath, type FileTreeNode } from "@/lib/fileTree";
import type { MoveTreeEntryInput } from "@/store/useAppStore";

import { getNodeKey, getTopLevelSelection, type NodeContext } from "./treeNavigation";
import type { DropIndicator, DropPosition } from "./types";

type UseTreeDragDropOptions = {
  folderPath: string;
  flatNodes: FileTreeNode[];
  nodeContextByKey: Map<string, NodeContext>;
  selectedKeys: Set<string>;
  clearSelection: () => void;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
};

/** Indicator key of the drop zone below the last row (see handleTailDrop). */
export const TREE_TAIL_KEY = "__tree-tail__";

/** Drag & drop reordering and moving, active in manual sort mode only. */
export function useTreeDragDrop({
  folderPath,
  flatNodes,
  nodeContextByKey,
  selectedKeys,
  clearSelection,
  onMoveEntry
}: UseTreeDragDropOptions) {
  const [dragSourceKeys, setDragSourceKeys] = useState<string[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const handleRowDragStart = useCallback(
    (node: FileTreeNode) => {
      const key = getNodeKey(node);

      if (selectedKeys.has(key) && selectedKeys.size > 1) {
        setDragSourceKeys([...selectedKeys]);
      } else {
        setDragSourceKeys([key]);
      }
    },
    [selectedKeys]
  );

  const handleRowDropIndicatorChange = useCallback((key: string, position: DropPosition | null) => {
    setDropIndicator((current) => {
      if (position === null) {
        return current?.key === key ? null : current;
      }

      if (current?.key === key && current.position === position) {
        return current;
      }

      return { key, position };
    });
  }, []);

  const handleRowDragEnd = useCallback(() => {
    setDragSourceKeys([]);
    setDropIndicator(null);
  }, []);

  const handleRowDrop = useCallback(
    (targetNode: FileTreeNode, position: DropPosition) => {
      const sourceKeys = dragSourceKeys;
      setDragSourceKeys([]);
      setDropIndicator(null);

      if (sourceKeys.length === 0) {
        return;
      }

      const targetKey = getNodeKey(targetNode);

      if (sourceKeys.includes(targetKey)) {
        return;
      }

      const topLevelSourceNodes = getTopLevelSelection(sourceKeys, flatNodes);

      if (
        topLevelSourceNodes.some(
          (sourceNode) =>
            sourceNode.kind === "folder" &&
            isDescendantRelativePath(sourceNode.relativePath, targetNode.relativePath)
        )
      ) {
        return;
      }

      void (async () => {
        let targetParentDirectory: string;
        let targetIndex: number;

        if (position === "into" && targetNode.kind === "folder") {
          targetParentDirectory = await join(folderPath, targetNode.relativePath);
          targetIndex = targetNode.children.length;
        } else {
          const context = nodeContextByKey.get(targetKey);

          if (!context) {
            return;
          }

          targetParentDirectory = context.parentRelativePath
            ? await join(folderPath, context.parentRelativePath)
            : folderPath;

          targetIndex = position === "above" ? context.indexInSiblings : context.indexInSiblings + 1;

          const firstSourceContext = nodeContextByKey.get(getNodeKey(topLevelSourceNodes[0]));

          if (
            firstSourceContext &&
            firstSourceContext.parentRelativePath === context.parentRelativePath &&
            firstSourceContext.indexInSiblings < context.indexInSiblings
          ) {
            targetIndex -= 1;
          }
        }

        // Sequential awaits: moveTreeEntry reads fresh state via get() per
        // call, so parallel calls would clobber each other's writes.
        for (const sourceNode of topLevelSourceNodes) {
          const sourcePath = await join(folderPath, sourceNode.relativePath);
          const didMove = await onMoveEntry({
            kind: sourceNode.kind,
            sourcePath,
            targetParentDirectory,
            targetIndex
          });

          if (didMove) {
            targetIndex += 1;
          }
        }

        clearSelection();
      })();
    },
    [clearSelection, dragSourceKeys, flatNodes, folderPath, nodeContextByKey, onMoveEntry]
  );

  // The strip below the last row: a drop there puts the entries at the end
  // of the top level. Without it a note in the last folder of the vault has
  // no way out of that folder by dragging once the folder is expanded, since
  // every row below the folder's own is one of its children.
  const handleTailDrop = useCallback(() => {
    const sourceKeys = dragSourceKeys;
    setDragSourceKeys([]);
    setDropIndicator(null);

    if (sourceKeys.length === 0) {
      return;
    }

    const topLevelSourceNodes = getTopLevelSelection(sourceKeys, flatNodes);

    void (async () => {
      for (const sourceNode of topLevelSourceNodes) {
        await onMoveEntry({
          kind: sourceNode.kind,
          sourcePath: await join(folderPath, sourceNode.relativePath),
          targetParentDirectory: folderPath,
          targetIndex: Number.MAX_SAFE_INTEGER
        });
      }

      clearSelection();
    })();
  }, [clearSelection, dragSourceKeys, flatNodes, folderPath, onMoveEntry]);

  return {
    dragSourceKeys,
    dropIndicator,
    handleRowDragStart,
    handleRowDropIndicatorChange,
    handleRowDragEnd,
    handleRowDrop,
    handleTailDrop
  };
}
