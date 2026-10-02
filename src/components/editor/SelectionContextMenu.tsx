import { useTranslation } from "react-i18next";
import { Blocks, Code2, ImagePlus, Link2, Minus, Quote, Table2 } from "lucide-react";
import type { Editor } from "@tiptap/react";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { formatBinding } from "@/lib/shortcuts/binding";
import { formatFixedEditorShortcut } from "@/lib/shortcuts/fixed";
import { resolveBinding } from "@/lib/shortcuts/resolve";
import { useShortcutsStore } from "@/store/useShortcutsStore";

export type SelectionContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
};

type SelectionContextMenuProps = SelectionContextMenuState & {
  editor: Editor;
  canEdit: boolean;
  onCopyFormatted: () => void;
  onCopyMarkdown: () => void;
  onCopyPlainText: () => void;
  onPaste: (plainText: boolean) => void;
  onInsertImage: () => void;
  onInsertLink: () => void;
  onInsertBlock: () => void;
  onClose: () => void;
};

export function SelectionContextMenu({
  x,
  y,
  hasSelection,
  editor,
  canEdit,
  onCopyFormatted,
  onCopyMarkdown,
  onCopyPlainText,
  onPaste,
  onInsertImage,
  onInsertLink,
  onInsertBlock,
  onClose
}: SelectionContextMenuProps) {
  const { t } = useTranslation();
  const overrides = useShortcutsStore((state) => state.overrides);
  const shortcut = (id: "paste" | "pastePlainText") => {
    const binding = resolveBinding(overrides, id);
    return binding ? formatBinding(t, binding) : null;
  };

  const pasteItems = [
    { id: "paste", label: t("editorContextMenu.paste"), keys: shortcut("paste"), plainText: false },
    { id: "pastePlainText", label: t("editorContextMenu.pastePlainText"), keys: shortcut("pastePlainText"), plainText: true }
  ];
  const copyItems = hasSelection ? [
    { id: "copyFormatted", label: t("editorContextMenu.copyFormatted"), keys: formatFixedEditorShortcut(t, "copyFormatted"), run: onCopyFormatted },
    { id: "copyMarkdown", label: t("editorContextMenu.copyMarkdown"), keys: formatFixedEditorShortcut(t, "copyMarkdown"), run: onCopyMarkdown },
    { id: "copyPlainText", label: t("editorContextMenu.copyPlainText"), keys: formatFixedEditorShortcut(t, "copyPlainText"), run: onCopyPlainText }
  ] : [];
  const insertItems = canEdit ? [
    { id: "insertImage", label: t("editorContextMenu.insertImage"), icon: <ImagePlus aria-hidden="true" />, run: onInsertImage },
    { id: "insertTable", label: t("editorContextMenu.insertTable"), icon: <Table2 aria-hidden="true" />, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "insertLink", label: t("editorContextMenu.insertLink"), icon: <Link2 aria-hidden="true" />, run: onInsertLink },
    { id: "blockquote", label: t("editorContextMenu.blockquote"), icon: <Quote aria-hidden="true" />, run: () => editor.chain().focus().toggleBlockquote().run() },
    { id: "insertBlock", label: t("editorContextMenu.insertBlock"), icon: <Blocks aria-hidden="true" />, run: onInsertBlock },
    { id: "codeBlock", label: t("editorContextMenu.codeBlock"), icon: <Code2 aria-hidden="true" />, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { id: "divider", label: t("editorContextMenu.insertDivider"), icon: <Minus aria-hidden="true" />, run: () => editor.chain().focus().setHorizontalRule().run() }
  ] : [];

  return (
    <ContextMenuSurface x={x} y={y} title={t("editorContextMenu.title")} className="editor-context-menu" onMouseDown={(event) => event.preventDefault()}>
      {insertItems.length ? <div className="editor-context-menu__insert-actions" aria-label={t("editorContextMenu.insertActions")}>
        {insertItems.map((item) => <button key={item.id} type="button" role="menuitem" className="editor-context-menu__icon-action" aria-label={item.label} title={item.label}
          onClick={() => { onClose(); item.run(); }}>{item.icon}</button>)}
      </div> : null}
      {insertItems.length ? <div className="editor-context-menu__separator" role="separator" /> : null}
      {canEdit ? pasteItems.map((item) => (
        <button key={item.id} type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { onClose(); onPaste(item.plainText); }}>
          <span className="file-tree-context-menu__label">{item.label}</span>
          {item.keys ? <kbd className="file-tree-context-menu__keys">{item.keys}</kbd> : null}
        </button>
      )) : null}
      {canEdit && hasSelection ? <div className="editor-context-menu__separator" role="separator" /> : null}
      {copyItems.map((item) => (
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
