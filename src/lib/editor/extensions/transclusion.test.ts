// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorFileContext } from "@/lib/editorFileContext";
import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { getEditorMarkdown } from "@/lib/editor/markdownStorage";
import { useAppStore } from "@/store/useAppStore";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  editor?.destroy();
  host?.remove();
  root = null;
  editor = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("linked blocks", () => {
  it("renders the source as visual, editable content and keeps its frontmatter", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const source = "---\ntags: [project]\n---\n# Heading\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n![Photo](photo.png)\n\n![PDF](file.pdf)";
    useAppStore.setState({
      folderPath: "/vault",
      filePaths: ["/vault/host.md", "/vault/source.md"],
      fileDocuments: { "/vault/source.md": { content: source, baseContent: source } }
    });
    editor = new Editor({ extensions: buildPreviewExtensions(), content: "![[source.md]]" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(EditorFileContext.Provider,
      { value: { folderPath: "/vault", filePath: "/vault/host.md" } },
      createElement(EditorContent, { editor: editor! }))));

    const embedded = host.querySelector<HTMLElement>(".markdown-transclusion__editor .tiptap");
    expect(embedded?.getAttribute("contenteditable")).toBe("true");
    expect(embedded?.querySelector("h1")?.textContent).toBe("Heading");
    expect(embedded?.querySelector("table")?.textContent).toContain("One");
    expect(embedded?.querySelector(".editor-image-wrapper")).not.toBeNull();
    expect(embedded?.querySelector(".editor-pdf-wrapper")).not.toBeNull();
    expect(host.querySelector(".markdown-transclusion__path")?.textContent).toBe("source.md");
    expect(embedded?.textContent).not.toContain("---");
    expect(embedded?.textContent).not.toContain("| --- |");

    await act(async () => useAppStore.getState().updateFileContent(
      "/vault/source.md", "---\ntags: [project]\n---\n# Changed\n\n| One | Two |\n| --- | --- |\n| A | B |"
    ));
    expect(host.querySelector(".markdown-transclusion__editor h1")?.textContent).toBe("Changed");
    expect(getEditorMarkdown(editor, "")).toBe("![[source.md]]");
  });
});
