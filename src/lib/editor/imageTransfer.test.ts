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

  it("keeps other documents out of the inline-media path", () => {
    expect(
      isInlineMediaFile({
        name: "report.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).toBe(false);
  });
});
