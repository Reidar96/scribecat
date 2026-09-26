import { describe, expect, it } from "vitest";

import { isInlineMediaFile } from "./imageTransfer";

describe("isInlineMediaFile", () => {
  it("accepts normal image MIME types", () => {
    expect(isInlineMediaFile({ name: "photo.bin", type: "image/png" })).toBe(true);
  });

  it("accepts PDFs by MIME type", () => {
    expect(isInlineMediaFile({ name: "document.bin", type: "application/pdf" })).toBe(true);
  });

  it("accepts PDFs by extension when the platform does not provide a MIME type", () => {
    expect(isInlineMediaFile({ name: "scan.PDF", type: "application/octet-stream" })).toBe(true);
  });

  it("accepts Word documents for the inline document viewer", () => {
    expect(
      isInlineMediaFile({
        name: "report.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).toBe(true);
  });

  it("accepts PowerPoint documents for the inline slide viewer", () => {
    expect(
      isInlineMediaFile({
        name: "presentation.pptx",
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      })
    ).toBe(true);
  });

  it("accepts supported video files for the inline video player", () => {
    expect(isInlineMediaFile({ name: "clip.mp4", type: "video/mp4" })).toBe(true);
    expect(isInlineMediaFile({ name: "clip.webm", type: "application/octet-stream" })).toBe(true);
  });

  it("keeps unrelated files out of the inline-media path", () => {
    expect(isInlineMediaFile({ name: "archive.zip", type: "application/zip" })).toBe(false);
    expect(isInlineMediaFile({ name: "script.js", type: "text/javascript" })).toBe(false);
  });
});
