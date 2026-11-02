import { describe, expect, it } from "vitest";
import { inventoryImagesMarkdown, parseInventoryImages } from "./inventory";

describe("inventory images", () => {
  it("keeps the cover first and deduplicates gallery references", () => {
    const markdown = `## Bilder\n\n![Forside](_attachments/bilde-001.jpg)\n\n![Bakside](_attachments/bilde-002.jpg)\n`;
    expect(parseInventoryImages(markdown, "_attachments/bilde-001.jpg")).toEqual([
      { reference: "_attachments/bilde-001.jpg", alt: "" },
      { reference: "_attachments/bilde-002.jpg", alt: "Bakside" }
    ]);
  });

  it("writes portable Markdown image entries", () => {
    expect(inventoryImagesMarkdown([{ reference: "_attachments/to.jpg", alt: "Bilde to" }])).toBe("![Bilde to](_attachments/to.jpg)");
  });
});
