import type { ReactNode } from "react";
import {
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FolderArchive,
  FolderInput,
  Pencil,
  Printer,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExportMode } from "@/components/ExportDialog";
import { getVaultCapabilities } from "@/platform";

export type EntryContextTarget =
  | { kind: "file"; path: string; title: string }
  | { kind: "folder"; path: string; title: string };

type EntryContextMenuItemsProps = {
  target: EntryContextTarget;
  capabilityHint?: string;
  offersExport: boolean;
  offersMarkdownDownload: boolean;
  offersFolderArchive: boolean;
  offersRevealInFileManager: boolean;
  onClose: () => void;
  onRename: (target: EntryContextTarget) => void;
  onDuplicateFile: (filePath: string) => void;
  onMove: (target: EntryContextTarget) => void;
  onExport: (target: EntryContextTarget, mode: ExportMode) => void;
  onDownloadMarkdown: (filePath: string) => void;
  onDownloadFolderArchive: (folderPath: string, archiveName: string) => void;
  onPrint: (filePath: string) => void;
  onRevealFolder: (folderPath: string) => void;
  onDelete: (target: EntryContextTarget) => void;
  afterRename?: ReactNode;
};

/**
 * The actions that a file/folder has in every surface. Sidebar-specific
 * actions (new child, icon, pin/discard) stay in FileTree, while the common
 * rename/copy/move/export/delete contract is rendered here for both the tree
 * and the collection/grid view.
 */
export function EntryContextMenuItems({
  target,
  capabilityHint,
  offersExport,
  offersMarkdownDownload,
  offersFolderArchive,
  offersRevealInFileManager,
  onClose,
  onRename,
  onDuplicateFile,
  onMove,
  onExport,
  onDownloadMarkdown,
  onDownloadFolderArchive,
  onPrint,
  onRevealFolder,
  onDelete,
  afterRename
}: EntryContextMenuItemsProps) {
  const { t } = useTranslation();
  const capabilities = getVaultCapabilities();

  const closeThen = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!capabilities.rename}
        title={capabilities.rename ? undefined : capabilityHint}
        onClick={() => closeThen(() => onRename(target))}
      >
        <Pencil aria-hidden="true" />
        {t("fileTree.rename")}
      </button>

      {afterRename}

      {target.kind === "file" ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          disabled={!capabilities.create}
          title={capabilities.create ? undefined : capabilityHint}
          onClick={() => closeThen(() => onDuplicateFile(target.path))}
        >
          <Copy aria-hidden="true" />
          {t("fileTree.duplicate")}
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!capabilities.move}
        title={capabilities.move ? undefined : capabilityHint}
        onClick={() => closeThen(() => onMove(target))}
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
            onClick={() => closeThen(() => onExport(target, "standard"))}
          >
            <Download aria-hidden="true" />
            {t("fileTree.export")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => closeThen(() => onExport(target, "manuscript"))}
          >
            <BookOpen aria-hidden="true" />
            {t("fileTree.exportManuscript")}
          </button>
        </>
      ) : null}

      {target.kind === "file" && offersMarkdownDownload ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={() => closeThen(() => onDownloadMarkdown(target.path))}
        >
          <FileDown aria-hidden="true" />
          {t("fileTree.downloadMarkdown")}
        </button>
      ) : null}

      {target.kind === "folder" && offersFolderArchive ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={() =>
            closeThen(() => onDownloadFolderArchive(target.path, target.title))
          }
        >
          <FolderArchive aria-hidden="true" />
          {t("fileTree.downloadFolderArchive")}
        </button>
      ) : null}

      {target.kind === "file" ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={() => closeThen(() => onPrint(target.path))}
        >
          <Printer aria-hidden="true" />
          {t("fileTree.print")}
        </button>
      ) : null}

      {target.kind === "folder" && offersRevealInFileManager ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={() => closeThen(() => onRevealFolder(target.path))}
        >
          <ExternalLink aria-hidden="true" />
          {t("fileTree.revealInFileManager")}
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item file-tree-context-menu__item--danger"
        disabled={!capabilities.delete}
        title={capabilities.delete ? undefined : capabilityHint}
        onClick={() => closeThen(() => onDelete(target))}
      >
        <Trash2 aria-hidden="true" />
        {t("fileTree.delete")}
      </button>
    </>
  );
}
