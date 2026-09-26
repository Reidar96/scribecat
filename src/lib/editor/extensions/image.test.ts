// Round-trip tests for the image node's markdown serializer. Parsing goes
// through markdown-it and a DOM, hence the jsdom environment for this file.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";

type JSONNode = { type?: string; attrs?: Record<string, unknown>; content?: JSONNode[] };

function roundTrip(markdown: string) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content: markdown
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const result = {
    markdown: storage.markdown?.getMarkdown?.() ?? "",
    doc: editor.getJSON() as JSONNode
  };
  editor.destroy();

  return result;
}

function findNode(node: JSONNode, type: string): JSONNode | null {
  if (node.type === type) {
    return node;
  }

  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) {
      return found;
    }
  }

  return null;
}

describe("local PDF media round-trip", () => {
  it("migrates the 0.24.5 local PDF link into the media node", () => {
    const { markdown, doc } = roundTrip(
      "[Presentasjon.pdf](_attachments/Presentasjon.pdf)\n"
    );

    const media = findNode(doc, "image");
    expect(media?.attrs?.alt).toBe("Presentasjon.pdf");
    expect(media?.attrs?.src).toBe("_attachments/Presentasjon.pdf");
    expect(markdown.trim()).toBe(
      "![Presentasjon.pdf](_attachments/Presentasjon.pdf)"
    );
  });

  it("keeps remote PDF URLs as normal links", () => {
    const { markdown, doc } = roundTrip(
      "[Manual](https://example.com/manual.pdf)\n"
    );

    expect(findNode(doc, "image")).toBeNull();
    expect(markdown.trim()).toBe("[Manual](https://example.com/manual.pdf)");
  });

  it("round-trips the 0.24.6 PDF media form", () => {
    const { markdown, doc } = roundTrip(
      "![Presentasjon.pdf](_attachments/Presentasjon.pdf)\n"
    );

    expect(findNode(doc, "image")?.attrs?.src).toBe(
      "_attachments/Presentasjon.pdf"
    );
    expect(markdown.trim()).toBe(
      "![Presentasjon.pdf](_attachments/Presentasjon.pdf)"
    );
  });
});

describe("image markdown round-trip", () => {
  it("keeps a purely numeric alt text a string (phone camera file names)", () => {
    // TipTap's default attribute parser turns "1000078813" into a Number,
    // which used to crash state.esc() and with it every save of the note.
    const { markdown, doc } = roundTrip("![1000078813](images/1000078813.jpg)\n");

    const image = findNode(doc, "image");
    expect(image?.attrs?.alt).toBe("1000078813");
    expect(image?.attrs?.src).toBe("images/1000078813.jpg");
    expect(markdown.trim()).toBe("![1000078813](images/1000078813.jpg)");
  });

  it("keeps an alt text that looks like a boolean a string", () => {
    const { markdown } = roundTrip("![true](images/true.png)\n");

    expect(markdown.trim()).toBe("![true](images/true.png)");
  });

  it("keeps a numeric width encoded in the title", () => {
    const { markdown } = roundTrip('![foto](images/foto.png "width=300")\n');

    expect(markdown.trim()).toBe('![foto](images/foto.png "width=300")');
  });
});

// The image node is a block node, but `breaks: true` makes markdown-it put a
// softbreak between two image lines inside one paragraph. ProseMirror then
// splits the paragraph around each image and the leftover break becomes a
// paragraph of its own — a blank line between images nobody typed, and one
// more block the caret gets stuck in.
describe("line breaks around images", () => {
  function blockTypes(doc: JSONNode): string[] {
    return (doc.content ?? []).map((child) => child.type ?? "");
  }

  it("does not leave an empty paragraph between consecutive images", () => {
    const { doc } = roundTrip(
      "![a](images/a.png)\n![b](images/b.png)\n![c](images/c.png)\n"
    );

    expect(blockTypes(doc)).toEqual(["image", "image", "image"]);
  });

  it("drops the break between a paragraph and the image below it", () => {
    const { doc } = roundTrip("Test\nsecond\n![a](images/a.png)\n![b](images/b.png)\n");

    expect(blockTypes(doc)).toEqual(["paragraph", "image", "image"]);

    // The break that used to sit between "second" and the image is gone; the
    // one between the two text lines has to stay.
    const paragraph = doc.content?.[0];
    expect((paragraph?.content ?? []).map((child) => child.type)).toEqual([
      "text",
      "hardBreak",
      "text"
    ]);
  });

  it("keeps hard breaks between plain text lines", () => {
    const { markdown } = roundTrip("Test\nsecond\nthird\n");

    expect(markdown.trim()).toBe("Test\\\nsecond\\\nthird");
  });
});
