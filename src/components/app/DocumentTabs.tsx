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
};

export function DocumentTabs({
  filePaths,
  activeFilePath,
  dirtyFilePaths,
  onSelect,
  onClose
}: DocumentTabsProps) {
  const { t } = useTranslation();
  const dirtySet = new Set(dirtyFilePaths);

  if (filePaths.length === 0) {
    return null;
  }

  return (
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
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(TAB_DRAG_MIME, filePath);
              event.dataTransfer.setData("text/plain", filePath);
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
  );
}
