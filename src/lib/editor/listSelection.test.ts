// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { toggleListForSelectedLines } from "@/lib/editor/listSelection";

describe("toggleListForSelectedLines", () => {
  it("converts every hard-break-separated selected line to a list item", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildPreviewExtensions(),
      content: "first line\\\nsecond line\\\nthird line"
    });
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

    expect(toggleListForSelectedLines(editor, "bulletList")).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first line" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second line" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "third line" }] }] }
      ]
    });
    editor.destroy();
  });
});
