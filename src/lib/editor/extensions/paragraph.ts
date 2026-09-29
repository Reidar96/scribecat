import BaseParagraph from "@tiptap/extension-paragraph";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type MarkdownSerializerState = {
  write: (content: string) => void;
  renderInline: (node: ProseMirrorNode) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

// Markdown treats any run of blank lines as one separator. A zero-width
// sentinel keeps intentional empty paragraphs in the source while rendering
// as whitespace only; it can therefore survive a close and reopen.
export const Paragraph = BaseParagraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number) {
          const isIntentionalBlankLine =
            node.content.size === 0 &&
            parent.type.name === "doc" &&
            parent.childCount > 1 &&
            index > 0 &&
            index < parent.childCount - 1;
          if (isIntentionalBlankLine) state.write("\u200b");
          else if (node.content.size > 0) state.renderInline(node);
          state.closeBlock(node);
        }
      }
    };
  }
});
