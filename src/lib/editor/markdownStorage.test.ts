// Serializing a *part* of the document, which is what the three copy variants
// and the AI rewrite hand to the model. Parsing runs through markdown-it and a
// DOM, so this file needs a document.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { getSelectionMarkdown } from "@/lib/editor/markdownStorage";

function open(markdown: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });
}

describe("getSelectionMarkdown", () => {
  it("keeps an inline mark inside a single paragraph", () => {
    const editor = open("A line with **bold** in it.\n");
    const { doc } = editor.state;
    // The whole text of the first paragraph, boundaries excluded: the range a
    // selection made with Home/Shift+End produces.
    const paragraph = doc.child(0);
    const from = 1;
    const to = 1 + paragraph.content.size;

    const markdown = getSelectionMarkdown(editor, from, to);
    editor.destroy();

    expect(markdown).toBe("A line with **bold** in it.");
  });

  it("keeps the list markers when the selection spans whole blocks", () => {
    const editor = open("- first **item**\n- second item\n");
    const markdown = getSelectionMarkdown(editor, 0, editor.state.doc.content.size);
    editor.destroy();

    expect(markdown).toContain("- first **item**");
    expect(markdown).toContain("- second item");
  });
});
