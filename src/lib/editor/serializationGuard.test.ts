// Builds real documents through the editor schema, hence jsdom.
// @vitest-environment jsdom
import { Editor, type Extensions, Node as TipTapNode } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";
import { serializeGuarded } from "@/lib/editor/serializationGuard";

// The regression the guard exists for: an extension that adds a node to the
// schema without telling tiptap-markdown how to write it. With html mode off
// its serializer writes "[widget]" into the file and the node is gone on the
// next open.
const Widget = TipTapNode.create({
  name: "widget",
  group: "block",
  atom: true,
  parseHTML: () => [{ tag: "div[data-widget]" }],
  renderHTML: () => ["div", { "data-widget": "" }]
});

function withEditor<T>(
  use: (editor: Editor) => T,
  { content = "", extra = [] as Extensions }: { content?: string; extra?: Extensions } = {}
): T {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage, ...extra],
    content
  });

  try {
    return use(editor);
  } finally {
    editor.destroy();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serializeGuarded", () => {
  it("is quiet for a document the serializer can write", () => {
    const { markdown, lost } = withEditor((editor) => serializeGuarded(editor, "fallback"), {
      content: "| A |\n| --- |\n| 1<br>2 |\n"
    });

    expect(lost).toEqual([]);
    expect(markdown).toContain("| A |");
  });

  it("reports a node the serializer could not write", () => {
    // tiptap-markdown warns on the way to the placeholder; silence it so the
    // expected path doesn't look like a failure in the test output.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { markdown, lost } = withEditor(
      (editor) => {
        const widget = editor.schema.nodes.widget.create();

        editor.commands.setContent({ type: "doc", content: [widget.toJSON()] }, { emitUpdate: false });

        return serializeGuarded(editor, "fallback");
      },
      { extra: [Widget] }
    );

    expect(lost).toEqual(["widget"]);
    expect(markdown).toContain("[widget]");
  });

  it("accepts an image whose title holds the placeholder text", () => {
    // Ordinary Markdown a user can paste. The title is written without
    // escaping the brackets and never appears in doc.textContent, so the
    // earlier text search read it as a lost image and blocked saving.
    const { markdown, lost } = withEditor((editor) => serializeGuarded(editor, "fallback"), {
      content: '![a](a.png "[image]")'
    });

    expect(lost).toEqual([]);
    expect(markdown).toBe('![a](a.png "[image]")');
  });

  it("accepts a placeholder the user typed as text", () => {
    const { lost } = withEditor((editor) => serializeGuarded(editor, "fallback"), {
      content: "| A |\n| --- |\n| 1 |\n\n`[table]`\n"
    });

    expect(lost).toEqual([]);
  });

  it("judges each run on its own instead of accumulating", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = withEditor(
      (editor) => {
        const widget = editor.schema.nodes.widget.create();

        editor.commands.setContent({ type: "doc", content: [widget.toJSON()] }, { emitUpdate: false });
        const broken = serializeGuarded(editor, "fallback");

        editor.commands.setContent("# clean", { emitUpdate: false });
        const clean = serializeGuarded(editor, "fallback");

        return { broken, clean };
      },
      { extra: [Widget] }
    );

    expect(results.broken.lost).toEqual(["widget"]);
    expect(results.clean.lost).toEqual([]);
  });

  it("falls back when the editor has no markdown serializer", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildPreviewExtensions(),
      content: "# T"
    });

    delete (editor.storage as { markdown?: unknown }).markdown;

    const result = serializeGuarded(editor, "fallback");

    editor.destroy();

    expect(result).toEqual({ markdown: "fallback", lost: [] });
  });
});
