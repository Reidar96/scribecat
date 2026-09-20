import { describe, expect, it } from "vitest";

import { numberExportBlockLists, numberExportBlocks } from "./headingNumbers";
import { parseMarkdownToBlocks, type ExportBlock } from "./markdownModel";

import type { HeadingNumberingSettings } from "@/lib/editor/headingNumbers";

const settings: HeadingNumberingSettings = {
  enabled: true,
  startLevel: 1,
  maxDepth: 6,
  scope: "everywhere",
  marker: "activeLine"
};

function headingTexts(blocks: ExportBlock[]): string[] {
  const texts: string[] = [];

  for (const block of blocks) {
    if (block.kind === "heading") {
      texts.push(block.runs.map((run) => (run.kind === "text" ? run.text : "")).join(""));
    } else if (block.kind === "blockquote") {
      texts.push(...headingTexts(block.children));
    }
  }

  return texts;
}

describe("numberExportBlocks", () => {
  it("prepends the numbers and strips the marker, leaving the rest untouched", () => {
    const blocks = parseMarkdownToBlocks("# One\n\ntext\n\n## Two {-}\n\n## Three **bold**\n");

    expect(headingTexts(numberExportBlocks(blocks, settings))).toEqual(["1. One", "Two", "1.1. Three bold"]);
  });

  it("returns the very same list while numbering is off or absent", () => {
    const blocks = parseMarkdownToBlocks("# One\n");

    expect(numberExportBlocks(blocks, undefined)).toBe(blocks);
    expect(numberExportBlocks(blocks, { ...settings, enabled: false })).toBe(blocks);
  });

  it("leaves the numbers out but still drops the marker with the scope on outline only", () => {
    const blocks = parseMarkdownToBlocks("# One\n\n## Two {-}\n\n## Three\n");

    expect(headingTexts(numberExportBlocks(blocks, { ...settings, scope: "outline" }))).toEqual([
      "One",
      "Two",
      "Three"
    ]);
  });

  it("counts a heading inside a blockquote like the editor's outline does", () => {
    const blocks = parseMarkdownToBlocks("# One\n\n> ## Quoted\n\n## Two\n");

    expect(headingTexts(numberExportBlocks(blocks, settings))).toEqual(["1. One", "1.1. Quoted", "1.2. Two"]);
  });

  it("keeps the marker's styled run boundaries when cutting it away", () => {
    const blocks = parseMarkdownToBlocks("## *Em* text {.unnumbered}\n");
    const [heading] = numberExportBlocks(blocks, settings);

    expect(heading.kind === "heading" && heading.runs).toEqual([
      expect.objectContaining({ kind: "text", text: "Em", italic: true }),
      expect.objectContaining({ kind: "text", text: " text", italic: false })
    ]);
  });
});

describe("numberExportBlockLists", () => {
  it("numbers chapters as one sequence and hands each its own slice back", () => {
    const one = parseMarkdownToBlocks("# Alpha\n\n## A\n");
    const two = parseMarkdownToBlocks("# Beta\n\n## B\n");
    const [first, second] = numberExportBlockLists([one, two], settings);

    expect(first).toHaveLength(one.length);
    expect(second).toHaveLength(two.length);
    expect(headingTexts(first)).toEqual(["1. Alpha", "1.1. A"]);
    expect(headingTexts(second)).toEqual(["2. Beta", "2.1. B"]);
  });
});
