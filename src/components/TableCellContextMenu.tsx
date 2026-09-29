import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useTranslation } from "react-i18next";

type MenuState = { x: number; y: number; cell: HTMLTableCellElement };
type Props = { editor: Editor; disabled?: boolean };

function selectCell(editor: Editor, cell: HTMLTableCellElement): boolean {
  try {
    const pos = editor.view.posAtDOM(cell, 0);
    return editor.commands.setTextSelection(Math.min(editor.state.doc.content.size, Math.max(1, pos + 1)));
  } catch { return false; }
}

function tableInfo(editor: Editor, cell: HTMLTableCellElement) {
  try {
    const pos = editor.view.posAtDOM(cell, 0);
    const $pos = editor.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "table") {
        return { pos: $pos.before(depth), node: $pos.node(depth), row: cell.parentElement instanceof HTMLTableRowElement ? cell.parentElement.rowIndex : 0, column: cell.cellIndex };
      }
    }
  } catch { /* detached cell */ }
  return null;
}

function moveRow(editor: Editor, cell: HTMLTableCellElement, direction: -1 | 1) {
  const info = tableInfo(editor, cell);
  if (!info) return;
  const target = info.row + direction;
  if (info.row === 0 || target <= 0 || target >= info.node.childCount) return;
  const rows: ProseMirrorNode[] = [];
  info.node.forEach((row) => rows.push(row));
  [rows[info.row], rows[target]] = [rows[target], rows[info.row]];
  editor.view.dispatch(editor.state.tr.replaceWith(info.pos, info.pos + info.node.nodeSize, info.node.type.create(info.node.attrs, rows)).scrollIntoView());
}

function moveColumn(editor: Editor, cell: HTMLTableCellElement, direction: -1 | 1) {
  const info = tableInfo(editor, cell);
  if (!info) return;
  const target = info.column + direction;
  if (target < 0 || info.node.childCount === 0) return;
  const rows: ProseMirrorNode[] = [];
  info.node.forEach((row) => rows.push(row));
  if (rows.some((row) => target >= row.childCount || info.column >= row.childCount)) return;
  const moved = rows.map((row) => {
    const cells: ProseMirrorNode[] = [];
    row.forEach((node) => cells.push(node));
    [cells[info.column], cells[target]] = [cells[target], cells[info.column]];
    return row.type.create(row.attrs, cells);
  });
  editor.view.dispatch(editor.state.tr.replaceWith(info.pos, info.pos + info.node.nodeSize, info.node.type.create(info.node.attrs, moved)).scrollIntoView());
}

export function TableCellContextMenu({ editor, disabled = false }: Props) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = editor.view.dom;
    let longPress: number | null = null;
    let touchStart: { x: number; y: number; cell: HTMLTableCellElement } | null = null;
    const cancelLongPress = () => {
      if (longPress !== null) window.clearTimeout(longPress);
      longPress = null;
      touchStart = null;
    };
    const showMenu = (cell: HTMLTableCellElement, x: number, y: number) => {
      setMenu({
        x: Math.max(8, Math.min(x, window.innerWidth - 220)),
        y: Math.max(8, Math.min(y, window.innerHeight - 360)),
        cell
      });
    };
    const onContextMenu = (event: MouseEvent) => {
      if (disabled || !(event.target instanceof Element)) return;
      const cell = event.target.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement) || !root.contains(cell)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelLongPress();
      window.getSelection()?.removeAllRanges();
      showMenu(cell, event.clientX, event.clientY);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (disabled || event.pointerType !== "touch" || !(event.target instanceof Element)) return;
      const cell = event.target.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement) || !root.contains(cell)) return;
      cancelLongPress();
      touchStart = { x: event.clientX, y: event.clientY, cell };
      longPress = window.setTimeout(() => {
        longPress = null;
        if (!touchStart) return;
        window.getSelection()?.removeAllRanges();
        showMenu(touchStart.cell, touchStart.x, touchStart.y);
        touchStart = null;
      }, 550);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (touchStart && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 10) cancelLongPress();
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", cancelLongPress);
    window.addEventListener("pointercancel", cancelLongPress);
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelLongPress();
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", cancelLongPress);
      window.removeEventListener("pointercancel", cancelLongPress);
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [disabled, editor]);
  if (!menu) return null;
  const info = tableInfo(editor, menu.cell);
  if (!info) return null;
  const header = menu.cell.tagName === "TH";
  const run = (action: () => void) => { action(); setMenu(null); };
  const item = (label: string, action: () => void, danger = false, unavailable = false) => (
    <button type="button" role="menuitem" disabled={unavailable} className={danger ? "table-cell-menu__danger" : undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => run(action)}>{label}</button>
  );
  return createPortal(<div ref={menuRef} className="table-cell-menu" role="menu" aria-label={t("tableMenu.options")} style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
    {item(t("tableMenu.addRowBefore"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().addRowBefore().run(); }, false, header)}
    {item(t("tableMenu.addRowAfter"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().addRowAfter().run(); }, false, header)}
    {item(t("tableMenu.addColumnBefore"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().addColumnBefore().run(); })}
    {item(t("tableMenu.addColumnAfter"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().addColumnAfter().run(); })}
    <div role="separator" />
    {item(t("tableMenu.moveRowUp", { defaultValue: "Move row up" }), () => moveRow(editor, menu.cell, -1), false, info.row <= 1)}
    {item(t("tableMenu.moveRowDown", { defaultValue: "Move row down" }), () => moveRow(editor, menu.cell, 1), false, info.row === 0 || info.row >= info.node.childCount - 1)}
    {item(t("tableMenu.moveColumnLeft", { defaultValue: "Move column left" }), () => moveColumn(editor, menu.cell, -1), false, info.column <= 0)}
    {item(t("tableMenu.moveColumnRight", { defaultValue: "Move column right" }), () => moveColumn(editor, menu.cell, 1), false, info.column >= (menu.cell.parentElement?.children.length ?? 1) - 1)}
    <div role="separator" />
    {item(t("tableMenu.deleteRow"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().deleteRow().run(); }, true, header || info.node.childCount <= 2)}
    {item(t("tableMenu.deleteColumn"), () => { if (selectCell(editor, menu.cell)) editor.chain().focus().deleteColumn().run(); }, true)}
  </div>, document.body);
}
