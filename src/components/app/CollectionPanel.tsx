import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  FileText,
  Folder,
  FolderOpen,
  Home,
  SquareCheck,
  Network,
  PanelLeft,
  PanelLeftOpen,
  Tag,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CollectionViewRequest } from "@/components/app/collectionTypes";
import { useLayoutMode } from "@/hooks/useLayoutMode";
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
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
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
  onOpenTasks
}: CollectionPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);
  const [tagsByPath, setTagsByPath] = useState<Record<string, string[]>>({});

  const treeNodes = useMemo(() => {
    const records: MarkdownFileRecord[] = filePaths.map((filePath) => ({
      filePath,
      relativePath: getRelativeDisplayPath(folderPath, filePath),
      mtimeMs: fileMtimeMs[filePath] ?? 0
    }));

    return buildFileTree(records, emptyFolderPaths.map((path) => getRelativeDisplayPath(folderPath, path)), {
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
    emptyFolderPaths,
    fileMtimeMs,
    filePaths,
    folderPath,
    manualOrder,
    sortMode
  ]);

  const cards = useMemo<CollectionCard[]>(() => {
    if (request.kind === "tag") {
      return request.filePaths
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
          if (left.mtimeMs !== right.mtimeMs) {
            return right.mtimeMs - left.mtimeMs;
          }
          return left.title.localeCompare(right.title, undefined, {
            sensitivity: "base",
            numeric: true
          });
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
  }, [fileMtimeMs, folderNotesEnabled, folderPath, request, treeNodes]);

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

  return (
    <section className="collection-panel" aria-label={t("collection.label")}>
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
                    {isRootCollection ? <Home aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
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

          {!isRootCollection || selectedFilePath !== null ? (
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
        </header>

        <div className="collection-panel__body">
          {isRootCollection && layout === "phone" ? (
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

          {cards.length === 0 ? (
            <div className="collection-panel__empty">
              <FileText aria-hidden="true" />
              <p>{t(request.kind === "tag" ? "collection.emptyTag" : isRootCollection ? "collection.emptyRoot" : "collection.emptyFolder")}</p>
            </div>
          ) : (
            <div className="collection-grid">
              {cards.map((card) => {
                if (card.kind === "folder") {
                  return (
                    <button
                      key={`folder:${card.relativePath}`}
                      type="button"
                      className="collection-card collection-card--folder"
                      onClick={() => onOpenFolder(card.relativePath)}
                    >
                      <div className="collection-card__top">
                        <Folder aria-hidden="true" />
                        <span className="collection-card__kind">{t("collection.folder")}</span>
                      </div>
                      <h3>{card.title}</h3>
                      {card.mtimeMs > 0 ? (
                        <span className="collection-card__date">
                          {formatModifiedLabel(card.mtimeMs, i18n.resolvedLanguage ?? i18n.language)}
                        </span>
                      ) : null}
                    </button>
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
                    className="collection-card collection-card--note"
                  >
                    <button
                      type="button"
                      className="collection-card__click-target"
                      aria-label={t("collection.openNote", { title: card.title })}
                      onClick={() => onOpenFile(card.filePath)}
                    />
                    <div className="collection-card__top">
                      <FileText aria-hidden="true" />
                      <span className="collection-card__kind">
                        {t(card.folderNote ? "app.folderNoteBadge" : "collection.note")}
                      </span>
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
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
