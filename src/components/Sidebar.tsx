import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  Check,
  Clock,
  Download,
  FileText,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Import,
  LogOut,
  Plus,
  Server,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExportMode } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { FileTree, type BatchEntry, type PendingFolderRename } from "@/components/FileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  carriesExternalFiles,
  readDropPayload,
  type DropPayload
} from "@/lib/dragDrop/droppedSources";
import { canDownloadFolderArchive } from "@/lib/export/markdownDownload";
import { formatFolderLabel, getFolderBasename } from "@/lib/fileSystem";
import { isRemoteVaultPath, remoteVaultFor } from "@/lib/remoteVaults";
import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import type { ManualOrderMap, SortMode } from "@/lib/vaultMeta";
import type { MoveTreeEntryInput } from "@/store/useAppStore";
import { DROP_DIRECTORY_ATTRIBUTE, useImportDropStore } from "@/store/useImportDropStore";

type SidebarProps = {
  folderPath: string | null;
  filePaths: string[];
  emptyFolderPaths: string[];
  selectedFilePath: string | null;
  dirtyFilePaths: string[];
  folderError: string | null;
  isLoading: boolean;
  pendingFolderRename: PendingFolderRename | null;
  sortMode: SortMode;
  manualOrder: ManualOrderMap;
  fileMtimeMs: Record<string, number>;
  emptyFolderMtimeMs: Record<string, number>;
  onOpenFolder: () => void;
  recentFolderPaths: string[];
  onOpenRecentFolder: (folderPath: string) => void;
  /** "Add server vault…"; absent where the shell cannot reach a server. */
  onAddRemoteVault?: () => void;
  onCreateFile: () => void;
  onCreateFileRequest: (targetDirectory: string) => void;
  onCreateFolder: () => void;
  onCreateFolderRequest: (targetDirectory: string) => void;
  onImportRequest: () => void;
  onSelectFilePath: (filePath: string) => Promise<void>;
  onOpenFolderNote: (folderPath: string) => Promise<void>;
  onDeleteFileRequest: (filePath: string) => void;
  onDuplicateFileRequest: (filePath: string) => void;
  onDeleteFolderRequest: (folderPath: string) => void;
  onDeleteMultipleRequest: (entries: BatchEntry[]) => void;
  onDeleteToolbarRequest: () => void;
  onExportFileRequest: (filePath: string, mode: ExportMode) => void;
  onExportFolderRequest: (folderPath: string, mode: ExportMode) => void;
  onExportMultipleRequest: (entries: BatchEntry[], mode: ExportMode) => void;
  onDownloadMarkdownRequest: (filePath: string) => void;
  onDownloadFolderArchiveRequest: (folderPath: string, archiveName: string) => void;
  onPrintFileRequest: (filePath: string) => void;
  onRenameFolder: (folderPath: string, newBaseName: string) => Promise<boolean>;
  onRenameFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onMoveEntry: (input: MoveTreeEntryInput) => Promise<boolean>;
  onMoveRequest: (entries: BatchEntry[]) => void;
  onSetSortMode: (mode: SortMode) => void;
  onAiSettingsRequest: () => void;
  onRequestEditorFocus: () => void;
  sidebarFocusRequestId: number;
  onFileTreeSelectionChange: (entries: BatchEntry[]) => void;
  fileTreeSelectionCount: number;
  // Files dragged in from outside the app, with the vault-relative folder they
  // were dropped on ("" is the vault root).
  onFilesDropped: (payload: DropPayload, targetDirectory: string) => void;
  /** Server edition only: ends the password session. */
  onLogoutRequest: () => void;
  /** Set while the panel is a sheet (phone layout); renders the close button. */
  onClose?: () => void;
};

export function Sidebar({
  folderPath,
  filePaths,
  emptyFolderPaths,
  selectedFilePath,
  dirtyFilePaths,
  folderError,
  isLoading,
  pendingFolderRename,
  sortMode,
  manualOrder,
  fileMtimeMs,
  emptyFolderMtimeMs,
  onOpenFolder,
  recentFolderPaths,
  onOpenRecentFolder,
  onAddRemoteVault,
  onCreateFile,
  onCreateFileRequest,
  onCreateFolder,
  onCreateFolderRequest,
  onImportRequest,
  onSelectFilePath,
  onOpenFolderNote,
  onDeleteFileRequest,
  onDuplicateFileRequest,
  onDeleteFolderRequest,
  onDeleteMultipleRequest,
  onDeleteToolbarRequest,
  onExportFileRequest,
  onExportFolderRequest,
  onExportMultipleRequest,
  onDownloadMarkdownRequest,
  onDownloadFolderArchiveRequest,
  onPrintFileRequest,
  onRenameFolder,
  onRenameFile,
  onMoveEntry,
  onMoveRequest,
  onSetSortMode,
  onAiSettingsRequest,
  onRequestEditorFocus,
  sidebarFocusRequestId,
  onFileTreeSelectionChange,
  fileTreeSelectionCount,
  onFilesDropped,
  onLogoutRequest,
  onClose
}: SidebarProps) {
  const { t } = useTranslation();

  // A server vault whose entry is gone (forgotten in the settings) has
  // nothing to open; the recent list is cleaned on forget, this is the net.
  const recentVaults = recentFolderPaths
    .map((path) => ({ path, remote: remoteVaultFor(path) }))
    .filter(({ path, remote }) => remote !== null || !isRemoteVaultPath(path));
  const folderLabel = formatFolderLabel(folderPath);
  // A vault on a server, whether this is the browser (always) or the desktop
  // app opened one: the name gets the same server mark the recent list uses.
  const isServerVault = folderPath !== null && (platform.kind === "web" || remoteVaultFor(folderPath) !== null);
  // The name is clipped at its start (sidebar.css), which takes an RTL
  // block — and RTL alone reorders anything with digits in it, turning
  // "192.168.1.5/stephan/" into "stephan/192.168.1.5". The isolate keeps the
  // characters in reading order inside that block.
  const folderLabelContent = (
    <>
      {isServerVault ? <Server className="size-4 sidebar-panel__folder-kind" aria-hidden="true" /> : null}
      <span className="sidebar-panel__folder-name">
        <bdi dir="ltr">{folderLabel}</bdi>
      </span>
    </>
  );
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Same conditions as the tree's context menu (see FileTree): the rendered
  // export needs a folder or a download, the raw ZIP a storage that packs.
  const offersExport = platform.features.exportFiles || platform.features.downloads;
  const offersVaultArchive = canDownloadFolderArchive(folderPath);

  const openRootContextMenu = (event: React.MouseEvent) => {
    if (folderPath === null || !(offersExport || offersVaultArchive)) {
      return;
    }

    event.preventDefault();
    setRootContextMenu({ x: event.clientX, y: event.clientY });
  };

  // Files dragged in from outside the app land as imported notes. Drags that
  // start inside the tree (reordering, or dragging a note into the editor) are
  // none of this handler's business and are left to bubble untouched.
  const importTargetDirectory = useImportDropStore((state) => state.targetDirectory);
  const setImportTargetDirectory = useImportDropStore((state) => state.setTargetDirectory);
  const isDropTarget = importTargetDirectory !== null;

  const handleFileDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (folderPath === null || !carriesExternalFiles(event.dataTransfer)) {
      return;
    }

    // Without this the webview handles the drop itself and navigates away from
    // the app to the dropped file.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    // The row under the pointer decides the target folder; a file row hands the
    // drop to the folder it lives in, and bare panel space to the vault root.
    const target = event.target instanceof Element ? event.target : null;
    const directory =
      target?.closest(`[${DROP_DIRECTORY_ATTRIBUTE}]`)?.getAttribute(DROP_DIRECTORY_ATTRIBUTE) ?? "";

    setImportTargetDirectory(directory);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLElement>) => {
    // Crossing from one child of the panel into the next fires dragleave on the
    // one being left; only a pointer that really left the panel ends the state.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setImportTargetDirectory(null);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLElement>) => {
    if (folderPath === null || !carriesExternalFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();

    const directory = importTargetDirectory ?? "";

    setImportTargetDirectory(null);
    // The transfer is emptied as soon as this handler returns, so what was
    // dropped is taken out of it here and only walked afterwards.
    onFilesDropped(readDropPayload(event.dataTransfer), directory);
  };

  // Same dismissal rules as the tree's own menu (useTreeContextMenu): any
  // click, a competing right-click, a scroll or Escape closes it.
  useEffect(() => {
    if (!rootContextMenu) {
      return;
    }

    const close = () => setRootContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rootContextMenu]);

  return (
    <aside
      className={`sidebar-panel${isDropTarget ? " sidebar-panel--drop-target" : ""}`}
      aria-label={t("sidebar.filesLabel")}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {isDropTarget ? (
        <div className="sidebar-panel__dropzone" aria-hidden="true">
          <Import className="size-5" />
          <span>{t("sidebar.dropImportHint")}</span>
        </div>
      ) : null}

      <div className="sidebar-panel__header">
        <div className="sidebar-panel__actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFolder}
            disabled={isLoading || folderPath === null || !capabilities.create}
            aria-label={t("sidebar.newFolder")}
            title={capabilities.create ? t("sidebar.newFolder") : capabilityHint}
          >
            <FolderPlus />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateFile}
            disabled={isLoading || folderPath === null || !capabilities.create}
            aria-label={t("sidebar.newFile")}
            title={capabilities.create ? t("sidebar.newFile") : capabilityHint}
          >
            <Plus />
          </Button>

          {platform.features.importFiles ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onImportRequest}
              disabled={isLoading || folderPath === null}
              aria-label={t("sidebar.importFiles")}
              title={t("sidebar.importFiles")}
            >
              <Import />
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDeleteToolbarRequest}
            disabled={isLoading || !capabilities.delete || (selectedFilePath === null && fileTreeSelectionCount === 0)}
            aria-label={t("sidebar.deleteFile")}
            title={capabilities.delete ? t("sidebar.deleteSelectedFile") : capabilityHint}
          >
            <Trash2 />
          </Button>

          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isLoading || folderPath === null}
                  aria-label={t("sidebar.sortMode")}
                  title={t("sidebar.sortMode")}
                >
                  <ArrowUpDown />
                </Button>
              }
            />
            <MenuPortal>
              <MenuPositioner>
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

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAiSettingsRequest}
            aria-label={t("sidebar.settings")}
            title={t("sidebar.settings")}
            data-testid="settings"
          >
            <Settings2 />
          </Button>

          {platform.features.session ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLogoutRequest}
              aria-label={t("sidebar.logout")}
              title={t("sidebar.logout")}
              data-testid="logout"
            >
              <LogOut />
            </Button>
          ) : null}
        </div>
        <div className="sidebar-panel__folder-wrap">
          {onClose ? (
            // In the sheet the vault name row has the room the action row
            // has not; the close button sits at its end.
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sidebar-panel__close"
              onClick={onClose}
              aria-label={t("sidebar.close")}
              title={t("sidebar.close")}
              data-testid="sidebar-close"
            >
              <X />
            </Button>
          ) : null}
          {platform.features.localFolders ? (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className="sidebar-panel__folder"
                    disabled={isLoading}
                    title={folderPath ?? t("sidebar.openFolder")}
                    aria-label={t("sidebar.openRecentFolder")}
                    // The vault root is the natural target for "export the whole
                    // book", but it is not a row in the tree — so it carries its
                    // own (unrelated) right-click menu alongside this one.
                    onContextMenu={openRootContextMenu}
                  />
                }
              >
                {folderLabelContent}
              </MenuTrigger>
              <MenuPortal>
                <MenuPositioner align="start">
                  <MenuPopup>
                    {recentVaults.length > 0 ? (
                      <>
                        {recentVaults.map(({ path, remote }) => (
                          <MenuItem
                            key={path}
                            className="sidebar-panel__recent-folder-item"
                            title={remote ? remote.url : path}
                            onClick={() => onOpenRecentFolder(path)}
                            data-testid={remote ? "recent-remote-vault" : undefined}
                          >
                            {path === folderPath ? (
                              <Check className="size-4" aria-hidden="true" />
                            ) : (
                              <span className="size-4" aria-hidden="true" />
                            )}
                            {remote ? <Server className="size-4 sidebar-panel__recent-folder-kind" aria-hidden="true" /> : null}
                            <span className="sidebar-panel__recent-folder-name">
                              {remote ? remote.name : getFolderBasename(path)}
                            </span>
                          </MenuItem>
                        ))}
                        <div className="editor-toolbar__menu-separator" role="separator" />
                      </>
                    ) : null}
                    <MenuItem onClick={onOpenFolder}>
                      <FolderOpen className="size-4" aria-hidden="true" />
                      {t("sidebar.browseForFolder")}
                    </MenuItem>
                    {onAddRemoteVault ? (
                      <MenuItem onClick={onAddRemoteVault} data-testid="add-remote-vault">
                        <Server className="size-4" aria-hidden="true" />
                        {t("sidebar.addServerVault")}
                      </MenuItem>
                    ) : null}
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </Menu>
          ) : (
            // One vault, nothing to switch to: the name is a label, not a menu.
            <div
              className="sidebar-panel__folder sidebar-panel__folder--static"
              title={folderLabel}
              onContextMenu={openRootContextMenu}
              data-testid="vault-name"
            >
              {folderLabelContent}
            </div>
          )}
        </div>
      </div>

      {rootContextMenu && folderPath !== null && (offersExport || offersVaultArchive)
        ? createPortal(
            <div
              className="file-tree-context-menu"
              role="menu"
              style={{ top: rootContextMenu.y, left: rootContextMenu.x }}
              onClick={(event) => event.stopPropagation()}
            >
              {offersExport ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="file-tree-context-menu__item"
                    onClick={() => {
                      onExportFolderRequest(folderPath, "standard");
                      setRootContextMenu(null);
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
                      onExportFolderRequest(folderPath, "manuscript");
                      setRootContextMenu(null);
                    }}
                  >
                    <BookOpen aria-hidden="true" />
                    {t("fileTree.exportManuscript")}
                  </button>
                </>
              ) : null}
              {offersVaultArchive ? (
                <button
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu__item"
                  onClick={() => {
                    // The root has no folder name of its own; the label the
                    // sidebar shows (server name or host) names the archive.
                    onDownloadFolderArchiveRequest(folderPath, folderLabel);
                    setRootContextMenu(null);
                  }}
                >
                  <FolderArchive aria-hidden="true" />
                  {t("fileTree.downloadFolderArchive")}
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {folderError ? (
        <div className="sidebar-panel__message sidebar-panel__message--error">
          {folderError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="sidebar-panel__message">{t("sidebar.searchingFolder")}</div>
      ) : folderPath === null ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FolderOpen />
          <p>{t("sidebar.openFolderPrompt")}</p>
        </button>
      ) : filePaths.length === 0 && emptyFolderPaths.length === 0 ? (
        <button
          type="button"
          className="sidebar-panel__empty sidebar-panel__empty--interactive"
          onClick={onOpenFolder}
          disabled={isLoading}
        >
          <FileText />
          <p>{t("sidebar.noMarkdownFiles")}</p>
        </button>
      ) : null}

      <ScrollArea className="sidebar-panel__scroll">
        {folderPath !== null && (filePaths.length > 0 || emptyFolderPaths.length > 0) ? (
          <FileTree
            key={folderPath}
            folderPath={folderPath}
            filePaths={filePaths}
            emptyFolderPaths={emptyFolderPaths}
            selectedFilePath={selectedFilePath}
            dirtyFilePaths={dirtyFilePaths}
            pendingFolderRename={pendingFolderRename}
            sortMode={sortMode}
            manualOrder={manualOrder}
            fileMtimeMs={fileMtimeMs}
            emptyFolderMtimeMs={emptyFolderMtimeMs}
            onSelectFilePath={onSelectFilePath}
            onOpenFolderNote={onOpenFolderNote}
            onCreateFileRequest={onCreateFileRequest}
            onCreateFolderRequest={onCreateFolderRequest}
            onDeleteFileRequest={onDeleteFileRequest}
            onDuplicateFileRequest={onDuplicateFileRequest}
            onDeleteFolderRequest={onDeleteFolderRequest}
            onDeleteMultipleRequest={onDeleteMultipleRequest}
            onExportFileRequest={onExportFileRequest}
            onExportFolderRequest={onExportFolderRequest}
            onExportMultipleRequest={onExportMultipleRequest}
            onDownloadMarkdownRequest={onDownloadMarkdownRequest}
            onDownloadFolderArchiveRequest={onDownloadFolderArchiveRequest}
            onPrintFileRequest={onPrintFileRequest}
            onRenameFolder={onRenameFolder}
            onRenameFile={onRenameFile}
            onMoveEntry={onMoveEntry}
            onMoveRequest={onMoveRequest}
            onRequestEditorFocus={onRequestEditorFocus}
            focusRequestId={sidebarFocusRequestId}
            onSelectionChange={onFileTreeSelectionChange}
          />
        ) : null}
      </ScrollArea>
    </aside>
  );
}