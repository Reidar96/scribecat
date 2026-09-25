import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getFileLinkLabel } from "@/lib/editor/fileLinks";
import { cn } from "@/lib/utils";

export const TAB_DRAG_MIME = "application/x-scribecat-tab";

type DocumentTabsProps = {
  filePaths: string[];
  activeFilePath: string | null;
  dirtyFilePaths: string[];
  onSelect: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onCloseAll: () => void;
  onReorder: (draggedFilePath: string, targetFilePath: string, position: "before" | "after") => void;
};

export function DocumentTabs({
  filePaths,
  activeFilePath,
  dirtyFilePaths,
  onSelect,
  onClose,
  onCloseAll,
  onReorder
}: DocumentTabsProps) {
  const { t } = useTranslation();
  const dirtySet = new Set(dirtyFilePaths);

  if (filePaths.length === 0) {
    return null;
  }

  return (
    <div className="document-tabs-bar">
      <div className="document-tabs" role="tablist" aria-label={t("tabs.label")}>
        {filePaths.map((filePath) => {
        const active = filePath === activeFilePath;
        const label = getFileLinkLabel(filePath);

        return (
          <div
            key={filePath}
            className={cn("document-tab", active && "document-tab--active")}
            role="presentation"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copyMove";
              event.dataTransfer.setData(TAB_DRAG_MIME, filePath);
              event.dataTransfer.setData("text/plain", filePath);
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME)) return;

              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              const draggedFilePath = event.dataTransfer.getData(TAB_DRAG_MIME);
              if (!draggedFilePath || draggedFilePath === filePath) return;

              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const position =
                event.clientX < rect.left + rect.width / 2 ? "before" : "after";
              onReorder(draggedFilePath, filePath, position);
            }}
          >
            <button
              type="button"
              className="document-tab__select"
              role="tab"
              aria-selected={active}
              title={filePath}
              onClick={() => onSelect(filePath)}
            >
              <span className="document-tab__name">{label}</span>
              {dirtySet.has(filePath) ? (
                <span className="document-tab__dirty" aria-label={t("tabs.unsaved")} />
              ) : null}
            </button>
            <button
              type="button"
              className="document-tab__close"
              aria-label={t("tabs.close", { name: label })}
              title={t("tabs.close", { name: label })}
              onClick={() => onClose(filePath)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        );
        })}
      </div>
      <button
        type="button"
        className="document-tabs__close-all"
        aria-label={t("tabs.closeAll")}
        title={t("tabs.closeAll")}
        onClick={onCloseAll}
      >
        <X aria-hidden="true" />
        <span>{t("tabs.closeAll")}</span>
      </button>
    </div>
  );
}
