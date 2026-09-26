import { Fragment, useEffect, useMemo, useState, type RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  FolderOpen,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Search,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Editor, type EditorHandle } from "@/components/Editor";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { VersionsPopover } from "@/components/VersionsPopover";
import { DocumentMenu } from "@/components/app/DocumentMenu";
import { DocumentTabs, TAB_DRAG_MIME } from "@/components/app/DocumentTabs";
import {
  PdfViewerSurface,
  type PdfPreviewRequest
} from "@/components/PdfViewerModal";
import { join } from "@/platform/paths";
import { EmojiPickerPopover } from "@/components/EmojiPicker";
import { useBreadcrumbScroll } from "@/hooks/useBreadcrumbScroll";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { getPathCrumbs } from "@/lib/breadcrumbPath";
import { getVaultIcon, type VaultIconMap } from "@/lib/vaultIcons";
import { isDocumentLocked as getDocumentLocked } from "@/lib/documentLocks";
import { anchorForTrigger, type PopoverAnchor } from "@/lib/usePopoverOverflowAlign";
import type { FileVersion } from "@/lib/fileVersions";
import { cn } from "@/lib/utils";
import { replaceBody, splitFrontmatter } from "@/lib/documentFrontmatter";
import {
  buildVaultFileOptions,
  filterVaultFileOptions,
  getDraggedVaultFilePaths,
  getFileLinkLabel,
  FILE_LINK_DRAG_MIME
} from "@/lib/editor/fileLinks";
import { getVaultCapabilities, vaultCapabilityHint } from "@/platform";
import { isJournalRelativePath } from "@/lib/journal";
import { isTasksContainerRelativePath } from "@/lib/tasks";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";
import { useAppStore, type FileDocumentState } from "@/store/useAppStore";

type DocumentPanelProps = {
  selectedFilePath: string | null;
  selectedFileLabel: string | null;
  vaultIcons: VaultIconMap;
  /** Sets one entry's icon; the path is absolute. Only wired on the desktop. */
  onSetVaultIcon: (entryPath: string, icon: string | null) => void;
  selectedFileDirectoryLabel: string;
  /** The open note is a folder's note: titled after the folder, renaming renames the folder. */
  isSelectedFolderNote: boolean;
  folderPath: string | null;
  selectedFileContent: string | null;
  appVersion: string | null;
  filePaths: string[];
  fileDocuments: Record<string, FileDocumentState>;
  dirtyFilePaths: string[];
  openTabs: string[];
  secondaryFilePath: string | null;
  onSelectTab: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onCloseAllTabs: () => void;
  onReorderTabs: (
    draggedFilePath: string,
    targetFilePath: string,
    position: "before" | "after"
  ) => void;
  onOpenSecondary: (filePath: string) => void;
  onOpenDocumentInSplit: (request: DocumentPreviewRequest & { ownerFilePath: string }) => void;
  onClosePrimarySplit: () => void;
  onCloseSecondary: () => void;
  onSecondaryMarkdownChange: (filePath: string, markdown: string) => void;

  /** Vault-relative label of the note a back/forward step opens, null when there is none. */
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;

  isRenamingTitle: boolean;
  titleDraft: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onTitleDraftChange: (value: string) => void;
  onCommitTitleRename: () => void;
  onCancelTitleRename: () => void;
  onStartTitleRename: () => void;
  /** Opens a breadcrumb folder as a collection grid; the path is vault-relative. */
  onOpenFolderCollection: (folderRelativePath: string) => void;

  isSaving: boolean;
  isDirty: boolean;
  isSelectedFileMissing: boolean;
  isFileLoading: boolean;
  fileError: string | null;
  saveError: string | null;

  editorHandleRef: RefObject<EditorHandle | null>;
  editorFocusRequestId: number;
  onMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown: (filePath: string, markdown: string) => void;
  onRequestSidebarFocus: () => void;
  onRequestFileOpen: (targetFilePath: string) => void;
  onZenModeRequest: () => void;
  documentLocked: boolean;
  onDocumentLockToggle: () => void;
  /** Desktop/tablet: whether the vault sidebar is currently visible. */
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onVersionDiffRequest: (version: FileVersion) => void;
  onVersionRestoreRequest: (version: FileVersion) => void;

  /** Phone layout: the sidebar is a sheet and this opens it. */
  onOpenSidebar: () => void;
  /** Deletes the note currently open in the editor after confirmation. */
  onDeleteRequest: () => void;
  /** Deletes any visible split document after confirmation. */
  onDeleteFileRequest: (filePath: string) => void;
  /** Phone and tablet: the status pill doubles as the save button. */
  onSaveRequest: () => void;
};

/** Every note is a .md file, so the extension says nothing in a crumb. */
function crumbDisplayName(name: string): string {
  return name.replace(/\.md$/i, "");
}

/**
 * A crumb's icon. Only shown when one is set — the breadcrumb is the row
 * under the most pressure for space, and a default glyph in front of every
 * folder would cost exactly where the path is already too long. The tree is
 * where an icon is picked for an entry that has none.
 *
 * With a pointer, an icon that is there is also the shortcut to change it;
 * on touch (no `onPick`) it is a plain glyph, since a target this small
 * sitting inside a scrolling row is one a finger only hits by accident.
 */
function CrumbIcon({
  icon,
  onPick,
  label
}: {
  icon: string | null;
  onPick?: (anchor: PopoverAnchor) => void;
  label: string;
}) {
  if (!icon) {
    return null;
  }

  if (!onPick) {
    return (
      <span className="detail-panel__crumb-icon" aria-hidden="true">
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="detail-panel__crumb-icon detail-panel__crumb-icon--button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onPick(anchorForTrigger(event.currentTarget.getBoundingClientRect()));
      }}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export function DocumentPanel({
  selectedFilePath,
  selectedFileLabel,
  vaultIcons,
  onSetVaultIcon,
  selectedFileDirectoryLabel,
  isSelectedFolderNote,
  folderPath,
  selectedFileContent,
  appVersion,
  filePaths,
  fileDocuments,
  dirtyFilePaths,
  openTabs,
  secondaryFilePath,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onReorderTabs,
  onOpenSecondary,
  onOpenDocumentInSplit,
  onClosePrimarySplit,
  onCloseSecondary,
  onSecondaryMarkdownChange,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  isRenamingTitle,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onCommitTitleRename,
  onCancelTitleRename,
  onStartTitleRename,
  onOpenFolderCollection,
  isSaving,
  isDirty,
  isSelectedFileMissing,
  isFileLoading,
  fileError,
  saveError,
  editorHandleRef,
  editorFocusRequestId,
  onMarkdownChange,
  onCanonicalMarkdown,
  onRequestSidebarFocus,
  onRequestFileOpen,
  onZenModeRequest,
  documentLocked,
  onDocumentLockToggle,
  sidebarVisible,
  onSidebarVisibilityToggle,
  onVersionDiffRequest,
  onVersionRestoreRequest,
  onOpenSidebar,
  onDeleteRequest,
  onDeleteFileRequest,
  onSaveRequest
}: DocumentPanelProps) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  // Desktop: the editor's toolbar is portalled here, above the title row, so
  // the formatting controls sit at the top of the panel. Tablet and phone keep
  // it inside the editor, where responsive.css moves it below the text. A
  // state (not a ref) so the editor re-renders once the slot exists.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [activeEditorPane, setActiveEditorPane] = useState<"primary" | "secondary">("primary");
  const [splitRatio, setSplitRatio] = useState(50);
  const [secondarySide, setSecondarySide] = useState<"left" | "right">("right");
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [splitPickerSide, setSplitPickerSide] = useState<"left" | "right">("right");
  const [splitPickerQuery, setSplitPickerQuery] = useState("");
  const [splitDropPreview, setSplitDropPreview] = useState<"left" | "right" | null>(null);
  const [attachedPdf, setAttachedPdf] = useState<
    (PdfPreviewRequest & { ownerFilePath: string }) | null
  >(null);
  const [attachedDocument, setAttachedDocument] = useState<
    (DocumentPreviewRequest & { ownerFilePath: string }) | null
  >(null);
  const [pdfSplitRestoreRequest, setPdfSplitRestoreRequest] = useState<{
    absolutePath: string;
    requestId: number;
  } | null>(null);
  const documentLocks = useAppStore((state) => state.documentLocks);
  const setDocumentLocked = useAppStore((state) => state.setDocumentLocked);
  // Bumped by the header menu's "Versions" entry on the phone, where the
  // popover's own trigger button has no room in the header.
  const [versionsRequestId, setVersionsRequestId] = useState(0);
  const toggleDocumentLocked = () => {
    if (!documentLocked && isRenamingTitle) {
      onCancelTitleRename();
    }
    onDocumentLockToggle();
  };

  useEffect(() => {
    if (documentLocked && isRenamingTitle) {
      onCancelTitleRename();
    }
  }, [documentLocked, isRenamingTitle, onCancelTitleRename]);

  useEffect(() => {
    if (!secondaryFilePath || layout !== "desktop") {
      setActiveEditorPane("primary");
    }
  }, [layout, secondaryFilePath]);

  useEffect(() => {
    if (attachedPdf && !openTabs.includes(attachedPdf.ownerFilePath)) {
      setAttachedPdf(null);
    }
    if (attachedDocument && !openTabs.includes(attachedDocument.ownerFilePath)) {
      setAttachedDocument(null);
    }
  }, [attachedPdf, attachedDocument, openTabs]);

  // A PDF companion is rendered only while its owning Markdown tab is
  // the active (primary) document. If that tab is merely kept open in the
  // background, the attachment stays remembered but does not float beside
  // another note.
  const visibleAttachedPdf =
    attachedPdf && attachedPdf.ownerFilePath === selectedFilePath
      ? attachedPdf
      : null;
  const visibleAttachedDocument =
    attachedDocument && attachedDocument.ownerFilePath === selectedFilePath
      ? attachedDocument
      : null;
  const hasSplitContent =
    layout === "desktop" &&
    Boolean(secondaryFilePath || visibleAttachedPdf || visibleAttachedDocument);
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const closeFindPanel = useSearchStore((state) => state.closePanel);
  const autoSaveEnabled = useEditorSettingsStore((state) => state.autoSaveEnabled);
  const taskSettings = useEditorSettingsStore((state) => state.taskSettings);
  const journalSettings = useEditorSettingsStore((state) => state.journalSettings);
  // Folder crumbs always navigate to the corresponding collection grid.
  // A folder note's final crumb is also a folder, so it links back to that
  // folder collection rather than behaving like an ordinary note leaf.
  // Split on the full label: the crumbs carry the paths icons are keyed by,
  // and those keep the extension. Only the rendered name drops it, since
  // every note is a .md file and the suffix says nothing.
  const titleCrumbs = [
    { name: t("collection.root"), folderRelativePath: "", relativePath: "" },
    ...getPathCrumbs(selectedFileLabel ?? "")
  ];
  const breadcrumbScroll = useBreadcrumbScroll<HTMLHeadingElement>(selectedFileLabel ?? null);
  const [crumbIconPicker, setCrumbIconPicker] = useState<{
    relativePath: string;
    anchor: PopoverAnchor;
  } | null>(null);
  // Desktop only: see CrumbIcon. Tablet counts as touch here — the row is
  // already tight there, and the tree is one tap away.
  const canPickCrumbIcon = layout === "desktop" && folderPath !== null;

  // With auto-save on, unsaved edits are a write that is about to happen, not
  // a task for the user: the button drops the accent and goes quiet instead
  // of asking for a click. No spinner here, since the state is on for the
  // whole time someone is typing and a permanently spinning icon reads as
  // "stuck"; the spinner is kept for the write itself. It still saves on
  // click, for the impatient. A file removed underneath us stays a decision
  // either way (useAutoSave leaves it alone).
  const isAutoSavePending = autoSaveEnabled && isDirty && !isSelectedFileMissing;
  // The save button's label: visible text on the desktop, the accessible
  // name of the icon-only button on phone and tablet.
  const saveStateLabel = isSaving || isAutoSavePending
    ? t("app.statusSaving")
    : isSelectedFileMissing
      ? t("app.statusFileRemoved")
      : isDirty
        ? t("app.saveButtonTitle")
        : t("app.statusSaved");

  // Find & replace normally lives inside <Editor> (it needs the ProseMirror
  // document). Whenever no editor is mounted — no file open, or the selected
  // one still loading/failed — this standalone copy takes over so Ctrl+F is
  // never a dead shortcut; it searches the vault and jumps into the first hit.
  const editorMarkdown =
    selectedFileContent === null ? null : splitFrontmatter(selectedFileContent).body;
  const handleEditorMarkdownChange = (body: string) => {
    if (selectedFileContent !== null) {
      onMarkdownChange(replaceBody(selectedFileContent, body));
    }
  };
  const handleCanonicalMarkdown = (filePath: string, body: string) => {
    if (selectedFileContent !== null) {
      onCanonicalMarkdown(filePath, replaceBody(selectedFileContent, body));
    }
  };

  const secondaryDocument = secondaryFilePath ? fileDocuments[secondaryFilePath] ?? null : null;
  const secondaryMarkdown = secondaryDocument
    ? splitFrontmatter(secondaryDocument.content).body
    : null;
  const secondaryRelativePath =
    folderPath && secondaryFilePath
      ? secondaryFilePath.replace(/\\/g, "/").startsWith(folderPath.replace(/\\/g, "/"))
        ? secondaryFilePath
            .replace(/\\/g, "/")
            .slice(folderPath.replace(/\\/g, "/").replace(/\/$/, "").length)
            .replace(/^\//, "")
        : secondaryFilePath
      : null;
  const secondaryDocumentLocked =
    secondaryRelativePath !== null &&
    getDocumentLocked(documentLocks, secondaryRelativePath);
  const splitOptions = useMemo(
    () =>
      filterVaultFileOptions(
        buildVaultFileOptions(folderPath, filePaths, selectedFilePath).filter((option) => {
          if (option.filePath === secondaryFilePath) {
            return false;
          }

          // Task and journal documents are dedicated app surfaces, not
          // secondary editors. Keep them out of the split picker even when
          // their folders are otherwise visible in the vault.
          if (isTasksContainerRelativePath(option.relativePath, taskSettings.folder)) {
            return false;
          }

          if (isJournalRelativePath(option.relativePath, journalSettings)) {
            return false;
          }

          return true;
        }),
        splitPickerQuery,
        40
      ),
    [
      filePaths,
      folderPath,
      secondaryFilePath,
      selectedFilePath,
      splitPickerQuery,
      taskSettings.folder,
      journalSettings
    ]
  );

  const hasSplitDragPayload = (dataTransfer: DataTransfer) =>
    Array.from(dataTransfer.types).some(
      (type) => type === TAB_DRAG_MIME || type === FILE_LINK_DRAG_MIME
    );

  const splitDropFilePath = (dataTransfer: DataTransfer): string | null =>
    dataTransfer.getData(TAB_DRAG_MIME) || getDraggedVaultFilePaths(dataTransfer)[0] || null;

  const restoreInlinePdfAfterSplitClose = (
    request: PdfPreviewRequest & { ownerFilePath: string }
  ) => {
    setPdfSplitRestoreRequest((current) => ({
      absolutePath: request.absolutePath,
      requestId: (current?.requestId ?? 0) + 1
    }));
  };

  const closeAttachedPdf = () => {
    const request = attachedPdf;

    if (request) {
      restoreInlinePdfAfterSplitClose(request);
    }

    setAttachedPdf(null);
    setActiveEditorPane("primary");
  };

  const openPdfInSplit = (
    request: PdfPreviewRequest & { ownerFilePath: string }
  ) => {
    if (layout !== "desktop") return;

    setAttachedDocument(null);
    setAttachedPdf(request);
    setSecondarySide("right");
    setSplitPickerOpen(false);
    setSplitDropPreview(null);

    if (request.ownerFilePath === secondaryFilePath) {
      onClosePrimarySplit();
    } else if (request.ownerFilePath === selectedFilePath) {
      onCloseSecondary();
    }
  };

  const openDocumentInSplit = (
    request: DocumentPreviewRequest & { ownerFilePath: string }
  ) => {
    if (layout !== "desktop") return;

    setAttachedPdf(null);
    setAttachedDocument(request);
    setSecondarySide("right");
    setSplitPickerOpen(false);
    setSplitDropPreview(null);

    if (request.ownerFilePath === secondaryFilePath) {
      onClosePrimarySplit();
    } else if (request.ownerFilePath === selectedFilePath) {
      onCloseSecondary();
    }
  };

  const openSplitPickerForSide = (side: "left" | "right") => {
    setSplitPickerSide(side);
    setSplitPickerQuery("");
    setSplitPickerOpen(true);
  };

  const replaceSplitSide = (side: "left" | "right", filePath: string) => {
    setSplitPickerOpen(false);

    if (visibleAttachedPdf) {
      setAttachedPdf(null);
    }

    if (!secondaryFilePath) {
      if (filePath !== selectedFilePath) {
        setSecondarySide(side);
        onOpenSecondary(filePath);
      }
      return;
    }

    if (side === secondarySide) {
      if (filePath === selectedFilePath) {
        setSecondarySide(side === "left" ? "right" : "left");
        return;
      }
      if (filePath !== secondaryFilePath) {
        onOpenSecondary(filePath);
      }
      return;
    }

    if (filePath !== selectedFilePath) {
      onSelectTab(filePath);
    }
  };

  const handleSplitResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (layout !== "desktop") return;
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(75, Math.max(25, ratio)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const isEditorMounted =
    Boolean(selectedFilePath) &&
    !fileError &&
    !saveError &&
    !isFileLoading &&
    selectedFileContent !== null;
  const standaloneFindPanel = isEditorMounted ? null : (
    <FindReplacePanel
      editor={null}
      folderPath={folderPath}
      // Kept even though there is no editor: it tells the panel a document
      // exists but is only mid-load, which must not silently switch the user
      // into all-files mode.
      filePath={selectedFilePath}
      onClose={closeFindPanel}
      onRequestFileOpen={onRequestFileOpen}
    />
  );

  return (
    <section className="detail-panel" aria-label={t("app.documentAreaLabel")}>
      {selectedFilePath ? (
        <div className="detail-panel__card detail-panel__card--document">
          {standaloneFindPanel}
          {layout === "desktop" ? <div className="detail-panel__toolbar" ref={setToolbarSlot} /> : null}
          <div className="detail-panel__header">
            <div className="detail-panel__title">
              {layout === "phone" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="detail-panel__sidebar-button"
                  aria-label={t("app.openSidebar")}
                  title={t("app.openSidebar")}
                  data-testid="open-sidebar"
                  onClick={onOpenSidebar}
                >
                  <PanelLeft />
                </Button>
              ) : null}
              {layout !== "phone" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="detail-panel__sidebar-button"
                  aria-label={t(sidebarVisible ? "sidebar.hide" : "sidebar.show")}
                  title={t(sidebarVisible ? "sidebar.hide" : "sidebar.show")}
                  onClick={onSidebarVisibilityToggle}
                >
                  {sidebarVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Button>
              ) : null}
              {/* Navigation across notes belongs to the document as a whole, so
                  it sits with the file name rather than in the format toolbar.
                  On the phone it moves into the header menu. */}
              <div className="detail-panel__history">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={backTargetLabel === null}
                  aria-label={t("app.navigateBack")}
                  title={
                    backTargetLabel
                      ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                      : t("app.navigateBack")
                  }
                  onClick={onNavigateBack}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={forwardTargetLabel === null}
                  aria-label={t("app.navigateForward")}
                  title={
                    forwardTargetLabel
                      ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                      : t("app.navigateForward")
                  }
                  onClick={onNavigateForward}
                >
                  <ArrowRight />
                </Button>
              </div>

              {isRenamingTitle ? (
                <h2 className="detail-panel__title-edit">
                  {selectedFileDirectoryLabel ? (
                    <span className="detail-panel__title-prefix">
                      {selectedFileDirectoryLabel}
                    </span>
                  ) : null}
                  <input
                    ref={titleInputRef}
                    className="detail-panel__title-input"
                    value={titleDraft}
                    onChange={(event) => onTitleDraftChange(event.target.value)}
                    onBlur={() => onCommitTitleRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitTitleRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelTitleRename();
                      }
                    }}
                    aria-label={t(isSelectedFolderNote ? "app.folderNameLabel" : "app.fileNameLabel")}
                    spellCheck={false}
                  />
                </h2>
              ) : (
                <>
                  <h2
                    data-testid="note-title"
                    ref={breadcrumbScroll.elementRef}
                    onScroll={breadcrumbScroll.onScroll}
                    className={cn(
                      "detail-panel__breadcrumb",
                      breadcrumbScroll.isAtStart && "detail-panel__breadcrumb--at-start"
                    )}
                  >
                    {/* One bidi isolate around the crumbs, so a path mixing
                        scripts keeps its crumb boxes in reading order. */}
                    <span className="detail-panel__breadcrumb-text">
                      {titleCrumbs.map((crumb, index) => (
                        <Fragment key={crumb.folderRelativePath ?? `leaf-${index}`}>
                          {index > 0 ? (
                            <span className="detail-panel__crumb-separator" aria-hidden="true">
                              /
                            </span>
                          ) : null}
                          <CrumbIcon
                            icon={getVaultIcon(vaultIcons, crumb.relativePath)}
                            onPick={
                              canPickCrumbIcon && crumb.relativePath
                                ? (anchor) =>
                                    setCrumbIconPicker({ relativePath: crumb.relativePath, anchor })
                                : undefined
                            }
                            label={t("fileTree.changeIcon")}
                          />
                          {(() => {
                            const folderCollectionPath =
                              crumb.folderRelativePath ??
                              (isSelectedFolderNote ? crumb.relativePath : null);

                            return folderCollectionPath !== null ? (
                              <button
                                type="button"
                                className={cn(
                                  "detail-panel__crumb detail-panel__crumb--link",
                                  isSelectedFolderNote &&
                                    crumb.folderRelativePath === null &&
                                    "detail-panel__crumb--leaf"
                                )}
                                onClick={() => onOpenFolderCollection(folderCollectionPath)}
                                title={
                                  folderCollectionPath
                                    ? t("fileTree.openFolderCollection", { path: folderCollectionPath })
                                    : t("collection.openRoot")
                                }
                              >
                                {crumbDisplayName(crumb.name)}
                              </button>
                            ) : (
                              <span className="detail-panel__crumb detail-panel__crumb--leaf">
                                {crumbDisplayName(crumb.name)}
                              </span>
                            );
                          })()}
                        </Fragment>
                      ))}
                    </span>
                  </h2>
                  {crumbIconPicker && folderPath ? (
                    <EmojiPickerPopover
                      anchor={crumbIconPicker.anchor}
                      onSelect={(emoji) => {
                        void join(folderPath, crumbIconPicker.relativePath).then((path) =>
                          onSetVaultIcon(path, emoji)
                        );
                      }}
                      onClose={() => setCrumbIconPicker(null)}
                    />
                  ) : null}
                  {isSelectedFolderNote ? (
                    <span
                      className="detail-panel__title-badge"
                      title={t("app.folderNoteBadgeHint")}
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      <span className="detail-panel__title-badge-text">
                        {t("app.folderNoteBadge")}
                      </span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="detail-panel__title-edit-button"
                    onClick={onStartTitleRename}
                    disabled={documentLocked || !capabilities.rename}
                    aria-label={t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")}
                    title={
                      documentLocked
                        ? t("toolbar.unlockDocumentTitle")
                        : capabilities.rename
                          ? t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")
                          : capabilityHint
                    }
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="detail-panel__status-group">
              {versioningEnabled ? (
                <VersionsPopover
                  folderPath={folderPath}
                  selectedFilePath={selectedFilePath}
                  onDiffRequest={onVersionDiffRequest}
                  onRestoreRequest={onVersionRestoreRequest}
                  triggerHidden={layout === "phone"}
                  openRequestId={versionsRequestId}
                />
              ) : null}
              {/* The thing showing the save state is also what saves, on
                  every layout: without a keyboard there is no Ctrl+S, and
                  with one a click still beats reading a pill. The desktop
                  has room for the words; phone and tablet keep the icon
                  alone, since the word costs the width the file name needs,
                  and carry the state through the colour plus the announced
                  label. */}
              <Button
                type="button"
                size={layout === "desktop" ? "sm" : "icon-sm"}
                variant={isDirty && !isSaving && !isAutoSavePending ? "default" : "outline"}
                className={cn(
                  "detail-panel__save-button",
                  isAutoSavePending && "detail-panel__save-button--auto",
                  isSelectedFileMissing && "detail-panel__save-button--warning"
                )}
                aria-label={layout === "desktop" ? undefined : saveStateLabel}
                data-testid="status"
                data-dirty={isDirty ? "true" : "false"}
                disabled={!isDirty || isSaving}
                title={isDirty && !isSaving ? t("app.saveButtonTitle") : saveStateLabel}
                onClick={onSaveRequest}
              >
                {isSaving ? (
                  <Loader2 className="animate-spin" />
                ) : isSelectedFileMissing ? (
                  <AlertTriangle />
                ) : isDirty ? (
                  <Save />
                ) : (
                  <Check />
                )}
                {layout === "desktop" ? saveStateLabel : null}
              </Button>
              {/* A changing aria-label is not announced; where the label is
                  not visible text, the state change needs its own live
                  region. */}
              {layout === "desktop" ? null : (
                <span className="sr-only" role="status" aria-live="polite">
                  {saveStateLabel}
                </span>
              )}
              {/* The chat toggle is the format toolbar's, at the bottom of
                  the screen next to the other AI buttons: the header has no
                  width to spare and the thumb is down there anyway. */}
              {layout !== "desktop" ? (
                <DocumentMenu
                  editorHandleRef={editorHandleRef}
                  backTargetLabel={backTargetLabel}
                  forwardTargetLabel={forwardTargetLabel}
                  onNavigateBack={onNavigateBack}
                  onNavigateForward={onNavigateForward}
                  onVersionsRequest={() => setVersionsRequestId((id) => id + 1)}
                  versioningEnabled={versioningEnabled}
                  onZenModeRequest={onZenModeRequest}
                  onDeleteRequest={onDeleteRequest}
                  deleteEnabled={capabilities.delete}
                  documentLocked={documentLocked}
                  onDocumentLockToggle={toggleDocumentLocked}
                />
              ) : null}
            </div>
          </div>

          <DocumentTabs
            filePaths={openTabs}
            activeFilePath={selectedFilePath}
            dirtyFilePaths={dirtyFilePaths}
            attachedPdfOwnerFilePath={attachedPdf?.ownerFilePath ?? null}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onCloseAll={onCloseAllTabs}
            onReorder={onReorderTabs}
          />

          <div className="detail-panel__body">
            {fileError || saveError ? (
              <div className="detail-panel__message detail-panel__message--error">
                {fileError ?? saveError}
              </div>
            ) : isFileLoading || selectedFileContent === null ? (
              <div className="detail-panel__message">
                {t("app.fileLoading")}
              </div>
            ) : (
              <div
                className={cn(
                  "split-workspace",
                  hasSplitContent && "split-workspace--active"
                )}
                style={
                  hasSplitContent
                    ? ({ "--split-left": `${splitRatio}%` } as React.CSSProperties)
                    : undefined
                }
                onDragOverCapture={(event) => {
                  if (layout !== "desktop" || !hasSplitDragPayload(event.dataTransfer)) {
                    setSplitDropPreview(null);
                    return;
                  }

                  const rect = event.currentTarget.getBoundingClientRect();
                  const side =
                    event.clientX < rect.left + rect.width / 2 ? "left" : "right";
                  setSplitDropPreview(side);
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget as Node | null;
                  if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                    setSplitDropPreview(null);
                  }
                }}
                onDropCapture={(event) => {
                  if (layout !== "desktop" || !splitDropPreview) return;
                  const side = splitDropPreview;
                  const filePath = splitDropFilePath(event.dataTransfer);
                  setSplitDropPreview(null);
                  if (!filePath) return;

                  event.preventDefault();
                  event.stopPropagation();
                  setSplitPickerOpen(false);

                  if (filePath === selectedFilePath) {
                    if (hasSplitContent) {
                      setSecondarySide(side === "left" ? "right" : "left");
                    }
                    return;
                  }

                  setAttachedPdf(null);
                  setAttachedDocument(null);
                  setSecondarySide(side);
                  if (filePath !== secondaryFilePath) {
                    onOpenSecondary(filePath);
                  }
                }}
              >
                <div
                  className={cn(
                    "split-workspace__pane split-workspace__pane--primary",
                    hasSplitContent && "split-workspace__pane--primary-split"
                  )}
                  style={
                    hasSplitContent
                      ? { gridColumn: secondarySide === "left" ? 3 : 1 }
                      : undefined
                  }
                >
                  {hasSplitContent ? (
                    <div className="split-workspace__pane-header">
                      <span title={selectedFilePath}>{getFileLinkLabel(selectedFilePath)}</span>
                      <div className="split-workspace__pane-actions">
                        <button
                          type="button"
                          aria-label={t("split.replace")}
                          title={t("split.replace")}
                          onClick={() =>
                            openSplitPickerForSide(
                              secondarySide === "left" ? "right" : "left"
                            )
                          }
                        >
                          <Plus aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("split.closePane")}
                          title={t("split.closePane")}
                          onClick={() => {
                            if (visibleAttachedPdf) {
                              closeAttachedPdf();
                              return;
                            }
                            if (visibleAttachedDocument) {
                              setAttachedDocument(null);
                              setActiveEditorPane("primary");
                              return;
                            }

                            setActiveEditorPane("secondary");
                            onClosePrimarySplit();
                          }}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <Editor
                    key={selectedFilePath}
                    ref={editorHandleRef}
                    markdown={editorMarkdown ?? ""}
                    documentMarkdown={selectedFileContent}
                    onMarkdownChange={handleEditorMarkdownChange}
                    onDocumentMarkdownChange={onMarkdownChange}
                    onCanonicalMarkdown={handleCanonicalMarkdown}
                    folderPath={folderPath}
                    filePath={selectedFilePath}
                    editorFocusRequestId={editorFocusRequestId}
                    onRequestSidebarFocus={onRequestSidebarFocus}
                    onRequestFileOpen={onRequestFileOpen}
                    onOpenPdfInSplit={openPdfInSplit}
                    onOpenDocumentInSplit={openDocumentInSplit}
                    pdfSplitRestoreRequest={pdfSplitRestoreRequest}
                    onZenModeRequest={onZenModeRequest}
                    onDeleteRequest={onDeleteRequest}
                    deleteEnabled={capabilities.delete}
                    documentLocked={documentLocked}
                    onDocumentLockToggle={toggleDocumentLocked}
                    onEditorFocus={() => setActiveEditorPane("primary")}
                    hideToolbar={
                      layout === "desktop" &&
                      Boolean(secondaryFilePath) &&
                      activeEditorPane !== "primary"
                    }
                    toolbarContainer={layout === "desktop" ? toolbarSlot : null}
                  />
                </div>

                {hasSplitContent ? (
                  <>
                    <div
                      className="split-workspace__resizer"
                      style={{ gridColumn: 2 }}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("split.resize")}
                      aria-valuenow={Math.round(splitRatio)}
                      tabIndex={0}
                      onPointerDown={handleSplitResizeStart}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") {
                          event.preventDefault();
                          setSplitRatio((value) => Math.max(25, value - 5));
                        } else if (event.key === "ArrowRight") {
                          event.preventDefault();
                          setSplitRatio((value) => Math.min(75, value + 5));
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="split-workspace__swap"
                        aria-label={t("split.swap")}
                        title={t("split.swap")}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSecondarySide((side) => (side === "left" ? "right" : "left"));
                        }}
                      >
                        <ArrowLeftRight aria-hidden="true" />
                      </button>
                    </div>

                    <div
                      className={cn(
                        "split-workspace__pane split-workspace__pane--secondary",
                        visibleAttachedPdf && "split-workspace__pane--pdf",
                        `split-workspace__pane--secondary-${secondarySide}`
                      )}
                      style={{ gridColumn: secondarySide === "left" ? 1 : 3 }}
                    >
                      {visibleAttachedPdf ? (
                        <PdfViewerSurface
                          mode="split"
                          absolutePath={visibleAttachedPdf.absolutePath}
                          label={visibleAttachedPdf.label}
                          onClose={closeAttachedPdf}
                        />
                      ) : visibleAttachedDocument ? (
                        <DocumentViewer
                          mode="split"
                          absolutePath={visibleAttachedDocument.absolutePath}
                          label={visibleAttachedDocument.label}
                          onClose={() => {
                            setAttachedDocument(null);
                            setActiveEditorPane("primary");
                          }}
                        />
                      ) : secondaryFilePath && secondaryDocument && secondaryMarkdown !== null ? (
                        <>
                          <div className="split-workspace__pane-header">
                            <span title={secondaryFilePath}>{getFileLinkLabel(secondaryFilePath)}</span>
                            <div className="split-workspace__pane-actions">
                              <button
                                type="button"
                                aria-label={t("split.replace")}
                                title={t("split.replace")}
                                onClick={() => openSplitPickerForSide(secondarySide)}
                              >
                                <Plus aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={t("split.closePane")}
                                title={t("split.closePane")}
                                onClick={() => {
                                  setActiveEditorPane("primary");
                                  onCloseSecondary();
                                }}
                              >
                                <X aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <Editor
                            key={secondaryFilePath}
                            markdown={secondaryMarkdown}
                            documentMarkdown={secondaryDocument.content}
                            onMarkdownChange={(body) =>
                              onSecondaryMarkdownChange(
                                secondaryFilePath,
                                replaceBody(secondaryDocument.content, body)
                              )
                            }
                            onDocumentMarkdownChange={(markdown) =>
                              onSecondaryMarkdownChange(secondaryFilePath, markdown)
                            }
                            onCanonicalMarkdown={(filePath, body) =>
                              onCanonicalMarkdown(
                                filePath,
                                replaceBody(secondaryDocument.content, body)
                              )
                            }
                            folderPath={folderPath}
                            filePath={secondaryFilePath}
                            onRequestSidebarFocus={onRequestSidebarFocus}
                            onRequestFileOpen={onRequestFileOpen}
                            onOpenPdfInSplit={openPdfInSplit}
                            pdfSplitRestoreRequest={pdfSplitRestoreRequest}
                            onZenModeRequest={onZenModeRequest}
                            onDeleteRequest={() => onDeleteFileRequest(secondaryFilePath)}
                            deleteEnabled={capabilities.delete}
                            documentLocked={secondaryDocumentLocked}
                            onDocumentLockToggle={() =>
                              void setDocumentLocked(
                                secondaryFilePath,
                                !secondaryDocumentLocked
                              )
                            }
                            onEditorFocus={() => setActiveEditorPane("secondary")}
                            hideToolbar={activeEditorPane !== "secondary"}
                            toolbarContainer={toolbarSlot}
                          />
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {layout === "desktop" ? (
                  <>
                    {(["left", "right"] as const).map((side) => (
                      <div
                        key={side}
                        className={cn(
                          "split-workspace__edge-zone",
                          `split-workspace__edge-zone--${side}`
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "split-workspace__edge-add",
                            `split-workspace__edge-add--${side}`
                          )}
                          aria-label={t(side === "left" ? "split.openLeft" : "split.openRight")}
                          title={t(side === "left" ? "split.openLeft" : "split.openRight")}
                          onClick={() => {
                            if (splitPickerOpen && splitPickerSide === side) {
                              setSplitPickerOpen(false);
                            } else {
                              openSplitPickerForSide(side);
                            }
                          }}
                        >
                          <Plus aria-hidden="true" />
                        </button>
                      </div>
                    ))}

                    {splitPickerOpen ? (
                      <div
                        className={cn(
                          "split-picker",
                          `split-picker--${splitPickerSide}`
                        )}
                        role="dialog"
                        aria-label={t("split.pickerTitle")}
                      >
                        <label className="split-picker__search">
                          <Search aria-hidden="true" />
                          <input
                            autoFocus
                            type="search"
                            value={splitPickerQuery}
                            placeholder={t("split.search")}
                            onChange={(event) => setSplitPickerQuery(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setSplitPickerOpen(false);
                              }
                            }}
                          />
                        </label>
                        <div className="split-picker__list">
                          {splitOptions.length > 0 ? (
                            splitOptions.map((option) => (
                              <button
                                key={option.filePath}
                                type="button"
                                className="split-picker__item"
                                title={option.relativePath}
                                onClick={() =>
                                  replaceSplitSide(splitPickerSide, option.filePath)
                                }
                              >
                                <span>{option.label}</span>
                                <small>{option.relativePath}</small>
                              </button>
                            ))
                          ) : (
                            <p className="split-picker__empty">{t("split.noMatches")}</p>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {splitDropPreview ? (
                      <div
                        className={cn(
                          "split-drop-preview",
                          `split-drop-preview--${splitDropPreview}`
                        )}
                        aria-hidden="true"
                      >
                        <div className="split-drop-preview__content">
                          <Plus />
                          <strong>{t("split.dropTitle")}</strong>
                          <span>
                            {t(
                              splitDropPreview === "left"
                                ? "split.dropHintLeft"
                                : "split.dropHintRight"
                            )}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-panel__card detail-panel__card--empty">
          {standaloneFindPanel}
          {layout === "phone" || !sidebarVisible ? (
            // With no note open the document header does not exist, so the
            // sidebar restore control needs a home of its own.
            <div className="detail-panel__header detail-panel__header--empty">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="detail-panel__sidebar-button"
                aria-label={t(layout === "phone" ? "app.openSidebar" : "sidebar.show")}
                title={t(layout === "phone" ? "app.openSidebar" : "sidebar.show")}
                data-testid="open-sidebar"
                onClick={layout === "phone" ? onOpenSidebar : onSidebarVisibilityToggle}
              >
                {layout === "phone" ? <PanelLeft /> : <PanelLeftOpen />}
              </Button>
              <span className="detail-panel__app-name">ScribeCat</span>
            </div>
          ) : null}
          <p className="detail-panel__eyebrow">{t("app.emptyEyebrow")}</p>
          <h2>{t("app.emptyTitle")}</h2>
          {appVersion ? <p className="detail-panel__version">{t("app.version", { version: appVersion })}</p> : null}
        </div>
      )}
    </section>
  );
}
