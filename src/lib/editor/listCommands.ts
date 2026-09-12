import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Shared implementation behind moveListItem and moveLine: swaps the node(s)
// at `depth` that the selection spans with the adjacent sibling in that
// direction. Both callers just pick a different depth — a list item's own
// depth for moveListItem, or 1 (direct children of the doc) for moveLine —
// everything else about "find the sibling, swap the ranges, shift the
// selection by the sibling's size" is identical.
function moveSiblingsAtDepth(view: EditorView, direction: "up" | "down", depth: number): boolean {
  const { state } = view;
  const { $from, $to, from, to } = state.selection;

  if ($from.depth < depth || $to.depth < depth) {
    return false;
  }

  const parentDepth = depth - 1;
  const parent = $from.node(parentDepth);

  if ($to.node(parentDepth) !== parent) {
    return false;
  }

  const startIndex = $from.index(parentDepth);
  const endIndex = $to.index(parentDepth);
  const targetIndex = direction === "up" ? startIndex - 1 : endIndex + 1;

  if (targetIndex < 0 || targetIndex >= parent.childCount) {
    return false;
  }

  const rangeStart = $from.before(depth);
  const rangeEnd = $to.after(depth);
  const sibling = parent.child(targetIndex);

  const selectedNodes: ProseMirrorNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    selectedNodes.push(parent.child(i));
  }

  const replacement =
    direction === "up" ? Fragment.from([...selectedNodes, sibling]) : Fragment.from([sibling, ...selectedNodes]);
  const newRangeStart = direction === "up" ? rangeStart - sibling.nodeSize : rangeStart;
  const newRangeEnd = direction === "up" ? rangeEnd : rangeEnd + sibling.nodeSize;
  const offset = direction === "up" ? -sibling.nodeSize : sibling.nodeSize;

  const tr = state.tr.replaceWith(newRangeStart, newRangeEnd, replacement);
  tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}

// Moves the list item (bullet, numbered, or task) the selection is currently
// in — or the range of sibling items it spans — one position up or down.
// ProseMirror has no built-in command for this, so the affected range is
// manually replaced with the sibling nodes swapped.
export function moveListItem(view: EditorView, direction: "up" | "down"): boolean {
  const { $from } = view.state.selection;

  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    const nodeTypeName = $from.node(depth).type.name;
    if (nodeTypeName === "listItem" || nodeTypeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  if (listItemDepth === -1) {
    return false;
  }

  return moveSiblingsAtDepth(view, direction, listItemDepth);
}

// Moves the top-level block(s) (paragraph, heading, blockquote, code block,
// etc.) the selection spans one position up or down, the same way VS Code's
// Alt+Up/Down moves whole lines. This is the fallback for content that isn't
// inside a list — moveListItem takes priority there.
export function moveLine(view: EditorView, direction: "up" | "down"): boolean {
  return moveSiblingsAtDepth(view, direction, 1);
}

// Toggles the checked state of the task item the cursor is currently in.
// TipTap's task-item extension only flips this attribute via a click on the
// rendered checkbox, so this walks up to the enclosing taskItem node and
// flips its "checked" attribute directly for keyboard-driven use.
export function toggleTaskItemChecked(view: EditorView): boolean {
  const { state } = view;
  const { $from } = state.selection;

  let taskItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "taskItem") {
      taskItemDepth = depth;
      break;
    }
  }

  if (taskItemDepth === -1) {
    return false;
  }

  const pos = $from.before(taskItemDepth);
  const node = $from.node(taskItemDepth);

  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
  view.dispatch(tr);
  return true;
}
