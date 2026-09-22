import { createPortal } from "react-dom";
import { FileCode, Type } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SelectionContextMenuState = {
  x: number;
  y: number;
};

type SelectionContextMenuProps = SelectionContextMenuState & {
  onCopyFormatted: () => void;
  onCopyMarkdown: () => void;
  onCopyPlainText: () => void;
  onClose: () => void;
};

export function SelectionContextMenu({
  x,
  y,
  onCopyFormatted,
  onCopyMarkdown,
  onCopyPlainText,
  onClose
}: SelectionContextMenuProps) {
  const { t } = useTranslation();

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      className="editor-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => run(onCopyFormatted)}>
        <span className="size-4" aria-hidden="true" />
        {t("editorContextMenu.copyFormatted")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(onCopyMarkdown)}>
        <FileCode className="size-4" aria-hidden="true" />
        {t("editorContextMenu.copyMarkdown")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(onCopyPlainText)}>
        <Type className="size-4" aria-hidden="true" />
        {t("editorContextMenu.copyPlainText")}
      </button>
    </div>,
    document.body
  );
}
