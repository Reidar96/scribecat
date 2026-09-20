import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { CodeBlockView } from "@/components/CodeBlockView";
import { codeBlockLowlight } from "@/lib/codeLanguages";

// Highlighting is applied as ProseMirror decorations, so the document stays
// plain text — markdown serialization, undo history and the exporters (which
// read the code block's text content) are unaffected.
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    // selectedOnTextSelection: the badges only need to show while the caret
    // is actually inside this block, not only on a full node selection.
    const render = ReactNodeViewRenderer(CodeBlockView, { selectedOnTextSelection: true });

    return (props) => {
      const nodeView = render(props);

      // TipTap's default ignoreMutation has an Android/iOS branch that lets
      // childList mutations *outside* the contentDOM through as long as the
      // added nodes are contentEditable (meant for the virtual keyboard).
      // React mounts this view's wrapper and the contentDOM host after the
      // node view is created, so exactly such a mutation happens on every
      // (re)render. prosemirror-view then reads an added block element on
      // Android as an Enter key, the Enter re-renders the code block, and the
      // tab hangs in that loop. Only the contentDOM is ProseMirror's business
      // here; everything else is React's own rendering.
      nodeView.ignoreMutation = (mutation) => {
        if (mutation.type === "selection") {
          return false;
        }

        const contentDOM = nodeView.contentDOM;

        if (!contentDOM) {
          return true;
        }

        if (contentDOM === mutation.target && mutation.type === "attributes") {
          return true;
        }

        return !contentDOM.contains(mutation.target);
      };

      return nodeView;
    };
  }
}).configure({ lowlight: codeBlockLowlight });
