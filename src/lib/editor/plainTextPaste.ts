import { Fragment, Slice } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

/** Insert clipboard text as literal text, preserving lines without parsing Markdown or HTML. */
export function pastePlainText(
  editor: Editor,
  text: string,
  range: { from: number; to: number } = editor.state.selection
): boolean {
  if (!text) return false;

  const normalized = text.replace(/\r\n?/g, "\n");
  const state = editor.state;
  const $from = state.doc.resolve(range.from);

  if ($from.parent.type.spec.code) {
    editor.view.dispatch(state.tr.insertText(normalized, range.from, range.to).scrollIntoView().setMeta("paste", true));
    return true;
  }

  const paragraphType = state.schema.nodes.paragraph;
  const hardBreakType = state.schema.nodes.hardBreak;
  if (!paragraphType || !hardBreakType) return false;

  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => {
    const inline = paragraph.split("\n").flatMap((line, index) => {
      const nodes = line ? [state.schema.text(line)] : [];
      return index === 0 ? nodes : [hardBreakType.create(), ...nodes];
    });
    return paragraphType.create(null, inline);
  });

  const slice = Slice.maxOpen(Fragment.fromArray(paragraphs));
  editor.view.dispatch(
    state.tr.replaceRange(range.from, range.to, slice).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste")
  );
  return true;
}
