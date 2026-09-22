import { useTranslation } from "react-i18next";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { formatFixedEditorShortcut } from "@/lib/shortcuts/fixed";

export type SelectionContextMenuState = { x: number; y: number };

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

  const items = [
    {
      id: "copyFormatted",
      label: t("editorContextMenu.copyFormatted"),
      keys: formatFixedEditorShortcut(t, "copyFormatted"),
      run: onCopyFormatted
    },
    {
      id: "copyMarkdown",
      label: t("editorContextMenu.copyMarkdown"),
      keys: formatFixedEditorShortcut(t, "copyMarkdown"),
      run: onCopyMarkdown
    },
    {
      id: "copyPlainText",
      label: t("editorContextMenu.copyPlainText"),
      keys: formatFixedEditorShortcut(t, "copyPlainText"),
      run: onCopyPlainText
    }
  ];

  return (
    <ContextMenuSurface x={x} y={y} onMouseDown={(event) => event.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item"
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="file-tree-context-menu__label">{item.label}</span>
          <kbd className="file-tree-context-menu__keys">{item.keys}</kbd>
        </button>
      ))}
    </ContextMenuSurface>
  );
}
