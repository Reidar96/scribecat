// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { getEditorMarkdown } from "@/lib/editor/markdownStorage";
import { FONT_COLORS, nearestFontColor } from "./fontColor";

function open(content: string) {
  return new Editor({ element: document.createElement("div"), extensions: buildPreviewExtensions(), content });
}

describe("font colors", () => {
  it("snaps Word RGB colors to the nearest palette color", () => {
    expect(nearestFontColor("rgb(190, 55, 72)")).toBe(FONT_COLORS[0].value);
    expect(nearestFontColor("#1f2328")).toBeNull();
    expect(nearestFontColor("url(javascript:bad)")).toBeNull();
  });

  it("round-trips a colored selection through saved Markdown", () => {
    const editor = open("A blue word");
    editor.commands.setTextSelection({ from: 3, to: 7 });
    editor.commands.setFontColor(FONT_COLORS[5].value);
    const saved = getEditorMarkdown(editor, "");
    expect(saved).toContain(`<span style="color: ${FONT_COLORS[5].value}">blue</span>`);
    editor.destroy();

    const reopened = open(saved);
    expect(reopened.state.doc.firstChild?.child(1).marks.find((mark) => mark.type.name === "fontColor")?.attrs.color)
      .toBe(FONT_COLORS[5].value);
    expect(getEditorMarkdown(reopened, "")).toBe(saved);
    reopened.destroy();
  });

  it("accepts a styled Word span as a colored mark", () => {
    const editor = open("plain");
    const pasted = document.createElement("div");
    pasted.innerHTML = '<p><span style="color: rgb(189, 55, 74)">Word color</span></p>';
    const documentNode = ProseMirrorDOMParser.fromSchema(editor.schema).parse(pasted);
    const mark = documentNode.firstChild?.firstChild?.marks.find((candidate) => candidate.type.name === "fontColor");
    expect(mark?.attrs.color).toBe(FONT_COLORS[0].value);
    editor.destroy();
  });
});
