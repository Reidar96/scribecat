import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type EdgeAction =
  | "column-before"
  | "column-after"
  | "row-before"
  | "row-after";

type EdgeHandle = {
  action: EdgeAction;
  x: number;
  y: number;
  cell: HTMLTableCellElement;
};

type TableEdgeControlsProps = {
  editor: Editor;
  disabled?: boolean;
};

const EDGE_HIT_SIZE = 7;
const HANDLE_EDGE_PADDING = 13;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function selectionPosition(editor: Editor, cell: HTMLTableCellElement): number | null {
  try {
    const domPos = editor.view.posAtDOM(cell, 0);
    return Math.min(editor.state.doc.content.size, Math.max(1, domPos + 1));
  } catch {
    return null;
  }
}

function selectCell(editor: Editor, cell: HTMLTableCellElement): boolean {
  const pos = selectionPosition(editor, cell);
  return pos !== null && editor.commands.setTextSelection(pos);
}

/**
 * A one-row GFM table consists only of tableHeader cells. prosemirror-tables'
 * addRowAfter copies that cell type and would therefore create a second
 * header row. This is the small safe fallback used only for that edge case.
 */
function insertFirstBodyRow(editor: Editor, headerCell: HTMLTableCellElement): boolean {
  const selectionPos = selectionPosition(editor, headerCell);

  if (selectionPos === null) {
    return false;
  }

  const { state, view } = editor;
  const $pos = state.doc.resolve(selectionPos);
  let tableDepth = -1;

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "table") {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0) {
    return false;
  }

  const table = $pos.node(tableDepth);
  const headerRow = table.firstChild;
  const rowType = state.schema.nodes.tableRow;
  const cellType = state.schema.nodes.tableCell;

  if (!headerRow || !rowType || !cellType) {
    return false;
  }

  const cells: ProseMirrorNode[] = [];
  headerRow.forEach((header) => {
    const colspan = Math.max(1, Number(header.attrs.colspan) || 1);
    for (let index = 0; index < colspan; index += 1) {
      const cell = cellType.createAndFill();
      if (cell) cells.push(cell);
    }
  });

  if (cells.length === 0) {
    return false;
  }

  const row = rowType.create(null, cells);
  const tableStart = $pos.before(tableDepth);
  const insertAt = tableStart + 1 + headerRow.nodeSize;

  view.dispatch(state.tr.insert(insertAt, row).scrollIntoView());

  // Row -> cell -> paragraph: +3 lands inside the first empty paragraph.
  editor.commands.setTextSelection(Math.min(editor.state.doc.content.size, insertAt + 3));
  editor.commands.focus();
  return true;
}

function runAction(editor: Editor, handle: EdgeHandle): void {
  const { action, cell } = handle;

  if (!cell.isConnected) {
    return;
  }

  if (action === "column-before" || action === "column-after") {
    if (!selectCell(editor, cell)) return;

    const chain = editor.chain().focus();
    if (action === "column-before") chain.addColumnBefore().run();
    else chain.addColumnAfter().run();
    return;
  }

  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement)) {
    return;
  }

  const isHeaderRow = row.querySelector("th") !== null;

  if (action === "row-before") {
    // There must never be a row above the GFM header.
    if (isHeaderRow || !selectCell(editor, cell)) return;
    editor.chain().focus().addRowBefore().run();
    return;
  }

  if (!isHeaderRow) {
    if (!selectCell(editor, cell)) return;
    editor.chain().focus().addRowAfter().run();
    return;
  }

  // Boundary immediately below the header: inserting before the first data
  // row keeps one header row. Header-only tables need the custom fallback.
  const nextRow = row.nextElementSibling;
  const firstDataCell = nextRow?.querySelector("td");

  if (firstDataCell instanceof HTMLTableCellElement && selectCell(editor, firstDataCell)) {
    editor.chain().focus().addRowBefore().run();
    return;
  }

  insertFirstBodyRow(editor, cell);
}

export function TableEdgeControls({ editor, disabled = false }: TableEdgeControlsProps) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState<EdgeHandle | null>(null);

  useEffect(() => {
    if (disabled || editor.isDestroyed) {
      setHandle(null);
      return;
    }

    const dom = editor.view.dom;

    const onMouseMove = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const cell = target?.closest("td, th");

      if (!(cell instanceof HTMLTableCellElement) || !dom.contains(cell)) {
        setHandle(null);
        return;
      }

      const rect = cell.getBoundingClientRect();
      const row = cell.parentElement;

      if (!(row instanceof HTMLTableRowElement)) {
        setHandle(null);
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const distances: Array<{ action: EdgeAction; distance: number; x: number; y: number }> = [
        {
          action: "column-before",
          distance: Math.abs(event.clientX - rect.left),
          x: rect.left,
          y: clamp(event.clientY, rect.top + HANDLE_EDGE_PADDING, rect.bottom - HANDLE_EDGE_PADDING)
        },
        {
          action: "column-after",
          distance: Math.abs(event.clientX - rect.right),
          x: rect.right,
          y: clamp(event.clientY, rect.top + HANDLE_EDGE_PADDING, rect.bottom - HANDLE_EDGE_PADDING)
        },
        {
          action: "row-before",
          distance: Math.abs(event.clientY - rowRect.top),
          x: clamp(event.clientX, rowRect.left + HANDLE_EDGE_PADDING, rowRect.right - HANDLE_EDGE_PADDING),
          y: rowRect.top
        },
        {
          action: "row-after",
          distance: Math.abs(event.clientY - rowRect.bottom),
          x: clamp(event.clientX, rowRect.left + HANDLE_EDGE_PADDING, rowRect.right - HANDLE_EDGE_PADDING),
          y: rowRect.bottom
        }
      ];

      const isHeaderRow = row.querySelector("th") !== null;
      const candidate = distances
        .filter(({ action, distance }) => distance <= EDGE_HIT_SIZE && !(isHeaderRow && action === "row-before"))
        .sort((left, right) => left.distance - right.distance)[0];

      if (!candidate) {
        setHandle(null);
        return;
      }

      setHandle({
        action: candidate.action,
        x: candidate.x,
        y: candidate.y,
        cell
      });
    };

    const clear = () => setHandle(null);
    const onDocumentMouseMove = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        !dom.contains(target) &&
        !target.closest(".table-edge-add")
      ) {
        setHandle(null);
      }
    };

    dom.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousemove", onDocumentMouseMove);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);

    return () => {
      dom.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousemove", onDocumentMouseMove);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [disabled, editor]);

  if (!handle || disabled) {
    return null;
  }

  const label =
    handle.action === "column-before"
      ? t("tableEdge.addColumnBefore")
      : handle.action === "column-after"
        ? t("tableEdge.addColumnAfter")
        : handle.action === "row-before"
          ? t("tableEdge.addRowBefore")
          : t("tableEdge.addRowAfter");

  return createPortal(
    <button
      type="button"
      className="table-edge-add"
      aria-label={label}
      title={label}
      style={{ left: handle.x, top: handle.y }}
      onMouseDown={(event) => {
        // Keep the table/cell mapping intact until the command has run.
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = handle;
        setHandle(null);
        runAction(editor, current);
      }}
    >
      <Plus aria-hidden="true" />
    </button>,
    document.body
  );
}
