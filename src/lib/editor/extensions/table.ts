import { InputRule } from "@tiptap/core";
import BaseHardBreak from "@tiptap/extension-hard-break";
import { Table as BaseTable, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type MarkdownIt from "markdown-it";

export { TableCell, TableHeader, TableRow };

// tiptap-markdown's own table serializer only handles the subset GFM can
// express: one header row, no spans, exactly one paragraph per cell. For
// anything else it falls back to the HTML node, and with `html: false` (which
// this editor needs — see extensions/index.ts) that fallback writes the
// literal placeholder "[table]" into the file. The editor kept showing the
// table, so the loss only surfaced after the file was reopened: a whole
// table of notes gone because one cell held a list (issue #56). The same
// fallback wrote "[hardBreak]" for Shift+Enter inside a cell.
//
// This serializer never falls back. Every cell is flattened into one GFM
// cell: blocks and hard breaks become "<br>", list items get a bullet glyph,
// spans are padded out, a missing header row is promoted. Structure inside a
// cell is lost on the round trip, but no text ever is, and the file stays a
// table every Markdown tool can render. The parse side turns "<br>" inside a
// cell back into a hard break (tableLineBreakMarkdownItPlugin).

type MarkdownSerializerState = {
  out: string;
  closed: ProseMirrorNode | null;
  inTable: boolean;
  write: (content?: string) => void;
  text: (text: string, escape?: boolean) => void;
  ensureNewLine: () => void;
  closeBlock: (node: ProseMirrorNode) => void;
  renderInline: (parent: ProseMirrorNode) => void;
  render: (node: ProseMirrorNode, parent: ProseMirrorNode, index: number) => void;
};

const CELL_LINE_BREAK = "<br>";
// Non-breaking spaces: ordinary ones would be collapsed when the cell text
// is parsed back into the editor.
const NESTING_INDENT = String.fromCharCode(0xa0).repeat(2);

/** True when the selection's head sits inside a table cell. */
export function isInTableCell(state: EditorState): boolean {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;

    if (name === TableCell.name || name === TableHeader.name) {
      return true;
    }
  }

  return false;
}

// Wraps a list input rule ("- ", "1. ", "[ ] ") so it stays plain text inside
// a table cell: a Markdown cell can't hold a list, so the editor doesn't
// offer one there either. The toggle commands are guarded the same way in
// lists.ts and taskList.ts.
export function withoutTableCells(rule: InputRule): InputRule {
  return new InputRule({
    find: rule.find,
    handler: (props) => (isInTableCell(props.state) ? null : rule.handler(props)),
    undoable: rule.undoable
  });
}

// Serializes `render()`'s output into a string instead of the document, so a
// cell's lines can be joined before they are written. Only used while the
// output does not end in a newline, otherwise `write()` would put the block
// delimiter (a blockquote's "> ") into the captured text.
function capture(state: MarkdownSerializerState, render: () => void): string {
  const start = state.out.length;
  const closed = state.closed;

  render();

  const captured = state.out.slice(start);
  state.out = state.out.slice(0, start);
  // A block serializer closes its block; flushed later, that would end the
  // row with a blank line.
  state.closed = closed;

  return captured;
}

function listMarker(list: ProseMirrorNode, index: number): string {
  if (list.type.name === "orderedList") {
    // "1)" rather than "1.": the latter would be escaped as "1\." once the
    // reopened cell text is saved again.
    return `${(list.attrs.start ?? 1) + index}) `;
  }

  return "• ";
}

function taskMarker(item: ProseMirrorNode): string {
  return item.attrs.checked ? "☑ " : "☐ ";
}

// Flattens one block of a cell into lines of inline markdown. Lists keep
// their nesting as indentation; everything else contributes its text.
function flattenBlock(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  parent: ProseMirrorNode,
  index: number,
  indent: string,
  lines: string[]
): void {
  const { name } = node.type;

  if (node.isTextblock) {
    if (name === "codeBlock") {
      for (const line of node.textContent.split("\n")) {
        lines.push(indent + capture(state, () => state.text(line)));
      }

      return;
    }

    lines.push(indent + capture(state, () => state.renderInline(node)));
    return;
  }

  if (name === "bulletList" || name === "orderedList" || name === "taskList") {
    node.forEach((item, _offset, index) => {
      const marker = name === "taskList" ? taskMarker(item) : listMarker(node, index);
      flattenListItem(state, item, indent + marker, indent + NESTING_INDENT, lines);
    });

    return;
  }

  if (node.isLeaf) {
    lines.push(indent + capture(state, () => state.render(node, parent, index)).trim());
    return;
  }

  node.forEach((child, _offset, childIndex) => flattenBlock(state, child, node, childIndex, indent, lines));
}

function flattenListItem(
  state: MarkdownSerializerState,
  item: ProseMirrorNode,
  firstLinePrefix: string,
  nestedIndent: string,
  lines: string[]
): void {
  const first = item.firstChild;

  if (!first) {
    lines.push(firstLinePrefix.trimEnd());
    return;
  }

  if (first.isTextblock) {
    lines.push(firstLinePrefix + capture(state, () => state.renderInline(first)));
  } else {
    lines.push(firstLinePrefix.trimEnd());
    flattenBlock(state, first, item, 0, nestedIndent, lines);
  }

  item.forEach((child, _offset, index) => {
    if (index > 0) {
      flattenBlock(state, child, item, index, nestedIndent, lines);
    }
  });
}

// One GFM cell: lines joined with "<br>", pipes escaped so they can't end
// the cell, and no stray newline (a serializer of a nested node may add
// one) since a newline ends the row.
function serializeCell(state: MarkdownSerializerState, cell: ProseMirrorNode): string {
  const lines: string[] = [];

  cell.forEach((block, _offset, index) => flattenBlock(state, block, cell, index, "", lines));

  return lines
    .join(CELL_LINE_BREAK)
    .replace(/\n/g, CELL_LINE_BREAK)
    .replace(/\|/g, "\\|")
    .trim();
}

function serializeTable(state: MarkdownSerializerState, table: ProseMirrorNode): void {
  state.inTable = true;

  table.forEach((row, _offset, rowIndex) => {
    let columns = 0;

    state.write("| ");

    row.forEach((cell, _cellOffset, cellIndex) => {
      if (cellIndex) {
        state.write(" | ");
      }

      state.write(serializeCell(state, cell));

      // A merged cell still occupies its columns: padding them keeps every
      // row the same width, which is what a Markdown table needs.
      const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);

      for (let span = 1; span < colspan; span++) {
        state.write(" | ");
      }

      columns += colspan;
    });

    state.write(" |");
    state.ensureNewLine();

    // GFM requires a header row; the first row becomes it whatever its
    // cells were.
    if (rowIndex === 0) {
      const delimiterRow = Array.from({ length: Math.max(1, columns) }, () => "---").join(" | ");
      state.write(`| ${delimiterRow} |`);
      state.ensureNewLine();
    }
  });

  state.closeBlock(table);
  state.inTable = false;
}

// markdown-it/@types/markdown-it don't export the Token type from the package
// root, so it's derived from a signature that uses it.
type MarkdownItToken = Parameters<MarkdownIt["renderer"]["renderToken"]>[0][number];
type TokenConstructor = new (type: string, tag: string, nesting: 0 | 1 | -1) => MarkdownItToken;

const LINE_BREAK_PATTERN = /<br\s*\/?>/i;
const LINE_BREAK_SPLIT_PATTERN = /(<br\s*\/?>)/i;

// Turns a literal "<br>" inside a table cell into a hard break. With
// `html: false` markdown-it keeps the tag as text, so the line breaks the
// serializer writes would come back as "<br>" on screen. A "<br>" the user
// typed into a cell is written as "&lt;br&gt;" by the text serializer and
// stays text, so the two can't be confused. Exported for the export
// pipeline, which parses the same files with its own markdown-it.
export function tableLineBreakMarkdownItPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "scribecat_table_line_break", (state) => {
    let tableDepth = 0;

    for (const token of state.tokens) {
      if (token.type === "table_open") {
        tableDepth += 1;
      } else if (token.type === "table_close") {
        tableDepth -= 1;
      }

      if (tableDepth === 0 || token.type !== "inline" || !token.children) {
        continue;
      }

      if (!token.children.some((child) => child.type === "text" && LINE_BREAK_PATTERN.test(child.content))) {
        continue;
      }

      token.children = token.children.flatMap((child) =>
        child.type === "text" ? splitLineBreaks(child, state.Token as TokenConstructor) : [child]
      );
    }
  });
}

function splitLineBreaks(text: MarkdownItToken, Token: TokenConstructor): MarkdownItToken[] {
  const parts = text.content.split(LINE_BREAK_SPLIT_PATTERN);

  return parts.flatMap((part, index) => {
    if (index % 2 === 1) {
      return [new Token("hardbreak", "br", 0)];
    }

    if (!part) {
      return [];
    }

    const token = new Token("text", "", 0);
    token.content = part;
    token.level = text.level;

    return [token];
  });
}

export const Table = BaseTable.extend({
  // Enter inside a cell inserts a line break instead of a second
  // paragraph: that is what the file can hold, and what the user gets back
  // after reopening the note. The stock table shortcuts (Tab, arrows) stay.
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => (isInTableCell(this.editor.state) ? this.editor.commands.setHardBreak() : false)
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeTable,
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(tableLineBreakMarkdownItPlugin);
          }
        }
      }
    };
  }
});

// tiptap-markdown's hard break serializer takes the same HTML fallback inside
// a table, writing "[hardBreak]" into the cell; here it becomes the "<br>"
// the table serializer joins lines with. Outside a table it is the usual
// backslash line break. Trailing hard breaks are dropped like the stock
// serializer does, since they have no visible effect.
export const HardBreak = BaseHardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write(state.inTable ? CELL_LINE_BREAK : "\\\n");
              return;
            }
          }
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
