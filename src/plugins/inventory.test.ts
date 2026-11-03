import { describe, expect, it } from "vitest";
import { inventoryImagesMarkdown, parseInventoryImages } from "./inventory";

describe("inventory images", () => {
  it("uses the Bilder section as the authoritative ordered list", () => {
    const markdown = `## Bilder\n\n![Forside](_attachments/bilde-001.jpg)\n\n![Bakside](_attachments/bilde-002.jpg)\n`;
    expect(parseInventoryImages(markdown)).toEqual([
      { reference: "_attachments/bilde-001.jpg", alt: "Forside" },
      { reference: "_attachments/bilde-002.jpg", alt: "Bakside" }
    ]);
    expect(parseInventoryImages("---\ncover: _attachments/bilde-001.jpg\n---\n")).toEqual([]);
  });

  it("writes portable Markdown image entries", () => {
    expect(inventoryImagesMarkdown([{ reference: "_attachments/to.jpg", alt: "Bilde to" }])).toBe("![Bilde to](_attachments/to.jpg)");
  });
});
