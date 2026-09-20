// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";

import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

import { HeadingNumbering } from "./headingNumbering";

// Whether the numbers actually land in the DOM as attributes and the marker
// gets its class — the two things the CSS relies on and no pure test can see.

function createEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: [Document, Paragraph, Text, Italic, Heading, HeadingNumbering],
    content
  });
}

const numbersInDom = (current: Editor) =>
  Array.from(current.view.dom.querySelectorAll("h1, h2, h3")).map(
    (heading) => heading.getAttribute("data-heading-number")
  );

let editor: Editor | null = null;

beforeEach(() => {
  useEditorSettingsStore
    .getState()
    .setHeadingNumbering({ enabled: true, startLevel: 1, maxDepth: 6, scope: "everywhere", marker: "always" });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  useEditorSettingsStore.getState().setHeadingNumbering({ enabled: false });
});

describe("HeadingNumbering", () => {
  it("writes the number onto each numbered heading and marks the {-} text", () => {
    editor = createEditor("<h1>One</h1><h2>Two</h2><h2>Skip {-}</h2><h2>Three</h2><p>body</p>");

    expect(numbersInDom(editor)).toEqual(["1.", "1.1.", null, "1.2."]);

    const marker = editor.view.dom.querySelector(".heading-unnumbered-marker");
    expect(marker?.textContent).toBe(" {-}");
    expect(editor.getText()).toContain("Skip {-}");
  });

  it("follows edits and the settings without a transaction of its own", () => {
    editor = createEditor("<h1>One</h1><h2>Two</h2>");

    editor.commands.insertContentAt(0, "<h1>Zero</h1>");
    expect(numbersInDom(editor)).toEqual(["1.", "2.", "2.1."]);

    useEditorSettingsStore.getState().setHeadingNumbering({ startLevel: 2 });
    expect(numbersInDom(editor)).toEqual([null, null, "1."]);

    useEditorSettingsStore.getState().setHeadingNumbering({ enabled: false });
    expect(numbersInDom(editor)).toEqual([null, null, null]);
  });

  it("keeps the numbers out of the editor with the scope on outline only", () => {
    editor = createEditor("<h1>One</h1><h2>Two {-}</h2>");

    useEditorSettingsStore.getState().setHeadingNumbering({ scope: "outline" });
    expect(numbersInDom(editor)).toEqual([null, null]);
    expect(editor.view.dom.querySelector(".heading-unnumbered-marker")).not.toBeNull();
  });

  it("hides the marker outside the heading the cursor is in", () => {
    editor = createEditor("<h1>One {-}</h1><p>body</p><h1>Two {-}</h1>");
    useEditorSettingsStore.getState().setHeadingNumbering({ marker: "activeLine" });

    const hiddenMarkers = () => editor!.view.dom.querySelectorAll(".heading-unnumbered-marker--hidden").length;

    editor.commands.setTextSelection(3);
    expect(hiddenMarkers()).toBe(1);
    expect(editor.view.dom.querySelector("h1 .heading-unnumbered-marker--hidden")?.closest("h1")?.textContent).toBe(
      "Two {-}"
    );

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.view.dom.querySelector("h1 .heading-unnumbered-marker--hidden")?.closest("h1")?.textContent).toBe(
      "One {-}"
    );

    editor.commands.setTextSelection(editor.state.doc.resolve(0).posAtIndex(1) + 1);
    expect(hiddenMarkers()).toBe(2);

    useEditorSettingsStore.getState().setHeadingNumbering({ marker: "always" });
    expect(hiddenMarkers()).toBe(0);
  });

  it("leaves a marker split across marks in the text but still honours it", () => {
    editor = createEditor("<h1>One</h1><h1>Two <em>{-</em>}</h1><h1>Three</h1>");

    expect(numbersInDom(editor)).toEqual(["1.", null, "2."]);
    expect(editor.view.dom.querySelector(".heading-unnumbered-marker")).toBeNull();
  });
});
