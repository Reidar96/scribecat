import { useEffect, useMemo, useRef, useState } from "react";
import { platform } from "@/platform";
import { dirname, join } from "@/platform/paths";
import { useTranslation } from "react-i18next";

import type { EditorHandle } from "@/components/Editor";
import type { SettingsTab } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { AppDialogs } from "@/components/app/AppDialogs";
import { RemoteVaultDialog } from "@/components/remote/RemoteVaultDialog";
import { DocumentPanel } from "@/components/app/DocumentPanel";
import { CollectionPanel } from "@/components/app/CollectionPanel";
import { GraphPanel } from "@/components/app/GraphPanel";
import { JournalPanel } from "@/components/app/JournalPanel";
import { TasksPanel } from "@/components/app/TasksPanel";
import type { CollectionViewRequest } from "@/components/app/collectionTypes";
import { MobileSheet } from "@/components/app/MobileSheet";
import { ZenMode } from "@/components/app/ZenMode";
import type { BatchEntry, PendingEntryRename } from "@/components/FileTree";
import { useAppVersion } from "@/hooks/useAppVersion";
import { AUTO_SAVE_DELAY_MS, useAutoSave } from "@/hooks/useAutoSave";
import { useDeleteTarget } from "@/hooks/useDeleteTarget";
import { useDraftFlush } from "@/hooks/useDraftFlush";
import { useExportTarget } from "@/hooks/useExportTarget";
import { useFolderWatcher } from "@/hooks/useFolderWatcher";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useMoveTarget } from "@/hooks/useMoveTarget";
import { useRemoteVaultDialog } from "@/hooks/useRemoteVaultDialog";
import { useSidebarSwipe } from "@/hooks/useSidebarSwipe";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth
} from "@/hooks/useSidebarWidth";
import { useStartupFolder } from "@/hooks/useStartupFolder";
import { useTitleRename } from "@/hooks/useTitleRename";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useWorkingSetActions } from "@/hooks/useWorkingSetActions";
import { useWebviewZoom } from "@/hooks/useWebviewZoom";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { useZenMode } from "@/hooks/useZenMode";
import { getRecentFolderPaths, getRelativeDisplayPath } from "@/lib/fileSystem";
import {
  describeNotePath,
  getFolderNoteFolderPath,
  getFolderNotePath,
  isFolderNotePath
} from "@/lib/folderNotes";
import { getLastOpenedRelativePath, setLastOpenedRelativePath } from "@/lib/lastOpenedFile";
import { getZenFontScale } from "@/lib/zenFontZoom";
import { findStepIndex } from "@/lib/navigationHistory";
import { downloadFolderAsArchive, downloadNoteAsMarkdown } from "@/lib/export/markdownDownload";
import { printMarkdown } from "@/lib/print";
import type { FileVersion } from "@/lib/fileVersions";
import type { VersionDiffTarget } from "@/components/VersionDiffDialog";
import {
  carriesExternalFiles,
  collectDroppedSources,
  type DropPayload
} from "@/lib/dragDrop/droppedSources";
import { sourceFromPath } from "@/lib/import/convert";
import { IMPORT_FILE_EXTENSIONS, type ImportSource } from "@/lib/import/importer";
import { cn } from "@/lib/utils";
import { normalizePathKey } from "@/store/appStore/pathUtils";
import { isDocumentLocked as getDocumentLocked } from "@/lib/documentLocks";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useNavigationHistoryStore } from "@/store/useNavigationHistoryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

import "./App.css";

const SIDEBAR_VISIBLE_STORAGE_KEY = "scribecat-sidebar-visible";

function getStoredSidebarVisible(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_VISIBLE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function App() {
  const { t } = useTranslation();
  // Set right before a back/forward step so the history effect below moves the
  // position instead of recording the target as a new entry. Cleared once it is
  // consumed — or when the step is refused because an AI proposal is open.
  const navigationIntentRef = useRef<{ filePath: string; index: number } | null>(null);
  // A one-line, self-dismissing hint at the bottom of the window; the place
  // for "not now, because ..." answers that do not deserve a dialog.
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("application");
  const [versionDiffTarget, setVersionDiffTarget] = useState<VersionDiffTarget | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [importFileList, setImportFileList] = useState<ImportSource[] | null>(null);
  const [importTargetFolder, setImportTargetFolder] = useState<string | null>(null);
  // What a dropped folder contributed beyond the importable files themselves.
  const [importSkippedCount, setImportSkippedCount] = useState(0);
  const [importLimitReached, setImportLimitReached] = useState(false);
  const [importInsertAfterBasename, setImportInsertAfterBasename] = useState<string | null | undefined>(
    undefined
  );
  const [pendingEntryRename, setPendingEntryRename] = useState<PendingEntryRename | null>(
    null
  );
  const [editorFocusRequestId, setEditorFocusRequestId] = useState(0);
  const [sidebarFocusRequestId, setSidebarFocusRequestId] = useState(0);
  const [fileTreeSelection, setFileTreeSelection] = useState<BatchEntry[]>([]);
  const [entryClipboard, setEntryClipboard] = useState<BatchEntry[]>([]);
  // Phone layout only: the file list is a sheet over the document.
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(getStoredSidebarVisible);
  const [collectionView, setCollectionView] = useState<CollectionViewRequest | null>(null);
  const [graphViewOpen, setGraphViewOpen] = useState(false);
  const [journalViewOpen, setJournalViewOpen] = useState(false);
  const [tasksViewOpen, setTasksViewOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [secondaryFilePath, setSecondaryFilePath] = useState<string | null>(null);
  const appVersion = useAppVersion();
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const entryRenameRequestIdRef = useRef(0);
  // Set only by handleCreateFolder: the folder whose note should open once the
  // name is confirmed (folder notes on). Cleared by whoever consumes it.
  const pendingFolderNoteOpenRef = useRef<string | null>(null);

  const openFolder = useAppStore((state) => state.openFolder);
  const openFolderAtPath = useAppStore((state) => state.openFolderAtPath);
  const refreshFolderFiles = useAppStore((state) => state.refreshFolderFiles);
  const refreshDocumentLocks = useAppStore((state) => state.refreshDocumentLocks);
  const filePaths = useAppStore((state) => state.filePaths);
  const folderPath = useAppStore((state) => state.folderPath);
  const isLoading = useAppStore((state) => state.isLoading);
  const isFileLoading = useAppStore((state) => state.isFileLoading);
  const isSaving = useAppStore((state) => state.isSaving);
  const isDirty = useAppStore((state) => state.isDirty);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const selectedFileContent = useAppStore((state) => state.selectedFileContent);
  const fileDocuments = useAppStore((state) => state.fileDocuments);
  const folderError = useAppStore((state) => state.folderError);
  const fileError = useAppStore((state) => state.fileError);
  const saveError = useAppStore((state) => state.saveError);
  const saveConflict = useAppStore((state) => state.saveConflict);
  const dismissSaveConflict = useAppStore((state) => state.dismissSaveConflict);
  const workingSet = useAppStore((state) => state.workingSet);
  const pinWorkingSetEntry = useAppStore((state) => state.pinWorkingSetEntry);
  const unpinWorkingSetEntry = useAppStore((state) => state.unpinWorkingSetEntry);
  const closeSavedWorkingSetEntries = useAppStore((state) => state.closeSavedWorkingSetEntries);
  const discardFileChanges = useAppStore((state) => state.discardFileChanges);
  const workingSetActions = useWorkingSetActions();
  const selectFilePath = useAppStore((state) => state.selectFilePath);
  const loadFileDocument = useAppStore((state) => state.loadFileDocument);
  const updateFileContent = useAppStore((state) => state.updateFileContent);
  const clearSelectedFile = useAppStore((state) => state.clearSelectedFile);
  const openFolderNote = useAppStore((state) => state.openFolderNote);
  const updateSelectedFileContent = useAppStore(
    (state) => state.updateSelectedFileContent
  );
  const adoptCanonicalFileContent = useAppStore(
    (state) => state.adoptCanonicalFileContent
  );
  const saveSelectedFile = useAppStore((state) => state.saveSelectedFile);
  const restoreFileVersion = useAppStore((state) => state.restoreFileVersion);
  const createNewFile = useAppStore((state) => state.createNewFile);
  const createNamedFile = useAppStore((state) => state.createNamedFile);
  const createFileAtPath = useAppStore((state) => state.createFileAtPath);
  const duplicateFile = useAppStore((state) => state.duplicateFile);
  const duplicateFolder = useAppStore((state) => state.duplicateFolder);
  const registerImportedFiles = useAppStore((state) => state.registerImportedFiles);
  const createNewFolder = useAppStore((state) => state.createNewFolder);
  const emptyFolderPaths = useAppStore((state) => state.emptyFolderPaths);
  const renameSelectedFile = useAppStore((state) => state.renameSelectedFile);
  const renameFilePath = useAppStore((state) => state.renameFilePath);
  const renameFolderPath = useAppStore((state) => state.renameFolderPath);
  const deleteFilePath = useAppStore((state) => state.deleteFilePath);
  const deleteFolderPath = useAppStore((state) => state.deleteFolderPath);
  const sortMode = useAppStore((state) => state.sortMode);
  const manualOrder = useAppStore((state) => state.manualOrder);
  const vaultIcons = useAppStore((state) => state.vaultIcons);
  const documentLocks = useAppStore((state) => state.documentLocks);
  const setDocumentLocked = useAppStore((state) => state.setDocumentLocked);
  const setVaultIconFor = useAppStore((state) => state.setVaultIconFor);
  const fileMtimeMs = useAppStore((state) => state.fileMtimeMs);
  const emptyFolderMtimeMs = useAppStore((state) => state.emptyFolderMtimeMs);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const moveTreeEntry = useAppStore((state) => state.moveTreeEntry);
  const navigationHistory = useNavigationHistoryStore((state) => state.history);
  const loadShortcutOverrides = useShortcutsStore((state) => state.loadOverrides);
  const logout = useSessionStore((state) => state.logout);

  const dirtyFilePaths = useMemo(
    () =>
      Object.entries(fileDocuments)
        .filter(([, document]) => document.content !== document.baseContent)
        .map(([filePath]) => filePath),
    [fileDocuments]
  );

  const fileRelativePaths = useMemo(
    () => (folderPath ? filePaths.map((path) => getRelativeDisplayPath(folderPath, path)) : []),
    [folderPath, filePaths]
  );
  const emptyFolderRelativePaths = useMemo(
    () => (folderPath ? emptyFolderPaths.map((path) => getRelativeDisplayPath(folderPath, path)) : []),
    [folderPath, emptyFolderPaths]
  );

  const selectedRelativePath =
    folderPath && selectedFilePath
      ? getRelativeDisplayPath(folderPath, selectedFilePath)
      : null;
  // A folder note is titled after its folder — the file name is the same for
  // every folder and says nothing — and renaming the title renames the folder.
  const isSelectedFolderNote =
    selectedRelativePath !== null &&
    isFolderNotePath(selectedRelativePath) &&
    getFolderNoteFolderPath(selectedRelativePath) !== "";
  const selectedFileLabel =
    selectedRelativePath === null
      ? null
      : isSelectedFolderNote
        ? getFolderNoteFolderPath(selectedRelativePath)
        : selectedRelativePath;

  const selectedFileDirectoryLabel = selectedFileLabel
    ? selectedFileLabel.slice(0, selectedFileLabel.lastIndexOf("/") + 1)
    : "";
  const selectedFileBaseName = selectedFileLabel
    ? selectedFileLabel
        .slice(selectedFileLabel.lastIndexOf("/") + 1)
        .replace(/\.md$/i, "")
    : "";

  const documentLocked =
    selectedRelativePath !== null && getDocumentLocked(documentLocks, selectedRelativePath);

  useEffect(() => {
    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
    setOpenTabs([]);
    setSecondaryFilePath(null);
    setEntryClipboard([]);
  }, [folderPath]);

  useEffect(() => {
    if (!selectedFilePath) return;
    setOpenTabs((tabs) => (tabs.includes(selectedFilePath) ? tabs : [...tabs, selectedFilePath]));
  }, [selectedFilePath]);

  useEffect(() => {
    setOpenTabs((tabs) => tabs.filter((filePath) => filePaths.includes(filePath) || fileDocuments[filePath]));
    if (secondaryFilePath && !filePaths.includes(secondaryFilePath) && !fileDocuments[secondaryFilePath]) {
      setSecondaryFilePath(null);
    }
  }, [filePaths, fileDocuments, secondaryFilePath]);


  const toggleSidebarVisible = () => {
    setSidebarVisible((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(SIDEBAR_VISIBLE_STORAGE_KEY, String(next));
      } catch {
        // localStorage can be unavailable in locked-down webviews.
      }
      return next;
    });
  };

  /** A note's path the way the UI names it: folder notes by their folder. */
  const labelNotePath = (filePath: string) =>
    describeNotePath(folderPath ? getRelativeDisplayPath(folderPath, filePath) : filePath, (folder) =>
      t("app.folderNoteLabel", { path: folder })
    );

  // A folder note is on disk only once it has been saved with content; until
  // then it is an empty document that was never removed.
  const isSelectedFileMissing =
    selectedFilePath !== null &&
    !filePaths.includes(selectedFilePath) &&
    !isSelectedFolderNote;

  const { sidebarWidth, isResizingSidebar, handleResizeStart, handleResizeKeyDown } =
    useSidebarWidth();

  const zenWidth = useEditorSettingsStore((state) => state.zenWidth);
  const zenFontSizePt = useEditorSettingsStore((state) => state.zenFontSizePt);
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  const { isZenMode, enterZenMode, exitZenMode, toggleZenMode } = useZenMode({
    canEnter: () => selectedFilePath !== null
  });

  useWebviewZoom();
  useAutoSave({ isAiActionPending: false, isSelectedFileStaged: false, isSelectedFileMissing });

  useEffect(() => {
    if (!autoSaveEnabled || !secondaryFilePath) {
      return;
    }

    const document = fileDocuments[secondaryFilePath];
    if (!document || document.content === document.baseContent) {
      return;
    }

    const timer = window.setTimeout(() => {
      const state = useAppStore.getState();
      const current = state.fileDocuments[secondaryFilePath];

      if (!current || current.content === current.baseContent || state.saveError) {
        return;
      }

      void state.saveFilePath(secondaryFilePath, { trigger: "auto" });
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, fileDocuments, secondaryFilePath]);

  useDraftFlush({
    // Closing the app with auto-save on saves the open note the way leaving
    // it would; without auto-save the draft is what comes back.
    onBeforeClose: async () => {
      if (isDirty && autoSaveEnabled && !isSelectedFileMissing) {
        await saveSelectedFile({ trigger: "auto" });
      }
    }
  });
  useWindowReveal();
  useViewportHeight();

  const layout = useLayoutMode();

  // Editing locks live in the vault, not in localStorage. Refresh the tiny
  // sidecar while a vault is open so another device's lock/unlock becomes
  // visible without re-opening the note.
  useEffect(() => {
    if (!folderPath) {
      return;
    }

    const refresh = () => {
      void refreshDocumentLocks();
    };
    const interval = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    refresh();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [folderPath, refreshDocumentLocks]);

  // The chat sheet covers the whole phone screen and Zen mode hides the
  // sidebar on purpose; a swipe there must not pull the file list over them.
  useSidebarSwipe({
    enabled: layout === "phone" && !isZenMode,
    isOpen: isSidebarSheetOpen,
    onOpen: () => setIsSidebarSheetOpen(true),
    onClose: () => setIsSidebarSheetOpen(false)
  });

  // The main area now has a useful folder home even before any note is
  // opened, so phones no longer cover it with the file sheet automatically.
  // The sheet opens only when the user asks for the sidebar.
  useEffect(() => {
    if (layout !== "phone") {
      setIsSidebarSheetOpen(false);
    }
  }, [layout]);

  const { availableUpdate, dismissUpdate } = useUpdateCheck();

  const {
    isRenamingTitle,
    titleDraft,
    setTitleDraft,
    titleInputRef,
    startTitleRename,
    commitTitleRename,
    cancelTitleRename
  } = useTitleRename({
    selectedFilePath,
    selectedFileBaseName,
    renameSelectedFile: (newBaseName) =>
      isSelectedFolderNote && selectedFilePath
        ? renameFolderPath(getFolderNoteFolderPath(selectedFilePath), newBaseName)
        : renameSelectedFile(newBaseName)
  });

  const {
    deleteTarget,
    isDeleting,
    requestDeleteFile,
    requestDeleteFolder,
    requestDeleteMultiple,
    cancelDeleteTarget,
    confirmDeleteTarget
  } = useDeleteTarget({
    folderPath,
    selectedFilePath,
    fileTreeSelection,
    deleteFilePath,
    deleteFolderPath
  });

  const { moveRequest, isMoving, requestMove, cancelMove, confirmMove } = useMoveTarget({
    folderPath,
    moveTreeEntry
  });

  const copyEntriesToClipboard = (entries: BatchEntry[]) => {
    setEntryClipboard(entries.map((entry) => ({ ...entry })));
  };

  const pasteEntriesInto = async (targetDirectory: string) => {
    for (const entry of entryClipboard) {
      const copiedPath =
        entry.kind === "file"
          ? await duplicateFile(entry.path, { select: false })
          : await duplicateFolder(entry.path);

      if (!copiedPath) continue;

      const copiedParent = await dirname(copiedPath);
      if (normalizePathKey(copiedParent) === normalizePathKey(targetDirectory)) {
        continue;
      }

      const moved = await moveTreeEntry({
        kind: entry.kind,
        sourcePath: copiedPath,
        targetParentDirectory: targetDirectory,
        targetIndex: Number.MAX_SAFE_INTEGER
      });

      if (!moved) {
        if (entry.kind === "file") {
          await deleteFilePath(copiedPath);
        } else {
          await deleteFolderPath(copiedPath);
        }
      }
    }
  };

  const {
    exportTarget,
    requestExportFile,
    requestExportFolder,
    requestExportMultiple,
    readMarkdownForExport,
    resolveOrderedRecords,
    closeExport
  } = useExportTarget();

  // Prints a file straight from the sidebar without opening it — reuses the
  // same "unsaved content wins" read as export so a dirty background tab
  // still prints its in-memory edits.
  const handlePrintFileRequest = (filePath: string) => {
    void readMarkdownForExport(filePath)
      .then((markdown) => printMarkdown(markdown, filePath))
      .catch((error: unknown) => {
        console.error("Print failed:", error);
      });
  };

  // The note as the .md it is, unsaved edits included, for a vault that is
  // not on this machine (browser, server vault); see lib/export/markdownDownload.
  const handleDownloadMarkdownRequest = (filePath: string) => {
    void readMarkdownForExport(filePath)
      .then((markdown) => downloadNoteAsMarkdown(filePath, markdown))
      .catch((error: unknown) => {
        console.error("Markdown download failed:", error);
      });
  };

  const handleDownloadFolderArchiveRequest = (archiveFolderPath: string, archiveName: string) => {
    void downloadFolderAsArchive(archiveFolderPath, archiveName).catch((error: unknown) => {
      console.error("Folder download failed:", error);
    });
  };

  const deleteTargetLabel =
    deleteTarget && deleteTarget.kind !== "multiple"
      ? deleteTarget.kind === "file"
        ? labelNotePath(deleteTarget.path)
        : folderPath
          ? getRelativeDisplayPath(folderPath, deleteTarget.path)
          : deleteTarget.path
      : null;


  // Every way of leaving the open note runs through here. Unsaved edits are
  // no reason to ask any more: they stay in the document map for the session
  // and in the draft on disk across a restart (store/appStore/drafts.ts).
  // With auto-save on they are saved on the way out, as they would have been
  // a moment later; if that save fails or is skipped, the draft carries them.
  // The one thing that cannot be carried is an AI proposal still open in the
  // editor, so that is the one thing that still blocks, with a hint.
  const leaveCurrentNote = async (): Promise<boolean> => {
    if (!selectedFilePath) {
      return true;
    }


    if (isDirty && autoSaveEnabled && !isSelectedFileMissing) {
      await saveSelectedFile({ trigger: "auto" });
    }

    return true;
  };

  const openFolderSafely = async () => {
    if (!(await leaveCurrentNote())) {
      return;
    }

    await openFolder();
  };

  // Server edition: signing out closes the vault as far as this browser is
  // concerned, so it leaves the open note the same way opening another
  // folder does.
  const logoutSafely = async () => {
    if (!(await leaveCurrentNote())) {
      return;
    }

    await logout();
  };

  const openRecentFolderSafely = async (targetFolderPath: string) => {
    if (!(await leaveCurrentNote())) {
      return;
    }

    await openFolderAtPath(targetFolderPath);
  };

  const selectFilePathSafely = async (filePath: string) => {
    if (filePath === secondaryFilePath) {
      setSecondaryFilePath(
        selectedFilePath && selectedFilePath !== filePath ? selectedFilePath : null
      );
    }

    if (filePath === selectedFilePath) {
      setCollectionView(null);
      setGraphViewOpen(false);
      setJournalViewOpen(false);
      setTasksViewOpen(false);
      return;
    }

    if (!(await leaveCurrentNote())) {
      return;
    }

    // A file the agent has only proposed is in the tree but not on disk; this
    // gives it an in-memory document so opening it shows the proposal instead
    // of a read error.
    await selectFilePath(filePath);
    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
  };

  const closeDocumentTab = (filePath: string) => {
    const index = openTabs.indexOf(filePath);
    const next = openTabs.filter((entry) => entry !== filePath);
    setOpenTabs(next);

    if (secondaryFilePath === filePath) {
      setSecondaryFilePath(null);
    }

    if (selectedFilePath === filePath) {
      const fallback = next[Math.min(index, Math.max(0, next.length - 1))] ?? null;
      if (fallback) {
        void selectFilePathSafely(fallback);
      } else {
        clearSelectedFile();
      }
    }
  };

  const closeAllDocumentTabs = () => {
    setOpenTabs([]);
    setSecondaryFilePath(null);
    clearSelectedFile();
  };

  const reorderDocumentTabs = (
    draggedFilePath: string,
    targetFilePath: string,
    position: "before" | "after"
  ) => {
    setOpenTabs((tabs) => {
      if (
        draggedFilePath === targetFilePath ||
        !tabs.includes(draggedFilePath) ||
        !tabs.includes(targetFilePath)
      ) {
        return tabs;
      }

      const withoutDragged = tabs.filter((entry) => entry !== draggedFilePath);
      const targetIndex = withoutDragged.indexOf(targetFilePath);
      const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      return [
        ...withoutDragged.slice(0, insertIndex),
        draggedFilePath,
        ...withoutDragged.slice(insertIndex)
      ];
    });
  };

  const openSecondaryDocument = async (filePath: string) => {
    if (layout !== "desktop" || filePath === selectedFilePath) {
      return;
    }

    const loaded = await loadFileDocument(filePath);
    if (!loaded) return;

    setOpenTabs((tabs) => (tabs.includes(filePath) ? tabs : [...tabs, filePath]));
    setSecondaryFilePath(filePath);
    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
  };

  const closePrimarySplitPane = async () => {
    if (!secondaryFilePath) {
      return;
    }

    const remainingFilePath = secondaryFilePath;
    setSecondaryFilePath(null);
    await selectFilePath(remainingFilePath);
    setOpenTabs((tabs) =>
      tabs.includes(remainingFilePath) ? tabs : [...tabs, remainingFilePath]
    );
  };

  const openDocumentsAsTabs = async (filePathsToOpen: [string, string]) => {
    const loaded = await Promise.all(filePathsToOpen.map((filePath) => loadFileDocument(filePath)));
    if (loaded.some((success) => !success)) {
      return;
    }

    setSecondaryFilePath(null);
    setOpenTabs((tabs) => [
      ...tabs,
      ...filePathsToOpen.filter((filePath) => !tabs.includes(filePath))
    ]);
    await selectFilePathSafely(filePathsToOpen[0]);
    setIsSidebarSheetOpen(false);
  };

  const openDocumentsAsSplit = async (filePathsToOpen: [string, string]) => {
    if (layout !== "desktop") {
      return;
    }

    const loaded = await Promise.all(filePathsToOpen.map((filePath) => loadFileDocument(filePath)));
    if (loaded.some((success) => !success)) {
      return;
    }

    await selectFilePath(filePathsToOpen[0]);
    setOpenTabs((tabs) => [
      ...tabs,
      ...filePathsToOpen.filter((filePath) => !tabs.includes(filePath))
    ]);
    setSecondaryFilePath(filePathsToOpen[1]);
    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
    setIsSidebarSheetOpen(false);
  };

  // Same for a folder's note (the tree hands over the folder, the store
  // resolves the note inside it).
  const openFolderNoteSafely = async (targetFolderPath: string) => {
    if (selectedFilePath && getFolderNotePath(targetFolderPath) === selectedFilePath) {
      return;
    }

    if (!(await leaveCurrentNote())) {
      return;
    }

    await openFolderNote(targetFolderPath);
    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
  };

  const openCollectionSafely = async (request: CollectionViewRequest) => {
    if (!(await leaveCurrentNote())) {
      return;
    }

    const isStart =
      request.kind === "folder" && request.relativePath === "";

    if (isStart) {
      // Start is a destination of its own, not an overlay over the previously
      // selected note. Keep that note in fileDocuments/drafts, but remove the
      // active selection so no later "close" can reveal it again.
      clearSelectedFile();
    }

    setCollectionView(request);
    setGraphViewOpen(false);
    setJournalViewOpen(false);
    setTasksViewOpen(false);
    setIsSidebarSheetOpen(false);
  };

  const openJournalDateSafely = async (
    relativePath: string,
    initialMarkdown: string
  ): Promise<string | null> => {
    if (!folderPath) {
      return null;
    }

    const targetPath = await join(
      folderPath,
      ...relativePath.replace(/\\/g, "/").split("/").filter(Boolean)
    );
    const knownPath =
      filePaths.find(
        (candidate) => normalizePathKey(candidate) === normalizePathKey(targetPath)
      ) ?? null;
    const resolvedPath = knownPath ?? targetPath;

    if (selectedFilePath !== resolvedPath && !(await leaveCurrentNote())) {
      return null;
    }

    if (!knownPath) {
      const created = await createFileAtPath(targetPath, initialMarkdown);
      if (!created) {
        return null;
      }
    }

    if (selectedFilePath !== resolvedPath) {
      const opened = await selectFilePath(resolvedPath);
      if (!opened) {
        return null;
      }
    }

    setCollectionView(null);
    setGraphViewOpen(false);
    setJournalViewOpen(true);
    setTasksViewOpen(false);
    setIsSidebarSheetOpen(false);
    return resolvedPath;
  };

  /**
   * The rename that confirms a freshly created folder's name. Only then does
   * its note open: Escape has to be able to leave the folder as "New folder"
   * without dragging the user into a document. A folder without notes has
   * nothing to open — it stays selected and unfolded in the tree, which is
   * the whole result of creating it.
   */
  const renameFolderPathFromTree = async (targetFolderPath: string, newBaseName: string) => {
    const wasJustCreated =
      pendingFolderNoteOpenRef.current !== null &&
      normalizePathKey(pendingFolderNoteOpenRef.current) === normalizePathKey(targetFolderPath);
    const didRename = await renameFolderPath(targetFolderPath, newBaseName);

    if (!didRename) {
      return false;
    }

    pendingFolderNoteOpenRef.current = null;

    if (wasJustCreated && useEditorSettingsStore.getState().folderNotesEnabled) {
      // The rename moved the folder, so the note lives under the new name.
      const renamedFolderPath = await join(await dirname(targetFolderPath), newBaseName);
      await openFolderNoteSafely(renamedFolderPath);
    }

    return true;
  };

  /** Clears the pending-note marker when the new folder's name is not confirmed. */
  const renameFilePathFromTree = async (filePath: string, newBaseName: string) => {
    pendingFolderNoteOpenRef.current = null;

    return renameFilePath(filePath, newBaseName);
  };

  // Opening a different vault has nothing to do with the previous one's
  // history. Declared before the recording effect below so that a folder switch
  // which immediately selects a file clears first and records afterwards.
  useEffect(() => {
    useNavigationHistoryStore.getState().reset();
  }, [folderPath]);

  // Heading numbering is a property of the vault, not of the app: it is read
  // from the vault's .scribecat folder here and falls back to "off" while no
  // vault is open.
  useEffect(() => {
    void useEditorSettingsStore.getState().loadHeadingNumbering(folderPath);
  }, [folderPath]);

  // The single writer of the navigation history: whichever way a note ends up
  // open — sidebar, a link in the text, the backlinks panel, a search hit, a
  // freshly created file — it is recorded here exactly once. A back/forward
  // step announces itself through navigationIntentRef and only moves the
  // position instead of pushing a new entry.
  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const intent = navigationIntentRef.current;
    navigationIntentRef.current = null;

    if (intent && intent.filePath === selectedFilePath) {
      useNavigationHistoryStore.getState().goTo(intent.index);
      return;
    }

    useNavigationHistoryStore.getState().visit(selectedFilePath);
  }, [selectedFilePath]);

  const backStepIndex = useMemo(
    () => findStepIndex(navigationHistory, -1, filePaths),
    [navigationHistory, filePaths]
  );
  const forwardStepIndex = useMemo(
    () => findStepIndex(navigationHistory, 1, filePaths),
    [navigationHistory, filePaths]
  );

  const historyEntryLabel = (stepIndex: number | null) => {
    if (stepIndex === null) {
      return null;
    }

    return labelNotePath(navigationHistory.entries[stepIndex]);
  };

  const navigateHistory = (stepIndex: number | null) => {
    if (stepIndex === null) {
      return;
    }

    const targetPath = navigationHistory.entries[stepIndex];
    navigationIntentRef.current = { filePath: targetPath, index: stepIndex };
    void selectFilePathSafely(targetPath);
  };

  // Shared by "new file", "new folder" and "import": the new entry lands
  // directly after the tree's current selection — one level deeper (as the
  // first child) when a folder is selected, same level (directly after it)
  // when a file is selected. Falls back to appending at the vault root when
  // nothing or more than one entry is selected.
  const resolveNewEntryTarget = async (): Promise<{
    targetDirectory: string | null;
    insertAfterBasename: string | null | undefined;
  }> => {
    if (!folderPath) {
      return { targetDirectory: null, insertAfterBasename: undefined };
    }

    if (fileTreeSelection.length !== 1) {
      return { targetDirectory: folderPath, insertAfterBasename: undefined };
    }

    const [entry] = fileTreeSelection;

    if (entry.kind === "folder") {
      return { targetDirectory: await join(folderPath, entry.path), insertAfterBasename: null };
    }

    const basename = entry.path.replace(/\\/g, "/").split("/").pop() ?? "";

    return { targetDirectory: await dirname(entry.path), insertAfterBasename: basename };
  };

  /**
   * Both create actions end the same way: the new entry is named in the tree,
   * where its siblings are visible and where a folder can be named at all.
   * The sidebar sheet stays open on a phone — creating several notes in a row
   * would otherwise mean reopening it after every one.
   */
  const requestEntryRename = (kind: "file" | "folder", path: string) => {
    entryRenameRequestIdRef.current += 1;
    setPendingEntryRename({ kind, path, requestId: entryRenameRequestIdRef.current });
  };

  const handleCreateFile = async (targetDirectory?: string) => {
    const resolved =
      targetDirectory !== undefined
        ? { targetDirectory, insertAfterBasename: undefined as string | null | undefined }
        : await resolveNewEntryTarget();
    const newFilePath = await createNewFile(resolved.targetDirectory ?? undefined, resolved.insertAfterBasename);

    if (newFilePath) {
      // createNewFile already selected the note, so the rename below has a
      // document behind it from the first keystroke.
      requestEntryRename("file", newFilePath);
    }
  };

  const handleCreateFolder = async (targetDirectory?: string) => {
    const resolved =
      targetDirectory !== undefined
        ? { targetDirectory, insertAfterBasename: undefined as string | null | undefined }
        : await resolveNewEntryTarget();
    const newFolderPath = await createNewFolder(resolved.targetDirectory ?? undefined, resolved.insertAfterBasename);

    if (newFolderPath) {
      pendingFolderNoteOpenRef.current = newFolderPath;
      requestEntryRename("folder", newFolderPath);
    }
  };

  const resolveCollectionTargetDirectory = async (): Promise<string | undefined> => {
    if (!folderPath) return undefined;
    if (collectionView?.kind !== "folder" || !collectionView.relativePath) {
      return folderPath;
    }

    return join(
      folderPath,
      ...collectionView.relativePath.replace(/\\/g, "/").split("/").filter(Boolean)
    );
  };

  const createCollectionNote = async (name: string): Promise<boolean> => {
    const targetDirectory = await resolveCollectionTargetDirectory();
    if (!targetDirectory) return false;

    // Create directly with the requested title. The previous two-step path
    // briefly exposed "Nytt notat.md" to the folder watcher and collection
    // before the rename landed, which is the flash/delay visible in the grid.
    const newFilePath = await createNamedFile(targetDirectory, name);
    if (!newFilePath) return false;

    // Creating from the collection is an operation on the current folder,
    // not navigation into the new note. Keep the grid as the active view.
    clearSelectedFile();
    return true;
  };

  const createCollectionFolder = async (name: string): Promise<boolean> => {
    const targetDirectory = await resolveCollectionTargetDirectory();
    if (!targetDirectory) return false;

    const newFolderPath = await createNewFolder(targetDirectory);
    if (!newFolderPath) return false;

    const renamed = await renameFolderPath(newFolderPath, name);
    if (!renamed) {
      await deleteFolderPath(newFolderPath);
      return false;
    }

    return true;
  };

  const requestImportFiles = async () => {
    if (!platform.dialogs) {
      return;
    }

    const selectedPaths = await platform.dialogs.chooseFiles({
      title: t("importDialog.chooseFilesTitle"),
      filters: [
        {
          name: t("importDialog.filterName"),
          extensions: [...IMPORT_FILE_EXTENSIONS]
        }
      ]
    });

    if (selectedPaths.length > 0) {
      const { targetDirectory, insertAfterBasename } = await resolveNewEntryTarget();
      setImportTargetFolder(targetDirectory);
      setImportInsertAfterBasename(insertAfterBasename);
      setImportSkippedCount(0);
      setImportLimitReached(false);
      setImportFileList(selectedPaths.map((path) => ({ source: sourceFromPath(path) })));
    }
  };

  /**
   * Files and folders dragged onto the file tree from outside the app. The
   * folder they were dropped on decides where they land — dropping next to
   * nothing in particular targets the vault root.
   */
  const handleFilesDropped = (payload: DropPayload, targetDirectory: string) => {
    if (!folderPath) {
      return;
    }

    void (async () => {
      const collected = await collectDroppedSources(payload);
      const segments = targetDirectory.split("/").filter(Boolean);

      setImportTargetFolder(segments.length > 0 ? await join(folderPath, ...segments) : folderPath);
      // Imported notes go to the end of their folder rather than next to a row
      // that only happened to be under the pointer.
      setImportInsertAfterBasename(null);
      setImportSkippedCount(collected.skipped);
      setImportLimitReached(collected.limitReached);
      setImportFileList(collected.sources);
    })();
  };

  const handleImported = (createdFilePaths: string[]) => {
    if (!folderPath) {
      return;
    }

    const parentRelativePath = getRelativeDisplayPath(folderPath, importTargetFolder ?? folderPath);
    registerImportedFiles(createdFilePaths, parentRelativePath, importInsertAfterBasename);
  };



  // Custom key bindings are app-wide (shortcuts.json in the app config dir),
  // so they are loaded once at startup rather than per opened folder.
  useEffect(() => {
    void loadShortcutOverrides();
  }, [loadShortcutOverrides]);

  // Safety net for files dropped anywhere no handler claims them: without it
  // the webview follows the drop and navigates the whole app away to the file,
  // which looks exactly like a crash. Handlers that took the drop have called
  // preventDefault by the time this window-level listener runs.
  useEffect(() => {
    const swallowDrop = (event: DragEvent) => {
      // Only drags from outside can navigate the app away, and leaving in-app
      // drags strictly untouched keeps this from interfering with the editor's
      // and the file tree's own drag handling.
      if (event.defaultPrevented || !carriesExternalFiles(event.dataTransfer)) {
        return;
      }

      event.preventDefault();

      if (event.type === "dragover" && event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
    };

    window.addEventListener("dragover", swallowDrop);
    window.addEventListener("drop", swallowDrop);

    return () => {
      window.removeEventListener("dragover", swallowDrop);
      window.removeEventListener("drop", swallowDrop);
    };
  }, []);

  const handleVersionDiffRequest = (version: FileVersion) => {
    setVersionDiffTarget({ version, fileLabel: selectedFileLabel ?? "" });
  };

  const handleVersionRestore = async (version: FileVersion) => {
    setIsRestoringVersion(true);

    try {
      const restored = await restoreFileVersion(version.id);

      if (restored) {
        setVersionDiffTarget(null);
      }
    } finally {
      setIsRestoringVersion(false);
    }
  };

  // A diff open on one file must not survive switching to another — it would
  // compare a stored version against a document it never belonged to.
  useEffect(() => {
    setVersionDiffTarget(null);
  }, [selectedFilePath]);

  const startupFolderResolved = useStartupFolder(openFolderAtPath);
  useFolderWatcher(refreshFolderFiles);
  const remoteVaultDialog = useRemoteVaultDialog({ openVault: openRecentFolderSafely });

  // The open note is remembered per vault and per device, and opened again
  // when the vault is next opened (Settings, "reopen the last note"). Only
  // once per opened folder: closing or deleting the note afterwards must
  // not bring it straight back.
  const reopenLastNote = useEditorSettingsStore((state) => state.reopenLastNote);
  const restoredFolderRef = useRef<string | null>(null);

  useEffect(() => {
    if (folderPath && selectedFilePath) {
      setLastOpenedRelativePath(folderPath, getRelativeDisplayPath(folderPath, selectedFilePath));
    }
  }, [folderPath, selectedFilePath]);

  useEffect(() => {
    if (!folderPath || isLoading || restoredFolderRef.current === folderPath) {
      return;
    }

    restoredFolderRef.current = folderPath;

    if (!reopenLastNote || selectedFilePath !== null) {
      return;
    }

    const relativePath = getLastOpenedRelativePath(folderPath);

    if (!relativePath) {
      return;
    }

    // Gone since last time (deleted, moved from another device): nothing to
    // open, and the stale bookmark goes with it.
    const filePath = filePaths.find(
      (candidate) => getRelativeDisplayPath(folderPath, candidate) === relativePath
    );

    if (filePath) {
      void selectFilePath(filePath);
      // The phone's sheet opened for the empty state a moment ago; the note
      // it is about to cover is the one the user wants to see.
      setIsSidebarSheetOpen(false);
    } else {
      setLastOpenedRelativePath(folderPath, null);
    }
  }, [folderPath, isLoading, filePaths, reopenLastNote, selectedFilePath, selectFilePath]);
  useGlobalShortcuts({
    selectedFilePath,
    saveSelectedFile,
    openFolderSafely,
    createFile: handleCreateFile,
    showShortcuts: () => {
      setSettingsInitialTab("shortcuts");
      setIsSettingsOpen(true);
    },
    toggleZenMode,
    navigateBack: () => navigateHistory(backStepIndex),
    navigateForward: () => navigateHistory(forwardStepIndex),
    closeWorkingSetEntry: workingSetActions.closeSelectedEntry,
    editorHandleRef
  });

  // The same Sidebar element goes into the grid on tablet and desktop and
  // into a sheet on the phone; the props do not know the difference.
  const sidebar = (
    <Sidebar
      folderPath={folderPath}
      filePaths={filePaths}
      emptyFolderPaths={emptyFolderPaths}
      selectedFilePath={selectedFilePath}
      selectedFileContent={selectedFileContent}
      dirtyFilePaths={dirtyFilePaths}
      workingSet={{
        entries: workingSet,
        onClose: workingSetActions.closeEntry,
        onCloseOthers: workingSetActions.closeOthers,
        onCloseAll: workingSetActions.closeAll,
        onCloseSaved: closeSavedWorkingSetEntries,
        onPin: pinWorkingSetEntry,
        onUnpin: unpinWorkingSetEntry,
        onDiscardChanges: (filePath) => void discardFileChanges(filePath)
      }}
      folderError={folderError}
      isLoading={isLoading}
      pendingEntryRename={pendingEntryRename}
      sortMode={sortMode}
      manualOrder={manualOrder}
      vaultIcons={vaultIcons}
      onSetVaultIcon={setVaultIconFor}
      fileMtimeMs={fileMtimeMs}
      emptyFolderMtimeMs={emptyFolderMtimeMs}
      onOpenFolder={openFolderSafely}
      recentFolderPaths={getRecentFolderPaths()}
      onOpenRecentFolder={(targetFolderPath) => void openRecentFolderSafely(targetFolderPath)}
      onCreateFile={() => void handleCreateFile()}
      onCreateFileRequest={(targetDirectory) => void handleCreateFile(targetDirectory)}
      onCreateFolder={() => void handleCreateFolder()}
      onCreateFolderRequest={(targetDirectory) => void handleCreateFolder(targetDirectory)}
      onImportRequest={() => void requestImportFiles()}
      onSelectFilePath={async (filePath) => {
        await selectFilePathSafely(filePath);
        setIsSidebarSheetOpen(false);
      }}
      onOpenFolderNote={async (targetFolderPath) => {
        await openFolderNoteSafely(targetFolderPath);
        setIsSidebarSheetOpen(false);
      }}
      onOpenFolderCollection={(relativePath) => {
        void openCollectionSafely({ kind: "folder", relativePath });
      }}
      activeCollectionFolderPath={collectionView?.kind === "folder" ? collectionView.relativePath : null}
      activeCollectionTag={collectionView?.kind === "tag" ? collectionView.tag : null}
      onOpenTagCollection={(tag, matchingFilePaths) => {
        void openCollectionSafely({ kind: "tag", tag, filePaths: matchingFilePaths });
      }}
      onCloseCollection={() => setCollectionView(null)}
      graphViewOpen={graphViewOpen}
      onGraphViewToggle={() => {
        if (graphViewOpen) {
          void openCollectionSafely({ kind: "folder", relativePath: "" });
          return;
        }

        setGraphViewOpen(true);
        setJournalViewOpen(false);
        setTasksViewOpen(false);
        setCollectionView(null);
        setIsSidebarSheetOpen(false);
      }}
      journalViewOpen={journalViewOpen}
      onJournalViewToggle={() => {
        if (journalViewOpen) {
          void openCollectionSafely({ kind: "folder", relativePath: "" });
          return;
        }

        setJournalViewOpen(true);
        setGraphViewOpen(false);
        setTasksViewOpen(false);
        setCollectionView(null);
        setIsSidebarSheetOpen(false);
      }}
      tasksViewOpen={tasksViewOpen}
      onTasksViewToggle={() => {
        if (tasksViewOpen) {
          void openCollectionSafely({ kind: "folder", relativePath: "" });
          return;
        }

        setTasksViewOpen(true);
        setGraphViewOpen(false);
        setJournalViewOpen(false);
        setCollectionView(null);
        setIsSidebarSheetOpen(false);
      }}
      onDeleteFileRequest={requestDeleteFile}
      onDuplicateFileRequest={(filePath) => void duplicateFile(filePath)}
      onDuplicateFolderRequest={(targetFolderPath) => void duplicateFolder(targetFolderPath)}
      onCopyRequest={copyEntriesToClipboard}
      onDeleteFolderRequest={requestDeleteFolder}
      onDeleteMultipleRequest={requestDeleteMultiple}
      onExportFileRequest={requestExportFile}
      onExportFolderRequest={requestExportFolder}
      onExportMultipleRequest={requestExportMultiple}
      onDownloadMarkdownRequest={handleDownloadMarkdownRequest}
      onDownloadFolderArchiveRequest={handleDownloadFolderArchiveRequest}
      onPrintFileRequest={handlePrintFileRequest}
      onRenameFolder={renameFolderPathFromTree}
      onRenameFile={renameFilePathFromTree}
      onMoveEntry={moveTreeEntry}
      onMoveRequest={requestMove}
      onOpenSplitRequest={
        layout === "desktop"
          ? (filePathsToOpen) => void openDocumentsAsSplit(filePathsToOpen)
          : undefined
      }
      onOpenTabsRequest={(filePathsToOpen) => void openDocumentsAsTabs(filePathsToOpen)}
      onSetSortMode={(mode) => void setSortMode(mode)}
      onSettingsRequest={() => {
        setSettingsInitialTab("application");
        setIsSettingsOpen(true);
      }}
      onRequestEditorFocus={() => setEditorFocusRequestId((id) => id + 1)}
      sidebarFocusRequestId={sidebarFocusRequestId}
      onFileTreeSelectionChange={setFileTreeSelection}
      fileTreeSelection={fileTreeSelection}
      fileTreeSelectionCount={fileTreeSelection.length}
      onFilesDropped={handleFilesDropped}
      onClose={layout === "phone" ? () => setIsSidebarSheetOpen(false) : undefined}
    />
  );



  return (
    <main
      className={cn("app-shell", isZenMode && "app-shell--zen")}
      aria-label={t("app.shellLabel")}
      style={
        {
          "--zen-width": `${zenWidth}px`,
          // Overrides the root's document scale for the Zen column only; the
          // normal view and the exports keep fontSizePt (useEditorSettingsStore).
          ...(isZenMode && zenFontSizePt !== null
            ? { "--document-font-scale": getZenFontScale(zenFontSizePt) }
            : {})
        } as React.CSSProperties
      }
    >
      <div className="workspace">
        <section
          className={cn(
            "workspace-grid",
            isZenMode && "workspace-grid--zen",
            layout !== "phone" && !sidebarVisible && "workspace-grid--sidebar-hidden"
          )}
          aria-label={t("app.workspaceLabel")}
          style={
            {
              "--sidebar-width": `${sidebarWidth}px`
            } as React.CSSProperties
          }
        >
          {layout === "phone" || !sidebarVisible ? null : sidebar}

          {layout !== "phone" && sidebarVisible ? <div
            className={cn(
              "workspace-resizer",
              isResizingSidebar && "workspace-resizer--active"
            )}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("app.sidebarResizeLabel")}
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          >
            <span className="workspace-resizer__grip" aria-hidden="true" />
          </div> : null}

          {!startupFolderResolved && folderPath === null ? (
            <div className="workspace-startup-placeholder" aria-busy="true" />
          ) : tasksViewOpen && folderPath ? (
            <TasksPanel
              folderPath={folderPath}
              filePaths={filePaths}
              fileMtimeMs={fileMtimeMs}
              sidebarVisible={sidebarVisible}
              onSidebarVisibilityToggle={toggleSidebarVisible}
              onOpenSidebar={() => setIsSidebarSheetOpen(true)}
              onClose={() =>
                void openCollectionSafely({ kind: "folder", relativePath: "" })
              }
              onPersistTaskFile={(filePath, markdown) =>
                createFileAtPath(filePath, markdown)
              }
              onRenameTaskFile={renameFilePathFromTree}
              onDeleteTaskFile={deleteFilePath}
            />
          ) : journalViewOpen && folderPath ? (
            <JournalPanel
              folderPath={folderPath}
              filePaths={filePaths}
              selectedFilePath={selectedFilePath}
              selectedFileContent={selectedFileContent}
              sidebarVisible={sidebarVisible}
              onSidebarVisibilityToggle={toggleSidebarVisible}
              onOpenSidebar={() => setIsSidebarSheetOpen(true)}
              onClose={() =>
                void openCollectionSafely({ kind: "folder", relativePath: "" })
              }
              onDeleteEntry={requestDeleteFile}
              onOpenDate={async (_date, relativePath, initialMarkdown) =>
                openJournalDateSafely(relativePath, initialMarkdown)
              }
              onMarkdownChange={updateSelectedFileContent}
            />
          ) : graphViewOpen && folderPath ? (
            <GraphPanel
              folderPath={folderPath}
              filePaths={filePaths}
              selectedFilePath={selectedFilePath}
              selectedFileContent={selectedFileContent}
              sidebarVisible={sidebarVisible}
              onSidebarVisibilityToggle={toggleSidebarVisible}
              onOpenSidebar={() => setIsSidebarSheetOpen(true)}
              onClose={() =>
                void openCollectionSafely({ kind: "folder", relativePath: "" })
              }
              onOpenFile={(filePath) => void selectFilePathSafely(filePath)}
              onOpenFolder={(relativePath) => {
                void openCollectionSafely({ kind: "folder", relativePath });
              }}
              onOpenTag={(tag, matchingFilePaths) => {
                void openCollectionSafely({ kind: "tag", tag, filePaths: matchingFilePaths });
              }}
            />
          ) : (collectionView || (folderPath && selectedFilePath === null)) && folderPath ? (
            <CollectionPanel
              request={collectionView ?? { kind: "folder", relativePath: "" }}
              folderPath={folderPath}
              filePaths={filePaths}
              emptyFolderPaths={emptyFolderPaths}
              fileMtimeMs={fileMtimeMs}
              emptyFolderMtimeMs={emptyFolderMtimeMs}
              sortMode={sortMode}
              manualOrder={manualOrder}
              selectedFilePath={selectedFilePath}
              selectedFileContent={selectedFileContent}
              sidebarVisible={sidebarVisible}
              onSidebarVisibilityToggle={toggleSidebarVisible}
              onOpenSidebar={() => setIsSidebarSheetOpen(true)}
              onClose={() =>
                void openCollectionSafely({ kind: "folder", relativePath: "" })
              }
              onOpenFile={(filePath) => void selectFilePathSafely(filePath)}
              onOpenFolder={(relativePath) => {
                void openCollectionSafely({ kind: "folder", relativePath });
              }}
              onOpenJournal={() => {
                setJournalViewOpen(true);
                setGraphViewOpen(false);
                setTasksViewOpen(false);
                setCollectionView(null);
              }}
              onOpenGraph={() => {
                setGraphViewOpen(true);
                setJournalViewOpen(false);
                setTasksViewOpen(false);
                setCollectionView(null);
              }}
              onOpenTasks={() => {
                setTasksViewOpen(true);
                setJournalViewOpen(false);
                setGraphViewOpen(false);
                setCollectionView(null);
              }}
              onCreateFolder={createCollectionFolder}
              onCreateNote={createCollectionNote}
              onSetSortMode={(mode) => void setSortMode(mode)}
              onMoveEntry={moveTreeEntry}
              onRenameFile={renameFilePath}
              onRenameFolder={renameFolderPath}
              onDuplicateFileRequest={(filePath) => void duplicateFile(filePath)}
              onDuplicateFolderRequest={(targetFolderPath) => void duplicateFolder(targetFolderPath)}
              onCopyRequest={copyEntriesToClipboard}
              onPasteRequest={(targetDirectory) => void pasteEntriesInto(targetDirectory)}
              canPaste={entryClipboard.length > 0}
              onMoveRequest={requestMove}
              onOpenSplitRequest={
                layout === "desktop"
                  ? (filePathsToOpen) => void openDocumentsAsSplit(filePathsToOpen)
                  : undefined
              }
              onOpenTabsRequest={(filePathsToOpen) => void openDocumentsAsTabs(filePathsToOpen)}
              onDeleteFileRequest={requestDeleteFile}
              onDeleteFolderRequest={requestDeleteFolder}
              onDeleteMultipleRequest={requestDeleteMultiple}
              onExportFileRequest={requestExportFile}
              onExportFolderRequest={requestExportFolder}
              onExportMultipleRequest={requestExportMultiple}
              onDownloadMarkdownRequest={handleDownloadMarkdownRequest}
              onDownloadFolderArchiveRequest={handleDownloadFolderArchiveRequest}
              onPrintFileRequest={handlePrintFileRequest}
              onFilesDropped={handleFilesDropped}
            />
          ) : (
            <DocumentPanel
              selectedFilePath={selectedFilePath}
              selectedFileLabel={selectedFileLabel}
              vaultIcons={vaultIcons}
              onSetVaultIcon={setVaultIconFor}
              selectedFileDirectoryLabel={selectedFileDirectoryLabel}
              isSelectedFolderNote={isSelectedFolderNote}
              folderPath={folderPath}
              selectedFileContent={selectedFileContent}
              appVersion={appVersion}
              filePaths={filePaths}
              fileDocuments={fileDocuments}
              dirtyFilePaths={dirtyFilePaths}
              openTabs={openTabs}
              secondaryFilePath={secondaryFilePath}
              onSelectTab={(filePath) => void selectFilePathSafely(filePath)}
              onCloseTab={closeDocumentTab}
              onCloseAllTabs={closeAllDocumentTabs}
              onReorderTabs={reorderDocumentTabs}
              onOpenSecondary={(filePath) => void openSecondaryDocument(filePath)}
              onClosePrimarySplit={() => void closePrimarySplitPane()}
              onCloseSecondary={() => setSecondaryFilePath(null)}
              onSecondaryMarkdownChange={updateFileContent}
              backTargetLabel={historyEntryLabel(backStepIndex)}
              forwardTargetLabel={historyEntryLabel(forwardStepIndex)}
              onNavigateBack={() => navigateHistory(backStepIndex)}
              onNavigateForward={() => navigateHistory(forwardStepIndex)}
              isRenamingTitle={isRenamingTitle}
              titleDraft={titleDraft}
              titleInputRef={titleInputRef}
              onTitleDraftChange={setTitleDraft}
              onCommitTitleRename={() => void commitTitleRename()}
              onCancelTitleRename={cancelTitleRename}
              onStartTitleRename={() => startTitleRename(selectedFileBaseName, selectedFilePath)}
              onOpenFolderCollection={(folderRelativePath) => {
                void openCollectionSafely({ kind: "folder", relativePath: folderRelativePath });
              }}
              isSaving={isSaving}
              isDirty={isDirty}
              isSelectedFileMissing={isSelectedFileMissing}
              isFileLoading={isFileLoading}
              fileError={fileError}
              saveError={saveError}
              editorHandleRef={editorHandleRef}
              editorFocusRequestId={editorFocusRequestId}
              onMarkdownChange={updateSelectedFileContent}
              onCanonicalMarkdown={adoptCanonicalFileContent}
              onRequestSidebarFocus={() => {
                if (!sidebarVisible) {
                  setSidebarVisible(true);
                }
                window.setTimeout(() => setSidebarFocusRequestId((id) => id + 1), 0);
              }}
              onRequestFileOpen={(targetFilePath) => void selectFilePathSafely(targetFilePath)}
              onZenModeRequest={enterZenMode}
              documentLocked={documentLocked}
              onDocumentLockToggle={() => {
                if (selectedFilePath) {
                  void setDocumentLocked(selectedFilePath, !documentLocked).catch((error: unknown) => {
                    console.error("Failed to update document lock:", error);
                  });
                }
              }}
              sidebarVisible={sidebarVisible}
              onSidebarVisibilityToggle={toggleSidebarVisible}
              onVersionDiffRequest={handleVersionDiffRequest}
              onVersionRestoreRequest={(version) => void handleVersionRestore(version)}
              onOpenSidebar={() => setIsSidebarSheetOpen(true)}
              onDeleteRequest={() => {
                if (selectedFilePath) {
                  requestDeleteFile(selectedFilePath);
                }
              }}
              onDeleteFileRequest={requestDeleteFile}
              onSaveRequest={() => void saveSelectedFile()}
            />
          )}

        </section>
      </div>

      {isSidebarSheetOpen && layout === "phone" ? (
        <MobileSheet
          side="left"
          label={t("sidebar.filesLabel")}
          onClose={() => setIsSidebarSheetOpen(false)}
          className="mobile-sheet__panel--sidebar"
        >
          {sidebar}
        </MobileSheet>
      ) : null}

      {isZenMode ? <ZenMode onExit={exitZenMode} isDirty={isDirty} /> : null}

      <RemoteVaultDialog
        request={remoteVaultDialog.request}
        onDone={remoteVaultDialog.handleDone}
        onCancel={remoteVaultDialog.close}
      />



      <AppDialogs
        closingFileLabel={
          workingSetActions.closeRequest ? labelNotePath(workingSetActions.closeRequest.filePath) : null
        }
        onSaveAndClose={() => void workingSetActions.saveAndClose()}
        onDiscardAndClose={workingSetActions.discardAndClose}
        onCancelClose={workingSetActions.cancelClose}
        saveConflictFileLabel={saveConflict ? labelNotePath(saveConflict.filePath) : null}
        isSaving={isSaving}
        onOverwriteConflict={() => {
          // The answer belongs to the note the question was asked about.
          if (saveConflict?.filePath === selectedFilePath) {
            void saveSelectedFile({ force: true });
          } else {
            dismissSaveConflict();
          }
        }}
        onDismissConflict={dismissSaveConflict}
        isSettingsOpen={isSettingsOpen}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={() => setIsSettingsOpen(false)}
        onLogoutRequest={() => {
          setIsSettingsOpen(false);
          void logoutSafely();
        }}
        onAddRemoteVault={
          platform.features.remoteVaults
            ? () => {
                setIsSettingsOpen(false);
                remoteVaultDialog.openAddDialog();
              }
            : undefined
        }
        moveRequest={moveRequest}
        fileRelativePaths={fileRelativePaths}
        emptyFolderRelativePaths={emptyFolderRelativePaths}
        isMoving={isMoving}
        onConfirmMove={(target) => void confirmMove(target)}
        onCancelMove={cancelMove}
        deleteTarget={deleteTarget}
        deleteTargetLabel={deleteTargetLabel}
        isDeleting={isDeleting}
        onConfirmDelete={() => void confirmDeleteTarget()}
        onCancelDelete={cancelDeleteTarget}
        exportTarget={exportTarget}
        readMarkdownForExport={readMarkdownForExport}
        resolveOrderedExportRecords={resolveOrderedRecords}
        onCloseExport={closeExport}
        importFileList={importFileList}
        folderPath={folderPath}
        importTargetFolder={importTargetFolder}
        importSkippedCount={importSkippedCount}
        importLimitReached={importLimitReached}
        onImported={handleImported}
        onCloseImport={() => setImportFileList(null)}
        availableUpdate={availableUpdate}
        onDismissUpdate={dismissUpdate}
        versionDiffTarget={versionDiffTarget}
        versionDiffCurrentContent={selectedFileContent ?? ""}
        isRestoringVersion={isRestoringVersion}
        onRestoreVersion={(version) => void handleVersionRestore(version)}
        onCloseVersionDiff={() => setVersionDiffTarget(null)}
      />
    </main>
  );
}

export default App;
