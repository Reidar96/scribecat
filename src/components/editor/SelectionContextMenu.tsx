import { useTranslation } from "react-i18next";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { formatFixedEditorShortcut } from "@/lib/shortcuts/fixed";

export type SelectionContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
};

type SelectionContextMenuProps = SelectionContextMenuState & {
  canPaste: boolean;
  onCopyFormatted: () => void;
  onCopyMarkdown: () => void;
  onCopyPlainText: () => void;
  onPaste: () => void;
  onClose: () => void;
};

export function SelectionContextMenu({
  x,
  y,
  hasSelection,
  canPaste,
  onCopyFormatted,
  onCopyMarkdown,
  onCopyPlainText,
  onPaste,
  onClose
}: SelectionContextMenuProps) {
  const { t } = useTranslation();

  const items = [
    ...(hasSelection
      ? [
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
        ]
      : []),
    ...(canPaste
      ? [
          {
            id: "paste",
            label: t("editorContextMenu.paste"),
            keys: "",
            run: onPaste
          }
        ]
      : [])
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
          {item.keys ? (
            <kbd className="file-tree-context-menu__keys">{item.keys}</kbd>
          ) : null}
        </button>
      ))}
    </ContextMenuSurface>
  );
}
