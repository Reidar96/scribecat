// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { buildPreviewExtensions } from "./extensions";
import { headingExistsInMarkdown, headingLinkHref, normalizeHeadingHref, parseHeadingLink, pastedHeadingHref } from "./headingLinks";

describe("heading links", () => {
  it("keeps the vault-relative destination when copied across documents", () => {
    const href = headingLinkHref("/vault", "/vault/Notater/Min bok.md", "#kapittel-2");
    expect(href).toBe("#scribecat-note/Notater/Min%20bok.md#kapittel-2");
    expect(parseHeadingLink(href)).toEqual({ relativePath: "Notater/Min bok.md", anchor: "#kapittel-2" });
    expect(pastedHeadingHref(`[Kapittel 2](${href})`, "")).toBe(href);
  });
  it("rejects paths that escape the vault", () => {
    expect(parseHeadingLink("scribecat://note/Notater/Min%20bok.md#kapittel-2"))
      .toEqual({ relativePath: "Notater/Min bok.md", anchor: "#kapittel-2" });
    expect(parseHeadingLink("scribecat://note/../Hemmelig.md#x")).toBeNull();
    expect(parseHeadingLink("scribecat://note/%2Fetc/passwd.md#x")).toBeNull();
    expect(parseHeadingLink("https://example.org/#x")).toBeNull();
  });
  it("renders an internal fragment instead of a browser URL", () => {
    const href = headingLinkHref("/vault", "/vault/Notater/Min bok.md", "#kapittel-2");
    const editor = new Editor({ element: document.createElement("div"), extensions: buildPreviewExtensions(), content: `[Kapittel](${href})` });
    expect(editor.getHTML()).toContain(`data-heading-link="${href}"`);
    expect(editor.getHTML()).not.toContain(`href="${href}"`);
    expect(editor.getHTML()).not.toContain("about:blank");
    editor.destroy();
  });
  it("deactivates stale heading targets, including repeated headings", () => {
    const markdown = "# Tittel\n\n## Første\n\n## Første\n";
    expect(headingExistsInMarkdown(markdown, "#første-2")).toBe(true);
    expect(headingExistsInMarkdown(markdown, "#slettet")).toBe(false);
  });
  it("recognizes browser-resolved heading fragments without opening an external URL", () => {
    const fragment = "#scribecat-note/Notater/Min%20bok.md#kapittel-2";
    expect(normalizeHeadingHref(`about:blank${fragment}`)).toBe(fragment);
    expect(parseHeadingLink(`about:blank${fragment}`)).toEqual({ relativePath: "Notater/Min bok.md", anchor: "#kapittel-2" });
    expect(parseHeadingLink(`https://example.org/${fragment}`)).toBeNull();
  });
});
