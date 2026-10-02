// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { normalizeClipboardHtml } from "./clipboardHtml";

describe("normalizeClipboardHtml", () => {
  it("decodes a fully escaped rich-text fragment returned by the clipboard", () => {
    const escaped = "&lt;p data-pm-slice=\"1 1 []\" style=\"color: rgb(255, 255, 255);\"&gt;0.11.7&lt;/p&gt;";

    expect(normalizeClipboardHtml(escaped)).toBe(
      '<p data-pm-slice="1 1 []" style="color: rgb(255, 255, 255);">0.11.7</p>'
    );
  });

  it("leaves valid rich HTML and ordinary text unchanged", () => {
    const html = "<p><strong>Hello</strong></p>";

    expect(normalizeClipboardHtml(html)).toBe(html);
    expect(normalizeClipboardHtml("Just text &amp; punctuation")).toBe("Just text &amp; punctuation");
  });
});
