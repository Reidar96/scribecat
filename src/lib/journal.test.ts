import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOURNAL_SETTINGS,
  composeJournalMarkdown,
  journalDateFromRelativePath,
  journalRelativePath,
  parseJournalMarkdown
} from "./journal";

describe("journal paths", () => {
  it("uses the requested Norwegian folder structure", () => {
    expect(
      journalRelativePath(
        { year: 2026, month: 9, day: 1 },
        DEFAULT_JOURNAL_SETTINGS
      )
    ).toBe("Dagbok/2026/09-2026/01-09-2026.md");
  });

  it("round-trips all presets", () => {
    for (const structure of ["norwegian", "iso", "year"] as const) {
      const settings = {
        ...DEFAULT_JOURNAL_SETTINGS,
        folder: "Journal",
        structure
      };
      const date = { year: 2027, month: 2, day: 14 };
      expect(journalDateFromRelativePath(journalRelativePath(date, settings), settings)).toEqual(date);
    }
  });

  it("rejects files that only resemble a diary date", () => {
    expect(
      journalDateFromRelativePath(
        "Dagbok/2026/09-2026/31-09-2026.md",
        DEFAULT_JOURNAL_SETTINGS
      )
    ).toBeNull();
  });
});

describe("journal markdown", () => {
  it("keeps frontmatter and stores gallery images as ordinary markdown", () => {
    const original = "---\ntags: [Oslo]\n---\n# En dag\n\nTekst\n\n## Bilder\n\n![A](a.jpg)\n";
    const parsed = parseJournalMarkdown(original);
    expect(parsed.title).toBe("En dag");
    expect(parsed.textMarkdown).toBe("Tekst");
    expect(parsed.images).toEqual([{ alt: "A", src: "a.jpg" }]);

    const next = composeJournalMarkdown(original, parsed.textMarkdown, [
      { alt: "B", src: "_attachments/b.jpg" },
      { alt: "A", src: "a.jpg" }
    ]);

    expect(next).toContain("tags: [Oslo]");
    expect(next).toContain("# En dag");
    expect(next).toContain("![B](_attachments/b.jpg)");
    expect(next.indexOf("![B]")).toBeLessThan(next.indexOf("![A]"));
  });

  it("recognizes legacy image-table content as gallery images", () => {
    const parsed = parseJournalMarkdown(
      "# Tur\n\n| | |\n|---|---|\n| ![A](a.jpg) | ![B](b.jpg) |"
    );
    expect(parsed.images.map((image) => image.src)).toEqual(["a.jpg", "b.jpg"]);
  });
});
