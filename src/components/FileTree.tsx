import { useCallback, useEffect, useMemo, useRef } from "react";
import { BookOpen, Download, FileDown, FilePlus, FolderArchive, FolderInput, Pencil, Printer, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import { dirname, join } from "@/platform/paths";
import { carriesExternalFiles } from "@/lib/dragDrop/droppedSources";
import { cn } from "@/lib/utils";

import type { ExportMode } from "@/components/ExportDialog";
import {
  normalizeVaultPath,
  stagedChangeKind,
  vaultPathKey
} from "@/lib/chat/vaultStaging";
import { canDownloadFolderArchive, canDownloadMarkdown } from "@/lib/export/markdownDownload";
import { getRelativeDisplayPath, type MarkdownFileRecord } from "@/lib/fileSystem";
import { buildFileTree, type FileTreeFolderNode, type FileTreeNode } from "@/lib/fileTree";
import { getFolderNoteFolderPath, isFolderNotePath } from "@/lib/folderNotes";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useStagedChangesStore } from "@/store/useStagedChangesStore";

import { ContextMenuSurface } from "./fileTree/ContextMenuSurface";
import { TreeNodeRow } from "./fileTree/TreeNodeRow";
import { useExpandedFolders } from "./fileTree/useExpandedFolders";
import { useTreeContextMenu } from "./fileTree/useTreeContextMenu";
import { TREE_TAIL_KEY, useTreeDragDrop } from "./fileTree/useTreeDragDrop";
import { useTreeRename } from "./fileTree/useTreeRename";
import { useTreeSelection } from "./fileTree/useTreeSelection";
import {
  buildFolderMatchCounts,
  buildNodeContextMap,
  collectMatchingFolderPaths,
  computeRangeKeys,
  flattenVisibleNodes,
  getNodeKey,
  getTopLevelSelection
} from "./fileTree/treeNavigation";
import type { BatchEntry, PendingFolderRename } from "./fileTree/types";

export type { BatchEntry, PendingFolderRename } from "./fileTree/types";

type FileTreeProps = {
  folderPath: string;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  pendingFolderRename?: PendingFolderRename | null;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  onSelectFilePath: (filePath: string) => Promise<void>;
  /** Absolute folder path; the store resolves the note inside it. */
  onOpenFolderNote: (folderPath: string) => Promise<void>;
  onCreateFileRequest: (targetDirectory: string) => void;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  /** The note as the .md it is; offered only where the vault is not on this machine. */
  onDownloadMarkdownRequest: (filePath: string) => void;
  /** The folder's raw files as a ZIP, packed by the storage; same condition. */
  onDownloadFolderArchiveRequest: (folderPath: string, archiveName: string) => void;
  onPrintFileRequest: (filePath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  /** "Move to…" from the context menu; entries carry absolute paths. */
  onMoveRequest: (entries: BatchEntry[]) => void;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
  onRequestEditorFocus?: () => void;
  focusRequestId?: number;
  onSelectionChange?: (entries: BatchEntry[]) => void;
};

export function FileTree({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  pendingFolderRename,
  sortMode,
  manualOrder,
  fileMtimeMs,
  emptyFolderMtimeMs,
  onSelectFilePath,
  onOpenFolderNote,
  onCreateFileRequest,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onDownloadMarkdownRequest,
  onDownloadFolderArchiveRequest,
  onPrintFileRequest,
  onRenameFolder,
  onRenameFile,
  onMoveEntry,
  onMoveRequest,
  onDeleteMultipleRequest,
  onExportMultipleRequest,
  onRequestEditorFocus,
  focusRequestId,
  onSelectionChange
}: FileTreeProps) {
  const { t } = useTranslation();
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  // The rendered export needs somewhere to go: a folder on this machine or
  // the platform's download. The raw Markdown is only worth a menu entry
  // where the file manager cannot do the job (browser, server vault).
  const offersExport = platform.features.exportFiles || platform.features.downloads;
  const offersMarkdownDownload = canDownloadMarkdown(folderPath);
  const offersFolderArchive = canDownloadFolderArchive(folderPath);
  const { expandedFolderPaths, toggleFolder, expandAncestorsOf, expandFolders } =
    useExpandedFolders(folderPath);
  const { contextMenu, setContextMenu } = useTreeContextMenu();
  const fileMatchCounts = useSearchStore((state) => state.fileMatchCounts);
  const lastHandledFolderRenameRequestIdRef = useRef<number | undefined>(undefined);

  const stagedChanges = useStagedChangesStore((state) => state.changes);
  // Folder notes on: a click on a folder's name opens its note and only the
  // chevron toggles it. Off: the whole row toggles, as it always has.
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);

  // What the agent has proposed, indexed the way the rows need it.
  //
  // Files it proposes to CREATE do not exist on disk yet, so they are not in
  // filePaths — they are folded into the tree as records of their own, greyed
  // out and with the paw. Leaving them out would mean the one kind of change a
  // user most wants to look at before applying is the one they cannot find.
  const staged = useMemo(() => {
    const separator = folderPath.includes("\\") ? "\\" : "/";
    const toAbsolute = (relativePath: string) =>
      `${folderPath}${separator}${normalizeVaultPath(relativePath).split("/").join(separator)}`;

    const changedFilePaths: Record<string, number> = {};
    const deletedKeys = new Set<string>();
    const createdRecords: MarkdownFileRecord[] = [];

    for (const change of stagedChanges) {
      const kind = stagedChangeKind(change);

      if (kind === "create") {
        const filePath = toAbsolute(change.targetPath);

        createdRecords.push({
          filePath,
          relativePath: normalizeVaultPath(change.targetPath),
          mtimeMs: 0
        });
        changedFilePaths[filePath] = 1;
        continue;
      }

      const filePath = toAbsolute(change.path);
      changedFilePaths[filePath] = 1;

      if (kind === "delete") {
        deletedKeys.add(vaultPathKey(filePath));
      }
    }

    return {
      changedFilePaths,
      changedKeys: new Set(Object.keys(changedFilePaths).map(vaultPathKey)),
      createdKeys: new Set(createdRecords.map((record) => vaultPathKey(record.filePath))),
      deletedKeys,
      createdRecords
    };
  }, [folderPath, stagedChanges]);

  const treeNodes = useMemo(() => {
    const records: MarkdownFileRecord[] = filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: fileMtimeMs[filePath] ?? 0
    }));

    // Only the ones the tree does not already know: a file created and applied
    // in the same session is in filePaths by now.
    const known = new Set(records.map((record) => vaultPathKey(record.relativePath)));

    for (const record of staged.createdRecords) {
      if (!known.has(vaultPathKey(record.relativePath))) {
        records.push(record);
      }
    }
    const emptyFolderRelativePaths = emptyFolderPaths.map((emptyFolderPath) =>
      getRelativeDisplayPath(folderPath, emptyFolderPath)
    );
    const emptyFolderOwnMtimeMs: Record<string, number> = {};

    emptyFolderPaths.forEach((emptyFolderPath) => {
      emptyFolderOwnMtimeMs[getRelativeDisplayPath(folderPath, emptyFolderPath)] =
        emptyFolderMtimeMs[emptyFolderPath] ?? 0;
    });

    return buildFileTree(records, emptyFolderRelativePaths, {
      sortMode,
      manualOrder,
      emptyFolderOwnMtimeMs
    });
  }, [
    folderPath,
    filePaths,
    emptyFolderPaths,
    fileMtimeMs,
    emptyFolderMtimeMs,
    sortMode,
    manualOrder,
    staged
  ]);

  const nodeContextByKey = useMemo(() => buildNodeContextMap(treeNodes), [treeNodes]);

  // The open note and the unsaved ones, translated to the folder rows that
  // stand in for them when they are folder notes (relative folder paths).
  const activeFolderNotePath = useMemo(() => {
    if (!selectedFilePath) {
      return null;
    }

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);

    return isFolderNotePath(relativePath) ? getFolderNoteFolderPath(relativePath) || null : null;
  }, [folderPath, selectedFilePath]);

  const dirtyFolderNotePaths = useMemo(
    () =>
      new Set(
        dirtyFilePaths
          .map((filePath) => getRelativeDisplayPath(folderPath, filePath))
          .filter(isFolderNotePath)
          .map(getFolderNoteFolderPath)
      ),
    [folderPath, dirtyFilePaths]
  );

  const folderMatchCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, fileMatchCounts),
    [treeNodes, fileMatchCounts]
  );

  // Same aggregation for the paw: a collapsed folder has to say that something
  // inside it is waiting, and no row can work that out without re-walking its
  // own subtree on every render.
  const folderStagedCounts = useMemo(
    () => buildFolderMatchCounts(treeNodes, staged.changedFilePaths),
    [treeNodes, staged]
  );

  const flatNodes = useMemo(
    () => flattenVisibleNodes(treeNodes, expandedFolderPaths),
    [treeNodes, expandedFolderPaths]
  );

  const {
    activeKey,
    setActiveKey,
    rangeFocusKey,
    setRangeFocusKey,
    selectedKeys,
    setSelectedKeys,
    registerItemRef,
    focusItem,
    resolveBatchEntries
  } = useTreeSelection({
    folderPath,
    selectedFilePath,
    treeNodes,
    flatNodes,
    focusRequestId,
    onSelectionChange
  });

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), [setSelectedKeys]);

  const {
    dragSourceKeys,
    dropIndicator,
    handleRowDragStart,
    handleRowDropIndicatorChange,
    handleRowDragEnd,
    handleRowDrop,
    handleTailDrop
  } = useTreeDragDrop({
    folderPath,
    flatNodes,
    nodeContextByKey,
    selectedKeys,
    clearSelection,
    onMoveEntry
  });

  const {
    renamingTarget,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    startFileRename,
    startFolderRename,
    commitRename,
    cancelRename
  } = useTreeRename({ folderPath, onRenameFolder, onRenameFile });

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);

    // Opening a folder's note reveals the folder, not its contents: the
    // ancestors of the folder are expanded, the folder itself is left as it is
    // — a click on the name is not a request to unfold it.
    expandAncestorsOf(
      isFolderNotePath(relativePath) ? getFolderNoteFolderPath(relativePath) : relativePath
    );
  }, [folderPath, selectedFilePath, expandAncestorsOf]);

  // After creating a new folder (sidebar button), switch straight into
  // rename mode, mirroring the title rename for new files.
  useEffect(() => {
    if (!pendingFolderRename) {
      return;
    }

    if (lastHandledFolderRenameRequestIdRef.current === pendingFolderRename.requestId) {
      return;
    }

    lastHandledFolderRenameRequestIdRef.current = pendingFolderRename.requestId;

    const relativePath = getRelativeDisplayPath(folderPath, pendingFolderRename.folderPath);

    expandAncestorsOf(relativePath);
    startFolderRename(relativePath);
  }, [pendingFolderRename, folderPath, expandAncestorsOf, startFolderRename]);

  // While a project-wide search is running, opening a collapsed folder that
  // carries hits unfolds its whole matching subtree at once — the badge only
  // says "something below matches", so one click has to get the user there
  // instead of one level per click. Collapsing stays a plain toggle.
  const toggleFolderNode = (node: FileTreeFolderNode) => {
    const matchingFolderPaths =
      expandedFolderPaths.has(node.relativePath) || !folderMatchCounts[node.relativePath]
        ? []
        : collectMatchingFolderPaths(node, folderMatchCounts);

    if (matchingFolderPaths.length > 0) {
      expandFolders(matchingFolderPaths);
    } else {
      toggleFolder(node.relativePath);
    }
  };

  const openFolderNoteOf = (node: FileTreeFolderNode) => {
    void join(folderPath, node.relativePath).then(onOpenFolderNote);
  };

  const handleRowClick = (node: FileTreeNode, event: React.MouseEvent) => {
    const key = getNodeKey(node);

    if (event.ctrlKey || event.metaKey) {
      setSelectedKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);

        if (nextKeys.has(key)) {
          nextKeys.delete(key);
        } else {
          nextKeys.add(key);
        }

        return nextKeys;
      });
      setActiveKey(key);
      setRangeFocusKey(null);
      return;
    }

    if (event.shiftKey) {
      setSelectedKeys(computeRangeKeys(flatNodes, activeKey, key));
      setRangeFocusKey(key);

      if (node.kind === "file") {
        void onSelectFilePath(node.filePath);
      }
      return;
    }

    setActiveKey(key);
    setRangeFocusKey(null);

    if (node.kind === "folder") {
      // A plain click toggles the folder — it is not a request to select it,
      // so unlike the file branch below this does not touch selectedKeys.
      // Selecting a folder is still possible (Ctrl/Shift-click above, right-
      // click for the context menu below), it just does not happen as a side
      // effect of every expand/collapse, or the folder would stay marked
      // long after the click that opened it.
      // With folder notes on, the name opens the folder's note instead and the
      // chevron (its own click target in the row) is what toggles.
      if (folderNotesEnabled) {
        openFolderNoteOf(node);
      } else {
        toggleFolderNode(node);
      }
    } else {
      setSelectedKeys(new Set([key]));
      void onSelectFilePath(node.filePath);
    }
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flatNodes.length === 0) {
        return;
      }

      event.preventDefault();

      const anchorForMovement = event.shiftKey ? (rangeFocusKey ?? activeKey) : activeKey;
      const currentIndex = anchorForMovement
        ? flatNodes.findIndex((node) => getNodeKey(node) === anchorForMovement)
        : -1;

      const nextIndex =
        currentIndex === -1
          ? 0
          : Math.min(
              Math.max(currentIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
              flatNodes.length - 1
            );

      const nextNode = flatNodes[nextIndex];
      const nextKey = getNodeKey(nextNode);

      focusItem(nextKey);

      if (event.shiftKey) {
        setSelectedKeys(computeRangeKeys(flatNodes, activeKey, nextKey));
        setRangeFocusKey(nextKey);
        return;
      }

      setActiveKey(nextKey);
      setSelectedKeys(new Set([nextKey]));
      setRangeFocusKey(null);

      if (nextNode.kind === "file") {
        void onSelectFilePath(nextNode.filePath);
      }
      return;
    }

    // Left/right on a folder unfold and fold it, the way every tree control
    // does — and with folder notes on this is the only keyboard way to, since
    // Enter/Space on the row then open the note. On an expanded folder, right
    // steps into the first child; left on a collapsed folder or a file climbs
    // to the parent.
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && activeKey) {
      const activeNode = flatNodes.find((node) => getNodeKey(node) === activeKey);

      if (!activeNode) {
        return;
      }

      event.preventDefault();

      const moveTo = (targetKey: string) => {
        focusItem(targetKey);
        setActiveKey(targetKey);
        setSelectedKeys(new Set([targetKey]));
        setRangeFocusKey(null);
      };
      const isExpandedFolder =
        activeNode.kind === "folder" && expandedFolderPaths.has(activeNode.relativePath);

      if (event.key === "ArrowRight") {
        if (activeNode.kind !== "folder") {
          return;
        }

        if (!isExpandedFolder) {
          toggleFolder(activeNode.relativePath);
        } else if (activeNode.children[0]) {
          moveTo(getNodeKey(activeNode.children[0]));
        }

        return;
      }

      if (isExpandedFolder) {
        toggleFolder(activeNode.relativePath);
        return;
      }

      const parentRelativePath = nodeContextByKey.get(activeKey)?.parentRelativePath;

      if (parentRelativePath) {
        moveTo(`folder:${parentRelativePath}`);
      }

      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      onRequestEditorFocus?.();
    }

    if (event.key === "F2" && capabilities.rename) {
      if (!activeKey) {
        return;
      }

      const activeNode = flatNodes.find((node) => getNodeKey(node) === activeKey);

      if (!activeNode) {
        return;
      }

      event.preventDefault();

      if (activeNode.kind === "folder") {
        startFolderRename(activeNode.relativePath);
      } else {
        startFileRename(activeNode.relativePath);
      }
    }

    if (event.key === "Delete") {
      const keysToDelete: string[] =
        selectedKeys.size > 1 ? [...selectedKeys] : activeKey ? [activeKey] : [];

      if (keysToDelete.length === 0) {
        return;
      }

      event.preventDefault();

      void resolveBatchEntries(keysToDelete).then(onDeleteMultipleRequest);
    }
  };

  // What a drag out of the tree carries: the dragged file, or — when it is part
  // of a multi-selection — every selected file. Folders carry nothing, since
  // only files can be linked in a document.
  const resolveDragFilePaths = useCallback(
    (node: FileTreeNode): string[] => {
      if (node.kind !== "file") {
        return [];
      }

      const key = getNodeKey(node);

      if (!selectedKeys.has(key) || selectedKeys.size <= 1) {
        return [node.filePath];
      }

      return flatNodes.flatMap((candidate) =>
        candidate.kind === "file" && selectedKeys.has(getNodeKey(candidate))
          ? [candidate.filePath]
          : []
      );
    },
    [flatNodes, selectedKeys]
  );

  const handleRowContextMenu = (node: FileTreeNode, x: number, y: number) => {
    const key = getNodeKey(node);

    if (selectedKeys.has(key) && selectedKeys.size > 1) {
      setContextMenu({ kind: "multiple", keys: [...selectedKeys], x, y });
      return;
    }

    setSelectedKeys(new Set([key]));
    setActiveKey(key);
    setRangeFocusKey(null);

    if (node.kind === "folder") {
      setContextMenu({ kind: "folder", relativePath: node.relativePath, x, y });
    } else {
      setContextMenu({ kind: "file", filePath: node.filePath, x, y });
    }
  };

  // The context menu's batch actions all start from the same list: the
  // top-level entries of the selection, folders resolved to absolute paths.
  const resolveSelectedEntries = (keys: string[]) =>
    Promise.all(
      getTopLevelSelection(keys, flatNodes).map(
        async (node): Promise<BatchEntry> => ({
          kind: node.kind,
          path: node.kind === "file" ? node.filePath : await join(folderPath, node.relativePath)
        })
      )
    );

  const contextMenuTitle =
    contextMenu === null
      ? undefined
      : contextMenu.kind === "multiple"
        ? t("fileTree.selectionCount", { count: getTopLevelSelection(contextMenu.keys, flatNodes).length })
        : contextMenu.kind === "folder"
          ? contextMenu.relativePath.slice(contextMenu.relativePath.lastIndexOf("/") + 1)
          : getRelativeDisplayPath(folderPath, contextMenu.filePath).split("/").pop();

  return (
    <>
      <ul
        role="tree"
        className="file-tree"
        aria-label={t("fileTree.treeLabel")}
        onKeyDown={handleTreeKeyDown}
      >
        {treeNodes.map((node) => (
          <TreeNodeRow
            key={node.relativePath}
            node={node}
            depth={0}
            expandedFolderPaths={expandedFolderPaths}
            folderMatchCounts={folderMatchCounts}
            folderStagedCounts={folderStagedCounts}
            stagedKeys={staged.changedKeys}
            stagedCreatedKeys={staged.createdKeys}
            stagedDeletedKeys={staged.deletedKeys}
            selectedFilePath={selectedFilePath}
            selectedKeys={selectedKeys}
            dirtyFilePaths={dirtyFilePaths}
            folderNotesEnabled={folderNotesEnabled}
            activeFolderNotePath={activeFolderNotePath}
            dirtyFolderNotePaths={dirtyFolderNotePaths}
            activeKey={activeKey}
            renamingTarget={renamingTarget}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            sortMode={sortMode}
            dragSourceKeys={dragSourceKeys}
            dropIndicator={dropIndicator}
            onRowClick={handleRowClick}
            onToggleFolder={toggleFolderNode}
            onRowContextMenu={handleRowContextMenu}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={() => void commitRename()}
            onCancelRename={cancelRename}
            registerItemRef={registerItemRef}
            onRowDragStart={handleRowDragStart}
            onRowDropIndicatorChange={handleRowDropIndicatorChange}
            onRowDrop={handleRowDrop}
            onRowDragEnd={handleRowDragEnd}
            resolveDragFilePaths={resolveDragFilePaths}
          />
        ))}
      </ul>

      {sortMode === "manual" && capabilities.move && dragSourceKeys.length > 0 ? (
        <div
          className={cn(
            "file-tree__tail",
            dropIndicator?.key === TREE_TAIL_KEY && "file-tree__tail--drop"
          )}
          aria-hidden="true"
          onDragOver={(event) => {
            if (carriesExternalFiles(event.dataTransfer)) {
              return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            handleRowDropIndicatorChange(TREE_TAIL_KEY, "below");
          }}
          onDragLeave={() => handleRowDropIndicatorChange(TREE_TAIL_KEY, null)}
          onDrop={(event) => {
            if (carriesExternalFiles(event.dataTransfer)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleTailDrop();
          }}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenuTitle}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === "multiple" ? (
            <>
              {offersExport ? (["standard", "manuscript"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    const entries = getTopLevelSelection(contextMenu.keys, flatNodes).map(
                      (node): BatchEntry => ({
                        kind: node.kind,
                        path: node.kind === "file" ? node.filePath : node.relativePath
                      })
                    );

                    void Promise.all(
                      entries.map(async (entry) => ({
                        kind: entry.kind,
                        path:
                          entry.kind === "folder"
                            ? await join(folderPath, entry.path)
                            : entry.path
                      }))
                    ).then((resolved) => onExportMultipleRequest(resolved, mode));

                    setContextMenu(null);
                  }}
                >
                  {mode === "manuscript" ? (
                    <BookOpen aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {t(mode === "manuscript" ? "fileTree.exportManuscript" : "fileTree.export")}
                </button>
              )) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.move}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => {
                  void resolveSelectedEntries(contextMenu.keys).then(onMoveRequest);
                  setContextMenu(null);
                }}
              >
                <FolderInput aria-hidden="true" />
                {t("fileTree.moveTo")}
              </button>

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                disabled={!capabilities.delete}
                title={capabilities.delete ? undefined : capabilityHint}
                onClick={() => {
                  const entries = getTopLevelSelection(contextMenu.keys, flatNodes).map(
                    (node): BatchEntry => ({
                      kind: node.kind,
                      path: node.kind === "file" ? node.filePath : node.relativePath
                    })
                  );

                  void Promise.all(
                    entries.map(async (entry) => ({
                      kind: entry.kind,
                      path:
                        entry.kind === "folder" ? await join(folderPath, entry.path) : entry.path
                    }))
                  ).then(onDeleteMultipleRequest);

                  setContextMenu(null);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t("fileTree.delete")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.create}
                title={capabilities.create ? undefined : capabilityHint}
                onClick={() => {
                  const targetDirectoryPromise =
                    contextMenu.kind === "folder"
                      ? join(folderPath, contextMenu.relativePath)
                      : dirname(contextMenu.filePath);

                  void targetDirectoryPromise.then(onCreateFileRequest);
                  setContextMenu(null);
                }}
              >
                <FilePlus aria-hidden="true" />
                {t("sidebar.newFile")}
              </button>

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.rename}
                title={capabilities.rename ? undefined : capabilityHint}
                onClick={() => {
                  if (contextMenu.kind === "folder") {
                    startFolderRename(contextMenu.relativePath);
                  } else {
                    startFileRename(getRelativeDisplayPath(folderPath, contextMenu.filePath));
                  }

                  setContextMenu(null);
                }}
              >
                <Pencil aria-hidden="true" />
                {t("fileTree.rename")}
              </button>

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.move}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => {
                  if (contextMenu.kind === "folder") {
                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onMoveRequest([{ kind: "folder", path }])
                    );
                  } else {
                    onMoveRequest([{ kind: "file", path: contextMenu.filePath }]);
                  }

                  setContextMenu(null);
                }}
              >
                <FolderInput aria-hidden="true" />
                {t("fileTree.moveTo")}
              </button>

              {offersExport ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      if (contextMenu.kind === "folder") {
                        void join(folderPath, contextMenu.relativePath).then((path) =>
                          onExportFolderRequest(path, "standard")
                        );
                      } else {
                        onExportFileRequest(contextMenu.filePath, "standard");
                      }
    
                      setContextMenu(null);
                    }}
                  >
                    <Download aria-hidden="true" />
                    {t("fileTree.export")}
                  </button>
    
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      if (contextMenu.kind === "folder") {
                        void join(folderPath, contextMenu.relativePath).then((path) =>
                          onExportFolderRequest(path, "manuscript")
                        );
                      } else {
                        onExportFileRequest(contextMenu.filePath, "manuscript");
                      }
    
                      setContextMenu(null);
                    }}
                  >
                    <BookOpen aria-hidden="true" />
                    {t("fileTree.exportManuscript")}
                  </button>
                </>
              ) : null}

              {contextMenu.kind === "file" && offersMarkdownDownload ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    onDownloadMarkdownRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <FileDown aria-hidden="true" />
                  {t("fileTree.downloadMarkdown")}
                </button>
              ) : null}

              {contextMenu.kind === "folder" && offersFolderArchive ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    const archiveName = contextMenu.relativePath.split("/").pop() ?? contextMenu.relativePath;

                    void join(folderPath, contextMenu.relativePath).then((path) =>
                      onDownloadFolderArchiveRequest(path, archiveName)
                    );
                    setContextMenu(null);
                  }}
                >
                  <FolderArchive aria-hidden="true" />
                  {t("fileTree.downloadFolderArchive")}
                </button>
              ) : null}

              {contextMenu.kind === "file" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    onPrintFileRequest(contextMenu.filePath);
                    setContextMenu(null);
                  }}
                >
                  <Printer aria-hidden="true" />
                  {t("fileTree.print")}
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                disabled={!capabilities.delete}
                title={capabilities.delete ? undefined : capabilityHint}
                onClick={() => {
                  if (contextMenu.kind === "folder") {
                    void join(folderPath, contextMenu.relativePath).then(onDeleteFolderRequest);
                  } else {
                    onDeleteFileRequest(contextMenu.filePath);
                  }

                  setContextMenu(null);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t("fileTree.delete")}
              </button>
            </>
          )}
        </ContextMenuSurface>
      ) : null}
    </>
  );
}
