import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  Check,
  ClipboardPaste,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Folder,
  FolderArchive,
  FolderInput,
  FolderOpen,
  GripVertical,
  Home,
  ListChecks,
  SquareCheck,
  Network,
  PanelLeft,
  PanelLeftOpen,
  Printer,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExportMode } from "@/components/ExportDialog";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { EntryActionMenuItems } from "@/components/fileTree/EntryActionMenuItems";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import type { BatchEntry } from "@/components/FileTree";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { CollectionViewRequest } from "@/components/app/collectionTypes";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";
import { useBreadcrumbScroll } from "@/hooks/useBreadcrumbScroll";
import { extractTags } from "@/lib/documentFrontmatter";
import {
  getRelativeDisplayPath,
  readMarkdownFile,
  type MarkdownFileRecord
} from "@/lib/fileSystem";
import {
  buildFileTree,
  type FileTreeFolderNode,
  type FileTreeNode
} from "@/lib/fileTree";
import {
  getFolderNoteFolderPath,
  getNoteDisplayName,
  isFolderNotePath
} from "@/lib/folderNotes";
import { isJournalRelativePath } from "@/lib/journal";
import { isTasksContainerRelativePath } from "@/lib/tasks";
import {
  canDownloadFolderArchive,
  canDownloadMarkdown
} from "@/lib/export/markdownDownload";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";
import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import { join } from "@/platform/paths";
import { formatModifiedLabel } from "@/components/fileTree/treeNavigation";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type CollectionPanelProps = {
  request: CollectionViewRequest;
  folderPath: string;
  filePaths: string[];
  emptyFolderPaths: string[];
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onOpenSidebar: () => void;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (relativePath: string) => void;
  onOpenJournal?: () => void;
  onOpenGraph?: () => void;
  onOpenTasks?: () => void;
  onCreateFolder?: (name: string) => Promise<boolean>;
  onCreateNote?: (name: string) => Promise<boolean>;
  onSetSortMode: (mode: SortMode) => void;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onDuplicateFileRequest: (filePath: string) => void;
  onDuplicateFolderRequest: (folderPath: string) => void;
  onCopyRequest: (entries: BatchEntry[]) => void;
  onPasteRequest: (targetDirectory: string) => void;
  canPaste: boolean;
  onMoveRequest: (entries: BatchEntry[]) => void;
  onDeleteFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
  onDownloadMarkdownRequest: (filePath: string) => void;
  onDownloadFolderArchiveRequest: (folderPath: string, archiveName: string) => void;
  onPrintFileRequest: (filePath: string) => void;
};

type NoteCard = {
  kind: "note";
  filePath: string;
  relativePath: string;
  title: string;
  mtimeMs: number;
  folderNote: boolean;
};

type FolderCard = {
  kind: "folder";
  relativePath: string;
  title: string;
  mtimeMs: number;
};

type CollectionCard = NoteCard | FolderCard;

const COLLECTION_DRAG_MIME = "application/x-scribecat-collection-card";

function collectionCardKey(card: CollectionCard): string {
  return card.kind === "folder"
    ? `folder:${card.relativePath}`
    : `note:${card.filePath}`;
}

function findFolder(nodes: FileTreeNode[], relativePath: string): FileTreeFolderNode | null {
  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }

    if (node.relativePath === relativePath) {
      return node;
    }

    const nested = findFolder(node.children, relativePath);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parentLabel(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");

  if (isFolderNotePath(normalized)) {
    return getFolderNoteFolderPath(normalized);
  }

  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

export function CollectionPanel({
  request,
  folderPath,
  filePaths,
  emptyFolderPaths,
  fileMtimeMs,
  emptyFolderMtimeMs,
  sortMode,
  manualOrder,
  selectedFilePath,
  selectedFileContent,
  sidebarVisible,
  onSidebarVisibilityToggle,
  onOpenSidebar,
  onClose,
  onOpenFile,
  onOpenFolder,
  onOpenJournal,
  onOpenGraph,
  onOpenTasks,
  onCreateFolder,
  onCreateNote,
  onSetSortMode,
  onMoveEntry,
  onRenameFile,
  onRenameFolder,
  onDuplicateFileRequest,
  onDuplicateFolderRequest,
  onCopyRequest,
  onPasteRequest,
  canPaste,
  onMoveRequest,
  onDeleteFileRequest,
  onDeleteFolderRequest,
  onDeleteMultipleRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onExportMultipleRequest,
  onDownloadMarkdownRequest,
  onDownloadFolderArchiveRequest,
  onPrintFileRequest
}: CollectionPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  const offersExport = platform.features.exportFiles || platform.features.downloads;
  const offersMarkdownDownload = canDownloadMarkdown(folderPath);
  const offersFolderArchive = canDownloadFolderArchive(folderPath);
  const offersRevealInFileManager = platform.shell.openFolderInFileManager !== null;
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);
  const journalSettings = useEditorSettingsStore((state) => state.journalSettings);
  const taskSettings = useEditorSettingsStore((state) => state.taskSettings);
  const vaultSettingsLoadedPath = useEditorSettingsStore(
    (state) => state.headingNumberingVaultPath
  );
  const vaultSettingsReady =
    useEditorSettingsStore((state) => state.vaultSettingsReady) &&
    vaultSettingsLoadedPath === folderPath;
  const [tagsByPath, setTagsByPath] = useState<Record<string, string[]>>({});
  const [createKind, setCreateKind] = useState<"folder" | "note" | null>(null);
  const [createDraft, setCreateDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [draggedCardKey, setDraggedCardKey] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    key: string;
    position: "before" | "after";
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const { contextMenu, setContextMenu } = useContextMenuState<{
    cards: CollectionCard[];
    x: number;
    y: number;
  }>();
  const {
    contextMenu: backgroundContextMenu,
    setContextMenu: setBackgroundContextMenu
  } = useContextMenuState<{ x: number; y: number }>();

  const visibleCollectionFilePaths = useMemo(
    () =>
      filePaths.filter((filePath) => {
        const relativePath = getRelativeDisplayPath(folderPath, filePath);
        return (
          !(journalSettings.hideFromSidebar && isJournalRelativePath(relativePath, journalSettings)) &&
          !(taskSettings.hideFromSidebar &&
            isTasksContainerRelativePath(relativePath, taskSettings.folder))
        );
      }),
    [filePaths, folderPath, journalSettings, taskSettings]
  );

  const visibleCollectionFilePathSet = useMemo(
    () => new Set(visibleCollectionFilePaths),
    [visibleCollectionFilePaths]
  );

  const visibleCollectionEmptyFolderPaths = useMemo(
    () =>
      emptyFolderPaths.filter((entryPath) => {
        const relativePath = getRelativeDisplayPath(folderPath, entryPath);
        return (
          !(journalSettings.hideFromSidebar && isJournalRelativePath(relativePath, journalSettings)) &&
          !(taskSettings.hideFromSidebar &&
            isTasksContainerRelativePath(relativePath, taskSettings.folder))
        );
      }),
    [emptyFolderPaths, folderPath, journalSettings, taskSettings]
  );

  const treeNodes = useMemo(() => {
    const records: MarkdownFileRecord[] = visibleCollectionFilePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: fileMtimeMs[filePath] ?? 0
    }));

    return buildFileTree(
      records,
      visibleCollectionEmptyFolderPaths.map((path) => getRelativeDisplayPath(folderPath, path)),
      {
      sortMode,
      manualOrder,
      emptyFolderOwnMtimeMs: Object.fromEntries(
        Object.entries(emptyFolderMtimeMs).map(([absolutePath, mtimeMs]) => [
          getRelativeDisplayPath(folderPath, absolutePath),
          mtimeMs
        ])
      )
    });
  }, [
    emptyFolderMtimeMs,
    fileMtimeMs,
    folderPath,
    manualOrder,
    sortMode,
    visibleCollectionEmptyFolderPaths,
    visibleCollectionFilePaths
  ]);

  const cards = useMemo<CollectionCard[]>(() => {
    if (request.kind === "tag") {
      return request.filePaths
        .filter((filePath) => visibleCollectionFilePathSet.has(filePath))
        .map((filePath): NoteCard => {
          const relativePath = getRelativeDisplayPath(folderPath, filePath);
          return {
            kind: "note",
            filePath,
            relativePath,
            title: getNoteDisplayName(relativePath),
            mtimeMs: fileMtimeMs[filePath] ?? 0,
            folderNote: isFolderNotePath(relativePath)
          };
        })
        .sort((left, right) => {
          if (sortMode === "modified" && left.mtimeMs !== right.mtimeMs) {
            return right.mtimeMs - left.mtimeMs;
          }

          return left.title.localeCompare(
            right.title,
            i18n.resolvedLanguage ?? i18n.language,
            {
              sensitivity: "base",
              numeric: true
            }
          );
        });
    }

    // The empty relative path is the vault home. It can contain both folders
    // and notes, just like any other folder; "Start/Home" describes the place
    // without pretending everything in it is a folder.
    if (request.relativePath === "") {
      return treeNodes.map((node): CollectionCard =>
        node.kind === "folder"
          ? {
              kind: "folder",
              relativePath: node.relativePath,
              title: node.name,
              mtimeMs: node.effectiveMtimeMs
            }
          : {
              kind: "note",
              filePath: node.filePath,
              relativePath: node.relativePath,
              title: getNoteDisplayName(node.name),
              mtimeMs: node.mtimeMs,
              folderNote: false
            }
      );
    }

    const folder = findFolder(treeNodes, request.relativePath);
    if (!folder) {
      return [];
    }

    const result: CollectionCard[] = [];

    for (const child of folder.children) {
      if (child.kind === "folder") {
        result.push({
          kind: "folder",
          relativePath: child.relativePath,
          title: child.name,
          mtimeMs: child.effectiveMtimeMs
        });
      } else {
        result.push({
          kind: "note",
          filePath: child.filePath,
          relativePath: child.relativePath,
          title: getNoteDisplayName(child.name),
          mtimeMs: child.mtimeMs,
          folderNote: false
        });
      }
    }

    return result;
  }, [
    fileMtimeMs,
    folderNotesEnabled,
    folderPath,
    i18n.language,
    i18n.resolvedLanguage,
    request,
    sortMode,
    treeNodes,
    visibleCollectionFilePathSet
  ]);

  const selectedCards = useMemo(
    () => cards.filter((card) => selectedKeys.has(collectionCardKey(card))),
    [cards, selectedKeys]
  );

  useEffect(() => {
    const available = new Set(cards.map(collectionCardKey));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      if (
        next.size === current.size &&
        [...next].every((key) => current.has(key))
      ) {
        return current;
      }
      return next;
    });
  }, [cards]);

  const notePaths = useMemo(
    () => cards.flatMap((card) => (card.kind === "note" ? [card.filePath] : [])),
    [cards]
  );

  useEffect(() => {
    let active = true;

    void Promise.all(
      notePaths.map(async (filePath) => {
        const markdown =
          filePath === selectedFilePath && selectedFileContent !== null
            ? selectedFileContent
            : await readMarkdownFile(filePath).catch(() => "");

        return [filePath, extractTags(markdown)] as const;
      })
    ).then((entries) => {
      if (active) {
        setTagsByPath(Object.fromEntries(entries));
      }
    });

    return () => {
      active = false;
    };
  }, [notePaths, selectedFileContent, selectedFilePath]);

  const noteCount = cards.filter((card) => card.kind === "note").length;
  const folderCount = cards.filter((card) => card.kind === "folder").length;
  const isRootCollection = request.kind === "folder" && request.relativePath === "";
  const currentFolder =
    request.kind === "folder" && request.relativePath
      ? findFolder(treeNodes, request.relativePath)
      : null;
  const currentFolderNotePath =
    folderNotesEnabled && currentFolder?.folderNotePath ? currentFolder.folderNotePath : null;
  const title =
    request.kind === "tag"
      ? `#${request.tag}`
      : isRootCollection
        ? t("collection.root")
        : request.relativePath.split("/").filter(Boolean).pop() ?? t("collection.root");
  const folderBreadcrumbs =
    request.kind === "folder"
      ? [
          { name: t("collection.root"), relativePath: "" },
          ...request.relativePath
            .split("/")
            .filter(Boolean)
            .map((name, index, segments) => ({
              name,
              relativePath: segments.slice(0, index + 1).join("/")
            }))
        ]
      : [];
  const breadcrumbScroll = useBreadcrumbScroll<HTMLHeadingElement>(
    request.kind === "folder" ? request.relativePath || "__root__" : null
  );
  const subtitle =
    request.kind === "tag"
      ? t("collection.noteCount", { count: noteCount })
      : isRootCollection
        ? t("collection.folderSummary", { notes: noteCount, folders: folderCount })
        : folderCount > 0
          ? t("collection.folderSummary", { notes: noteCount, folders: folderCount })
          : t("collection.noteCount", { count: noteCount });

  useEffect(() => {
    setCreateKind(null);
    setCreateDraft("");
    setIsCreating(false);
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }, [request.kind, request.kind === "folder" ? request.relativePath : request.tag]);

  useEffect(() => {
    setDraggedCardKey(null);
    setDropIndicator(null);
  }, [request.kind, request.kind === "folder" ? request.relativePath : request.tag, sortMode]);

  const manualReorderEnabled =
    request.kind === "folder" && sortMode === "manual";

  const handleCardDragStart = (
    event: DragEvent<HTMLElement>,
    card: CollectionCard
  ) => {
    if (!manualReorderEnabled) return;
    const key = collectionCardKey(card);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(COLLECTION_DRAG_MIME, key);
    event.dataTransfer.setData("text/plain", card.title);
    setDraggedCardKey(key);
  };

  const handleCardDragOver = (
    event: DragEvent<HTMLElement>,
    card: CollectionCard
  ) => {
    if (
      !manualReorderEnabled ||
      !draggedCardKey ||
      collectionCardKey(card) === draggedCardKey ||
      !event.dataTransfer.types.includes(COLLECTION_DRAG_MIME)
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const position =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndicator({ key: collectionCardKey(card), position });
  };

  const handleCardDrop = async (
    event: DragEvent<HTMLElement>,
    targetCard: CollectionCard
  ) => {
    if (!manualReorderEnabled || !draggedCardKey || request.kind !== "folder") {
      return;
    }

    event.preventDefault();
    const sourceIndex = cards.findIndex(
      (card) => collectionCardKey(card) === draggedCardKey
    );
    const targetIndex = cards.findIndex(
      (card) => collectionCardKey(card) === collectionCardKey(targetCard)
    );
    const position = dropIndicator?.key === collectionCardKey(targetCard)
      ? dropIndicator.position
      : "after";

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      setDraggedCardKey(null);
      setDropIndicator(null);
      return;
    }

    const sourceCard = cards[sourceIndex];
    let insertionIndex = targetIndex + (position === "after" ? 1 : 0);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;

    const targetParentDirectory = request.relativePath
      ? await join(
          folderPath,
          ...request.relativePath.split("/").filter(Boolean)
        )
      : folderPath;
    const sourcePath =
      sourceCard.kind === "folder"
        ? await join(
            folderPath,
            ...sourceCard.relativePath.split("/").filter(Boolean)
          )
        : sourceCard.filePath;

    await onMoveEntry({
      kind: sourceCard.kind === "folder" ? "folder" : "file",
      sourcePath,
      targetParentDirectory,
      targetIndex: insertionIndex
    });

    setDraggedCardKey(null);
    setDropIndicator(null);
  };

  const absoluteFolderPath = (relativePath: string) =>
    join(folderPath, ...relativePath.split("/").filter(Boolean));

  const renameCard = async (card: CollectionCard) => {
    if (!capabilities.rename) return;

    const entered = window.prompt(t("fileTree.rename"), card.title);
    if (entered === null || !entered.trim() || entered.trim() === card.title) {
      return;
    }

    if (card.kind === "folder") {
      await onRenameFolder(await absoluteFolderPath(card.relativePath), entered.trim());
    } else {
      await onRenameFile(card.filePath, entered.trim());
    }
  };

  const resolveCardEntry = async (
    card: CollectionCard
  ): Promise<BatchEntry> => ({
    kind: card.kind === "folder" ? "folder" : "file",
    path:
      card.kind === "folder"
        ? await absoluteFolderPath(card.relativePath)
        : card.filePath
  });

  const resolveCardEntries = (items: readonly CollectionCard[]) =>
    Promise.all(items.map(resolveCardEntry));

  const copyCards = async (items: readonly CollectionCard[]) => {
    onCopyRequest(await resolveCardEntries(items));
  };

  const moveCards = async (items: readonly CollectionCard[]) => {
    if (!capabilities.move || items.length === 0) return;
    onMoveRequest(await resolveCardEntries(items));
  };

  const duplicateCards = async (items: readonly CollectionCard[]) => {
    if (!capabilities.create) return;

    for (const card of items) {
      if (card.kind === "folder") {
        onDuplicateFolderRequest(await absoluteFolderPath(card.relativePath));
      } else {
        onDuplicateFileRequest(card.filePath);
      }
    }
  };

  const deleteCards = async (items: readonly CollectionCard[]) => {
    if (!capabilities.delete || items.length === 0) return;

    if (items.length > 1) {
      onDeleteMultipleRequest(await resolveCardEntries(items));
      return;
    }

    const card = items[0];
    if (card.kind === "folder") {
      onDeleteFolderRequest(await absoluteFolderPath(card.relativePath));
    } else {
      onDeleteFileRequest(card.filePath);
    }
  };

  const exportCards = async (
    items: readonly CollectionCard[],
    mode: ExportMode
  ) => {
    if (items.length === 0) return;

    if (items.length > 1) {
      onExportMultipleRequest(await resolveCardEntries(items), mode);
      return;
    }

    const card = items[0];
    if (card.kind === "folder") {
      onExportFolderRequest(
        await absoluteFolderPath(card.relativePath),
        mode
      );
    } else {
      onExportFileRequest(card.filePath, mode);
    }
  };

  const toggleCardSelection = (card: CollectionCard) => {
    const key = collectionCardKey(card);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllCards = () => {
    setSelectedKeys(new Set(cards.map(collectionCardKey)));
  };

  const clearCardSelection = () => {
    setSelectedKeys(new Set());
  };

  const handleCardActivation = (
    event: MouseEvent<HTMLElement>,
    card: CollectionCard
  ) => {
    if (selectionMode || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleCardSelection(card);
      return;
    }

    setSelectedKeys(new Set());
    if (card.kind === "folder") {
      onOpenFolder(card.relativePath);
    } else {
      onOpenFile(card.filePath);
    }
  };

  const openCardContextMenu = (
    card: CollectionCard,
    x: number,
    y: number
  ) => {
    const key = collectionCardKey(card);
    const items =
      selectedKeys.has(key) && selectedCards.length > 1
        ? selectedCards
        : [card];

    setBackgroundContextMenu(null);
    setContextMenu({ cards: items, x, y });
  };

  const { getLongPressProps: getCardLongPressProps } =
    useLongPressContextMenu<CollectionCard>(openCardContextMenu);

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    ) {
      return;
    }

    if (selectedCards.length === 0) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void deleteCards(selectedCards);
      return;
    }

    if (event.key === "F2" && selectedCards.length === 1) {
      event.preventDefault();
      void renameCard(selectedCards[0]);
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLocaleLowerCase() === "d"
    ) {
      event.preventDefault();
      void duplicateCards(selectedCards);
    }
  };

  const contextCards = contextMenu?.cards ?? [];
  const contextCard = contextCards.length === 1 ? contextCards[0] : null;

  const beginCreate = (kind: "folder" | "note") => {
    setCreateKind(kind);
    setCreateDraft("");
  };

  const cancelCreate = () => {
    if (isCreating) return;
    setCreateKind(null);
    setCreateDraft("");
  };

  const submitCreate = async () => {
    const name = createDraft.trim();
    const create = createKind === "folder" ? onCreateFolder : onCreateNote;
    if (!name || !createKind || !create || isCreating) return;

    setIsCreating(true);
    try {
      if (await create(name)) {
        setCreateKind(null);
        setCreateDraft("");
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section
      className="collection-panel"
      aria-label={t("collection.label")}
      onKeyDown={handlePanelKeyDown}
    >
      <div className="collection-panel__card">
        <header className="collection-panel__header">
          <div className="collection-panel__header-leading">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t(layout === "phone" ? "app.openSidebar" : sidebarVisible ? "sidebar.hide" : "sidebar.show")}
              title={t(layout === "phone" ? "app.openSidebar" : sidebarVisible ? "sidebar.hide" : "sidebar.show")}
              onClick={layout === "phone" ? onOpenSidebar : onSidebarVisibilityToggle}
            >
              {layout === "phone" ? <PanelLeft /> : sidebarVisible ? <PanelLeft /> : <PanelLeftOpen />}
            </Button>

            <div className="collection-panel__heading">
              <div className="collection-panel__title-row">
                {request.kind === "tag" ? (
                  <>
                    <Tag aria-hidden="true" />
                    <h2>{title}</h2>
                  </>
                ) : (
                  <>
                    {!isRootCollection ? <FolderOpen aria-hidden="true" /> : null}
                    <h2
                      ref={breadcrumbScroll.elementRef}
                      onScroll={breadcrumbScroll.onScroll}
                      className={cn(
                        "detail-panel__breadcrumb collection-panel__breadcrumb",
                        breadcrumbScroll.isAtStart && "detail-panel__breadcrumb--at-start"
                      )}
                    >
                      <span
                        className="detail-panel__breadcrumb-text"
                        aria-label={t("collection.breadcrumb")}
                      >
                        {folderBreadcrumbs.map((crumb, index) => (
                          <span key={crumb.relativePath || "__root__"}>
                            {index > 0 ? (
                              <span className="detail-panel__crumb-separator" aria-hidden="true">
                                /
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className={cn(
                                "detail-panel__crumb detail-panel__crumb--link",
                                index === folderBreadcrumbs.length - 1 && "detail-panel__crumb--leaf"
                              )}
                              onClick={() => onOpenFolder(crumb.relativePath)}
                              title={
                                crumb.relativePath
                                  ? t("fileTree.openFolderCollection", { path: crumb.relativePath })
                                  : t("collection.openRoot")
                              }
                            >
                              {crumb.name}
                            </button>
                          </span>
                        ))}
                      </span>
                    </h2>
                    {currentFolderNotePath ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="collection-panel__folder-note-button"
                        aria-label={t("fileTree.openFolderNoteButton")}
                        title={t("fileTree.openFolderNoteButton")}
                        onClick={() => onOpenFile(currentFolderNotePath)}
                      >
                        <FileText />
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
              {!isRootCollection ? <p>{subtitle}</p> : null}
            </div>
          </div>

          <div className="collection-panel__header-actions">
            <Button
              type="button"
              size="icon-sm"
              variant={selectionMode ? "secondary" : "ghost"}
              aria-label={t("collection.selectionMode")}
              title={t("collection.selectionMode")}
              aria-pressed={selectionMode}
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelectedKeys(new Set());
                } else {
                  setSelectionMode(true);
                }
              }}
            >
              <ListChecks />
            </Button>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("sidebar.sortMode")}
                    title={t("sidebar.sortMode")}
                  >
                    <ArrowUpDown />
                  </Button>
                }
              />
              <MenuPortal>
                <MenuPositioner align="end">
                  <MenuPopup>
                    <MenuRadioGroup
                      value={sortMode}
                      onValueChange={(value) => onSetSortMode(value as SortMode)}
                    >
                      <MenuRadioItem value="name">
                        <ArrowDownAZ className="size-4" aria-hidden="true" />
                        {t("sidebar.sortModeName")}
                        <MenuRadioItemIndicator />
                      </MenuRadioItem>
                      <MenuRadioItem value="modified">
                        <Clock className="size-4" aria-hidden="true" />
                        {t("sidebar.sortModeModified")}
                        <MenuRadioItemIndicator />
                      </MenuRadioItem>
                      <MenuRadioItem value="manual">
                        <GripVertical className="size-4" aria-hidden="true" />
                        {t("sidebar.sortModeManual")}
                        <MenuRadioItemIndicator />
                      </MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </Menu>

            {!isRootCollection ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("common.goHome")}
                title={t("common.goHome")}
                onClick={onClose}
              >
                <Home />
              </Button>
            ) : null}
          </div>
        </header>

        {selectionMode ? (
          <div className="collection-panel__selection-bar">
            <span>{t("fileTree.selectionCount", { count: selectedCards.length })}</span>
            <div className="collection-panel__selection-actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={cards.length === 0 || selectedKeys.size === cards.length}
                onClick={selectAllCards}
              >
                {t("collection.selectAll")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={selectedKeys.size === 0}
                onClick={clearCardSelection}
              >
                {t("collection.clearSelection")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!capabilities.move || selectedCards.length === 0}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => void moveCards(selectedCards)}
              >
                <FolderInput aria-hidden="true" />
                {t("fileTree.moveTo")}
              </Button>
            </div>
          </div>
        ) : null}

        <div
          className="collection-panel__body"
          onContextMenu={(event) => {
            if (request.kind !== "folder") return;
            const target = event.target as HTMLElement;
            if (target.closest(".collection-card")) {
              return;
            }
            event.preventDefault();
            setContextMenu(null);
            setBackgroundContextMenu({
              x: event.clientX,
              y: event.clientY
            });
          }}
        >
          {isRootCollection ? (
            <div className="collection-home-actions">
              <Button
                type="button"
                variant="outline"
                onClick={onOpenJournal}
                disabled={!onOpenJournal}
                aria-label={t("sidebar.calendar")}
                title={t("sidebar.calendar")}
              >
                <CalendarDays />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onOpenGraph}
                disabled={!onOpenGraph}
                aria-label={t("sidebar.graph")}
                title={t("sidebar.graph")}
              >
                <Network />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onOpenTasks}
                disabled={!onOpenTasks}
                aria-label={t("sidebar.tasks")}
                title={t("sidebar.tasks")}
              >
                <SquareCheck />
              </Button>
            </div>
          ) : null}

          {!vaultSettingsReady ? (
            <div className="collection-panel__loading" aria-busy="true" />
          ) : request.kind === "tag" && cards.length === 0 ? (
            <div className="collection-panel__empty">
              <FileText aria-hidden="true" />
              <p>{t("collection.emptyTag")}</p>
            </div>
          ) : (
            <div className="collection-grid">
              {cards.map((card) => {
                const key = collectionCardKey(card);
                const cardDropPosition =
                  dropIndicator?.key === key ? dropIndicator.position : null;
                const dropTargetProps = manualReorderEnabled
                  ? {
                      onDragOver: (event: DragEvent<HTMLElement>) =>
                        handleCardDragOver(event, card),
                      onDragLeave: () => {
                        if (dropIndicator?.key === key) {
                          setDropIndicator(null);
                        }
                      },
                      onDrop: (event: DragEvent<HTMLElement>) =>
                        void handleCardDrop(event, card)
                    }
                  : {};
                const dragHandleProps = manualReorderEnabled
                  ? {
                      draggable: true,
                      onDragStart: (event: DragEvent<HTMLElement>) =>
                        handleCardDragStart(event, card),
                      onDragEnd: () => {
                        setDraggedCardKey(null);
                        setDropIndicator(null);
                      },
                      onPointerDown: (event: PointerEvent<HTMLElement>) => {
                        event.stopPropagation();
                      },
                      onClick: (event: MouseEvent<HTMLElement>) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }
                  : {};

                if (card.kind === "folder") {
                  return (
                    <article
                      key={`folder:${card.relativePath}`}
                      className={cn(
                        "collection-card collection-card--folder",
                        selectedKeys.has(key) && "collection-card--selected",
                        draggedCardKey === key && "collection-card--drag-source",
                        cardDropPosition === "before" && "collection-card--drop-before",
                        cardDropPosition === "after" && "collection-card--drop-after"
                      )}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openCardContextMenu(card, event.clientX, event.clientY);
                      }}
                      {...getCardLongPressProps(card)}
                      {...dropTargetProps}
                    >
                      <button
                        type="button"
                        className="collection-card__click-target"
                        aria-label={t("fileTree.openFolderCollection", { path: card.relativePath })}
                        aria-pressed={selectedKeys.has(key)}
                        onClick={(event) => handleCardActivation(event, card)}
                      />
                      <div className="collection-card__top">
                        <Folder aria-hidden="true" />
                        <span className="collection-card__kind">{t("collection.folder")}</span>
                        {selectionMode ? (
                          <button
                            type="button"
                            className="collection-card__selection-checkbox"
                            role="checkbox"
                            aria-checked={selectedKeys.has(key)}
                            aria-label={t(
                              selectedKeys.has(key)
                                ? "collection.deselectItem"
                                : "collection.selectItem",
                              { title: card.title }
                            )}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleCardSelection(card);
                            }}
                          >
                            {selectedKeys.has(key) ? <Check /> : null}
                          </button>
                        ) : null}
                        {manualReorderEnabled ? (
                          <span
                            className="collection-card__drag-handle"
                            title={t("collection.dragToReorder")}
                            {...dragHandleProps}
                          >
                            <GripVertical aria-hidden="true" />
                          </span>
                        ) : null}
                      </div>
                      <h3>{card.title}</h3>
                      {card.mtimeMs > 0 ? (
                        <span className="collection-card__date">
                          {formatModifiedLabel(card.mtimeMs, i18n.resolvedLanguage ?? i18n.language)}
                        </span>
                      ) : null}
                    </article>
                  );
                }

                const tags = tagsByPath[card.filePath] ?? [];
                const location = request.kind === "tag" ? parentLabel(card.relativePath) : "";

                const locationCrumbs =
                  request.kind === "tag"
                    ? [
                        { name: t("collection.root"), relativePath: "" },
                        ...location
                          .split("/")
                          .filter(Boolean)
                          .map((name, index, segments) => ({
                            name,
                            relativePath: segments.slice(0, index + 1).join("/")
                          }))
                      ]
                    : [];

                return (
                  <article
                    key={`note:${card.filePath}`}
                    className={cn(
                      "collection-card collection-card--note",
                      selectedKeys.has(key) && "collection-card--selected",
                      draggedCardKey === key && "collection-card--drag-source",
                      cardDropPosition === "before" && "collection-card--drop-before",
                      cardDropPosition === "after" && "collection-card--drop-after"
                    )}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openCardContextMenu(card, event.clientX, event.clientY);
                    }}
                    {...getCardLongPressProps(card)}
                    {...dropTargetProps}
                  >
                    <button
                      type="button"
                      className="collection-card__click-target"
                      aria-label={t("collection.openNote", { title: card.title })}
                      aria-pressed={selectedKeys.has(key)}
                      onClick={(event) => handleCardActivation(event, card)}
                    />
                    <div className="collection-card__top">
                      <FileText aria-hidden="true" />
                      <span className="collection-card__kind">
                        {t(card.folderNote ? "app.folderNoteBadge" : "collection.note")}
                      </span>
                      {selectionMode ? (
                        <button
                          type="button"
                          className="collection-card__selection-checkbox"
                          role="checkbox"
                          aria-checked={selectedKeys.has(key)}
                          aria-label={t(
                            selectedKeys.has(key)
                              ? "collection.deselectItem"
                              : "collection.selectItem",
                            { title: card.title }
                          )}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleCardSelection(card);
                          }}
                        >
                          {selectedKeys.has(key) ? <Check /> : null}
                        </button>
                      ) : null}
                      {manualReorderEnabled ? (
                        <span
                          className="collection-card__drag-handle"
                          title={t("collection.dragToReorder")}
                          {...dragHandleProps}
                        >
                          <GripVertical aria-hidden="true" />
                        </span>
                      ) : null}
                    </div>
                    <h3>{card.title}</h3>
                    {request.kind === "tag" ? (
                      <nav
                        className="collection-card__path"
                        aria-label={t("collection.noteLocation")}
                      >
                        {locationCrumbs.map((crumb, index) => (
                          <span key={crumb.relativePath || "__root__"}>
                            {index > 0 ? <span aria-hidden="true">/</span> : null}
                            <button
                              type="button"
                              onClick={() => onOpenFolder(crumb.relativePath)}
                              title={
                                crumb.relativePath
                                  ? t("fileTree.openFolderCollection", { path: crumb.relativePath })
                                  : t("collection.openRoot")
                              }
                            >
                              {crumb.name}
                            </button>
                          </span>
                        ))}
                      </nav>
                    ) : null}
                    {tags.length > 0 ? (
                      <div className="collection-card__tags" aria-label={t("tags.current")}>
                        {tags.map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {card.mtimeMs > 0 ? (
                      <span className="collection-card__date">
                        {formatModifiedLabel(card.mtimeMs, i18n.resolvedLanguage ?? i18n.language)}
                      </span>
                    ) : null}
                  </article>
                );
              })}
              {request.kind === "folder" ? (
                <div className={cn(
                  "collection-card",
                  "collection-card--create",
                  createKind && "collection-card--create-editing"
                )}>
                  {createKind ? (
                    <form
                      className="collection-card__create-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitCreate();
                      }}
                    >
                      {createKind === "folder" ? (
                        <Folder aria-hidden="true" />
                      ) : (
                        <FileText aria-hidden="true" />
                      )}
                      <input
                        autoFocus
                        value={createDraft}
                        onChange={(event) => setCreateDraft(event.target.value)}
                        placeholder={t(createKind === "folder" ? "sidebar.newFolder" : "sidebar.newFile")}
                        aria-label={t(createKind === "folder" ? "sidebar.newFolder" : "sidebar.newFile")}
                        disabled={isCreating}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelCreate();
                          }
                        }}
                      />
                      <Button
                        type="submit"
                        size="icon-sm"
                        variant="ghost"
                        disabled={!createDraft.trim() || isCreating}
                        aria-label={t("common.save")}
                        title={t("common.save")}
                      >
                        <Check />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isCreating}
                        onClick={cancelCreate}
                        aria-label={t("common.cancel")}
                        title={t("common.cancel")}
                      >
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="collection-card__create-action"
                        onClick={() => beginCreate("folder")}
                        disabled={!onCreateFolder}
                        aria-label={t("sidebar.newFolder")}
                        title={t("sidebar.newFolder")}
                      >
                        <Folder aria-hidden="true" />
                      </button>
                      <span className="collection-card__create-divider" aria-hidden="true" />
                      <button
                        type="button"
                        className="collection-card__create-action"
                        onClick={() => beginCreate("note")}
                        disabled={!onCreateNote}
                        aria-label={t("sidebar.newFile")}
                        title={t("sidebar.newFile")}
                      >
                        <FileText aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={
            contextCards.length > 1
              ? t("fileTree.selectionCount", { count: contextCards.length })
              : contextCard?.title
          }
          onClick={(event) => event.stopPropagation()}
        >
          {contextCards.length > 1 ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.create}
                title={capabilities.create ? undefined : capabilityHint}
                onClick={() => {
                  const items = [...contextCards];
                  setContextMenu(null);
                  void duplicateCards(items);
                }}
              >
                <Copy aria-hidden="true" />
                {t("fileTree.duplicate")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                onClick={() => {
                  const items = [...contextCards];
                  setContextMenu(null);
                  void copyCards(items);
                }}
              >
                <Copy aria-hidden="true" />
                {t("fileTree.copy")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item"
                disabled={!capabilities.move}
                title={capabilities.move ? undefined : capabilityHint}
                onClick={() => {
                  const items = [...contextCards];
                  setContextMenu(null);
                  void moveCards(items);
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
                      const items = [...contextCards];
                      setContextMenu(null);
                      void exportCards(items, "standard");
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
                      const items = [...contextCards];
                      setContextMenu(null);
                      void exportCards(items, "manuscript");
                    }}
                  >
                    <BookOpen aria-hidden="true" />
                    {t("fileTree.exportManuscript")}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="file-tree-context-menu__item file-tree-context-menu__item--danger"
                disabled={!capabilities.delete}
                title={capabilities.delete ? undefined : capabilityHint}
                onClick={() => {
                  const items = [...contextCards];
                  setContextMenu(null);
                  void deleteCards(items);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t("fileTree.delete")}
              </button>
            </>
          ) : contextCard ? (
            <EntryActionMenuItems
              canRename={capabilities.rename}
              canDuplicate={capabilities.create}
              canMove={capabilities.move}
              canDelete={capabilities.delete}
              capabilityHint={capabilityHint}
              onRename={() => {
                const card = contextCard;
                setContextMenu(null);
                void renameCard(card);
              }}
              onDuplicate={() => {
                const card = contextCard;
                setContextMenu(null);
                void duplicateCards([card]);
              }}
              onCopy={() => {
                const card = contextCard;
                setContextMenu(null);
                void copyCards([card]);
              }}
              onMove={() => {
                const card = contextCard;
                setContextMenu(null);
                void moveCards([card]);
              }}
              onExport={
                offersExport
                  ? (mode) => {
                      const card = contextCard;
                      setContextMenu(null);
                      void exportCards([card], mode);
                    }
                  : undefined
              }
              extraItems={
                <>
                  {contextCard.kind === "note" && offersMarkdownDownload ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="file-tree-context-menu__item"
                      onClick={() => {
                        onDownloadMarkdownRequest(contextCard.filePath);
                        setContextMenu(null);
                      }}
                    >
                      <FileDown aria-hidden="true" />
                      {t("fileTree.downloadMarkdown")}
                    </button>
                  ) : null}

                  {contextCard.kind === "folder" && offersFolderArchive ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="file-tree-context-menu__item"
                      onClick={() => {
                        void absoluteFolderPath(contextCard.relativePath).then(
                          (path) =>
                            onDownloadFolderArchiveRequest(path, contextCard.title)
                        );
                        setContextMenu(null);
                      }}
                    >
                      <FolderArchive aria-hidden="true" />
                      {t("fileTree.downloadFolderArchive")}
                    </button>
                  ) : null}

                  {contextCard.kind === "note" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="file-tree-context-menu__item"
                      onClick={() => {
                        onPrintFileRequest(contextCard.filePath);
                        setContextMenu(null);
                      }}
                    >
                      <Printer aria-hidden="true" />
                      {t("fileTree.print")}
                    </button>
                  ) : null}

                  {contextCard.kind === "folder" &&
                  offersRevealInFileManager ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="file-tree-context-menu__item"
                      onClick={() => {
                        void absoluteFolderPath(contextCard.relativePath).then(
                          (path) =>
                            platform.shell.openFolderInFileManager?.(path)
                        );
                        setContextMenu(null);
                      }}
                    >
                      <ExternalLink aria-hidden="true" />
                      {t("fileTree.revealInFileManager")}
                    </button>
                  ) : null}
                </>
              }
              onDelete={() => {
                const card = contextCard;
                setContextMenu(null);
                void deleteCards([card]);
              }}
            />
          ) : null}
        </ContextMenuSurface>
      ) : null}

      {backgroundContextMenu && request.kind === "folder" ? (
        <ContextMenuSurface
          x={backgroundContextMenu.x}
          y={backgroundContextMenu.y}
          title={title}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            disabled={!onCreateNote}
            onClick={() => {
              setBackgroundContextMenu(null);
              beginCreate("note");
            }}
          >
            <FileText aria-hidden="true" />
            {t("sidebar.newFile")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            disabled={!onCreateFolder}
            onClick={() => {
              setBackgroundContextMenu(null);
              beginCreate("folder");
            }}
          >
            <Folder aria-hidden="true" />
            {t("sidebar.newFolder")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            disabled={!canPaste || !capabilities.create}
            title={capabilities.create ? undefined : capabilityHint}
            onClick={() => {
              const relativePath = request.relativePath;
              setBackgroundContextMenu(null);
              if (relativePath) {
                void absoluteFolderPath(relativePath).then(onPasteRequest);
              } else {
                onPasteRequest(folderPath);
              }
            }}
          >
            <ClipboardPaste aria-hidden="true" />
            {t("fileTree.paste")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onSetSortMode("name");
              setBackgroundContextMenu(null);
            }}
          >
            <ArrowDownAZ aria-hidden="true" />
            {t("sidebar.sortModeName")}
            {sortMode === "name" ? <Check aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onSetSortMode("modified");
              setBackgroundContextMenu(null);
            }}
          >
            <Clock aria-hidden="true" />
            {t("sidebar.sortModeModified")}
            {sortMode === "modified" ? <Check aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              onSetSortMode("manual");
              setBackgroundContextMenu(null);
            }}
          >
            <GripVertical aria-hidden="true" />
            {t("sidebar.sortModeManual")}
            {sortMode === "manual" ? <Check aria-hidden="true" /> : null}
          </button>
        </ContextMenuSurface>
      ) : null}
    </section>
  );
}
