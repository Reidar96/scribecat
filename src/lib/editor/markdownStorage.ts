import type { Editor as TipTapEditor } from "@tiptap/react";

// tiptap-markdown attaches its serializer to editor.storage.markdown but does
// not type it, so these two helpers wrap the cast in one place instead of
// repeating it at every call site.
type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
    serializer?: { serialize: (content: unknown) => string };
  };
};

/** The full document serialized to markdown, or `fallback` if unavailable. */
export function getEditorMarkdown(editor: TipTapEditor, fallback: string): string {
  const storage = editor.storage as MarkdownStorage;
  return storage.markdown?.getMarkdown?.() ?? fallback;
}

/** The current selection serialized to markdown, or "" if it can't be. */
export function getSelectionMarkdown(editor: TipTapEditor, from: number, to: number): string {
  const storage = editor.storage as MarkdownStorage;
  const serializer = storage.markdown?.serializer;

  if (!serializer) {
    return "";
  }

  try {
    const content = editor.state.doc.slice(from, to).content;

    // A range inside a single block comes back as bare inline nodes, and the
    // serializer applies marks while rendering a *block*: handed the inline
    // nodes straight it writes their text and drops the bold, the link, the
    // code span. Wrapping them in a paragraph inside a document node is what
    // puts them back where the marks are rendered. Block content already
    // arrives as blocks and goes through unchanged.
    const inlineContent = content.firstChild?.isInline === true;
    const serializable = inlineContent
      ? editor.schema.topNodeType.create(null, editor.schema.nodes.paragraph.create(null, content))
      : content;

    return serializer.serialize(serializable).trim();
  } catch {
    return "";
  }
}
