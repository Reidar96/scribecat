// @vitest-environment jsdom
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { pastePlainText } from "./plainTextPaste";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("pastePlainText", () => {
  it("inserts literal Markdown markers and keeps line breaks", () => {
    editor = new Editor({ extensions: [StarterKit], content: "<p>before after</p>" });
    editor.commands.setTextSelection(8);

    expect(pastePlainText(editor, "# Heading\n**literal**")).toBe(true);
    expect(editor.getText()).toBe("before # Heading\n**literal**after");
    expect(editor.getHTML()).not.toContain("<h1>");
    expect(editor.getHTML()).not.toContain("<strong>");
  });

  it("inserts newlines as literal code text in a code block", () => {
    editor = new Editor({ extensions: [StarterKit], content: "<pre><code>before</code></pre>" });
    editor.commands.focus("end");

    pastePlainText(editor, "<tag>\nnext");
    expect(editor.getText()).toContain("before<tag>\nnext");
  });
});
