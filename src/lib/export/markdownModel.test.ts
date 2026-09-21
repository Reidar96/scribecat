import { describe, expect, it } from "vitest";

import { renderHtmlBody } from "./htmlExport";
import { parseMarkdownToBlocks } from "./markdownModel";

// The editor writes its inline formatting in a few non-CommonMark spellings
// ("++u++", "==mark=="); the export parser has to read the same ones, or a
// highlighted phrase exports as literal equals signs.
describe("parseMarkdownToBlocks inline marks", () => {
  it("reads ==text== as a highlight run", () => {
    const [block] = parseMarkdownToBlocks("Ein ==wichtiger== Satz.");

    expect(block.kind).toBe("paragraph");
    if (block.kind !== "paragraph") {
      return;
    }

    const runs = block.runs.filter((run) => run.kind === "text");
    expect(runs.map((run) => (run.kind === "text" ? [run.text, run.highlight] : null))).toEqual([
      ["Ein ", false],
      ["wichtiger", true],
      [" Satz.", false]
    ]);
  });

  it("keeps a highlight combined with other marks", () => {
    const [block] = parseMarkdownToBlocks("==**fett** und ++unter++==");

    if (block.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }

    const texts = block.runs.filter((run) => run.kind === "text");
    expect(texts.every((run) => run.kind === "text" && run.highlight)).toBe(true);
    expect(texts[0]).toMatchObject({ text: "fett", bold: true });
    expect(texts[2]).toMatchObject({ text: "unter", underline: true });
  });

  it("renders a highlight run as <mark> in HTML", () => {
    const html = renderHtmlBody(parseMarkdownToBlocks("Ein ==wichtiger== Satz."), new Map());

    expect(html).toContain("Ein <mark>wichtiger</mark> Satz.");
  });
});

// The editor writes a line break inside a table cell as "<br>" (the only
// form a Markdown cell has for it); the export reads it as a break instead
// of the literal tag.
describe("parseMarkdownToBlocks table cells", () => {
  it("reads <br> inside a cell as a line break", () => {
    const [block] = parseMarkdownToBlocks("| A |\n| --- |\n| one<br>two |\n");

    if (block.kind !== "table") {
      throw new Error("expected table");
    }

    expect(block.rows[1][0].runs.map((run) => (run.kind === "text" ? run.text : run.kind))).toEqual([
      "one",
      "break",
      "two"
    ]);
  });

  it("leaves <br> outside a table as text", () => {
    const [block] = parseMarkdownToBlocks("one<br>two\n");

    if (block.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }

    expect(block.runs.some((run) => run.kind === "break")).toBe(false);
  });
});
