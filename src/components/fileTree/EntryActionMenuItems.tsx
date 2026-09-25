import type { ReactNode } from "react";
import {
  BookOpen,
  Copy,
  Download,
  FolderInput,
  Pencil,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExportMode } from "@/components/ExportDialog";

type EntryActionMenuItemsProps = {
  canRename: boolean;
  canDuplicate: boolean;
  canMove: boolean;
  canDelete: boolean;
  capabilityHint: string;
  onRename: () => void;
  onDuplicate?: () => void;
  onCopy?: () => void;
  onMove: () => void;
  onExport?: (mode: ExportMode) => void;
  onDelete: () => void;
  extraItems?: ReactNode;
};

export function EntryActionMenuItems({
  canRename,
  canDuplicate,
  canMove,
  canDelete,
  capabilityHint,
  onRename,
  onDuplicate,
  onCopy,
  onMove,
  onExport,
  onDelete,
  extraItems
}: EntryActionMenuItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!canRename}
        title={canRename ? undefined : capabilityHint}
        onClick={onRename}
      >
        <Pencil aria-hidden="true" />
        {t("fileTree.rename")}
      </button>

      {onDuplicate ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          disabled={!canDuplicate}
          title={canDuplicate ? undefined : capabilityHint}
          onClick={onDuplicate}
        >
          <Copy aria-hidden="true" />
          {t("fileTree.duplicate")}
        </button>
      ) : null}

      {onCopy ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={onCopy}
        >
          <Copy aria-hidden="true" />
          {t("fileTree.copy")}
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!canMove}
        title={canMove ? undefined : capabilityHint}
        onClick={onMove}
      >
        <FolderInput aria-hidden="true" />
        {t("fileTree.moveTo")}
      </button>

      {onExport ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => onExport("standard")}
          >
            <Download aria-hidden="true" />
            {t("fileTree.export")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => onExport("manuscript")}
          >
            <BookOpen aria-hidden="true" />
            {t("fileTree.exportManuscript")}
          </button>
        </>
      ) : null}

      {extraItems}

      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item file-tree-context-menu__item--danger"
        disabled={!canDelete}
        title={canDelete ? undefined : capabilityHint}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
        {t("fileTree.delete")}
      </button>
    </>
  );
}
