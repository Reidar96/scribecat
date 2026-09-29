import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Turn each hard-break-delimited line in a single selected paragraph into a list item. */
export function toggleListForSelectedLines(editor: Editor, kind: "bulletList" | "orderedList"): boolean {
  const { selection, schema } = editor.state;
  if (selection.empty) return false;
  const { $from, $to } = selection;
  if ($from.parent.type.name !== "paragraph" || $to.parent !== $from.parent) return false;
  const paragraph = $from.parent;
  const depth = $from.depth;
  if ($to.depth !== depth) return false;
  const listType = schema.nodes[kind];
  const itemType = schema.nodes.listItem;
  const paragraphType = schema.nodes.paragraph;
  const breakType = schema.nodes.hardBreak;
  if (!listType || !itemType || !paragraphType || !breakType) return false;

  const lines: ProseMirrorNode[][] = [[]];
  let hasBreak = false;
  paragraph.forEach((child) => {
    if (child.type === breakType) {
      hasBreak = true;
      lines.push([]);
    } else {
      lines[lines.length - 1].push(child);
    }
  });
  if (!hasBreak || lines.length < 2) return false;

  const items = lines.map((content) => itemType.create(null, paragraphType.create(null, content)));
  const list = listType.create(kind === "orderedList" ? { start: 1 } : null, items);
  const paragraphPos = $from.before(depth);
  const transaction = editor.state.tr.replaceWith(paragraphPos, paragraphPos + paragraph.nodeSize, list);
  editor.view.dispatch(transaction);
  editor.commands.focus();
  return true;
}
