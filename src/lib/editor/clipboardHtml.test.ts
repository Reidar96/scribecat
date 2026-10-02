// @vitest-environment jsdom
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeClipboardHtml } from "./clipboardHtml";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("normalizeClipboardHtml", () => {
  it("restores a fully escaped paragraph and ProseMirror pastes its text", () => {
    const escaped = "&lt;p data-pm-slice=\"1 1 []\" style=\"color: rgb(255, 255, 255);\"&gt;0.11.7&lt;/p&gt;";
    const normalized = normalizeClipboardHtml(escaped);

    editor = new Editor({ extensions: [StarterKit], content: "<p>before</p>" });
    editor.commands.setTextSelection(7);
    editor.view.pasteHTML(normalized, new Event("paste") as ClipboardEvent);

    expect(editor.getText()).toBe("before0.11.7");
    expect(editor.getHTML()).not.toContain("data-pm-slice");
  });

  it("restores escaped markup inside a clipboard HTML wrapper", () => {
    const wrapped = '<html><body><!--StartFragment-->&lt;p data-pm-slice=\"1 1 []\"&gt;0.11.7&lt;/p&gt;<!--EndFragment--></body></html>';
    const normalized = normalizeClipboardHtml(wrapped);
    const template = document.createElement("template");
    template.innerHTML = normalized;

    expect(template.content.querySelector("p")?.textContent).toBe("0.11.7");
  });

  it("keeps valid rich HTML, literal text, and code content unchanged", () => {
    const html = "<p><strong>Hello</strong></p>";
    editor = new Editor({ extensions: [StarterKit], content: "<p>before</p>" });
    editor.commands.setTextSelection(7);
    editor.view.pasteHTML(normalizeClipboardHtml(html), new Event("paste") as ClipboardEvent);

    expect(editor.getText()).toBe("beforeHello");
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");

    expect(normalizeClipboardHtml("<p>a &lt; b &gt; c</p>")).toBe("<p>a &lt; b &gt; c</p>");
    expect(normalizeClipboardHtml("<pre><code>&lt;p&gt;literal&lt;/p&gt;</code></pre>")).toBe(
      "<pre><code>&lt;p&gt;literal&lt;/p&gt;</code></pre>"
    );
  });
});
