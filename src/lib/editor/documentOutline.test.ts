import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";

import {
  activeHeadingIndex,
  clampOutlineDepth,
  collectHeadings,
  filterHeadingsByDepth,
  hasHeading,
  headingIndexAtViewportTop,
  sameOutline
} from "./documentOutline";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block", attrs: { level: { default: 1 } } },
    blockquote: { content: "block+", group: "block" },
    codeBlock: { content: "text*", group: "block", marks: "" },
    text: { group: "inline" }
  }
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const h = (level: number, text: string) =>
  schema.node("heading", { level }, text ? [schema.text(text)] : []);

describe("collectHeadings", () => {
  it("lists headings in document order with their level and position", () => {
    const doc = schema.node("doc", null, [h(1, "Eins"), p("text"), h(2, "Zwei"), h(3, "Drei")]);

    expect(collectHeadings(doc)).toEqual([
      { pos: 0, level: 1, title: "Eins" },
      { pos: 12, level: 2, title: "Zwei" },
      { pos: 18, level: 3, title: "Drei" }
    ]);
  });

  it("finds headings nested in a blockquote and keeps an empty title empty", () => {
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [h(2, "Zitat")]),
      h(1, "")
    ]);

    expect(collectHeadings(doc)).toEqual([
      { pos: 1, level: 2, title: "Zitat" },
      { pos: 9, level: 1, title: "" }
    ]);
  });

  it("ignores a code block that only looks like a heading", () => {
    const doc = schema.node("doc", null, [
      schema.node("codeBlock", null, [schema.text("# nur ein Kommentar")]),
      p("")
    ]);

    expect(collectHeadings(doc)).toEqual([]);
    expect(hasHeading(doc)).toBe(false);
  });
});

describe("activeHeadingIndex", () => {
  const headings = [
    { pos: 0, level: 1, title: "Eins" },
    { pos: 12, level: 2, title: "Zwei" },
    { pos: 18, level: 3, title: "Drei" }
  ];

  it("picks the last heading at or before the cursor", () => {
    expect(activeHeadingIndex(headings, 1)).toBe(0);
    expect(activeHeadingIndex(headings, 12)).toBe(1);
    expect(activeHeadingIndex(headings, 17)).toBe(1);
    expect(activeHeadingIndex(headings, 40)).toBe(2);
  });

  it("is -1 above the first heading", () => {
    expect(activeHeadingIndex([{ pos: 5, level: 1, title: "x" }], 2)).toBe(-1);
    expect(activeHeadingIndex([], 0)).toBe(-1);
  });
});

describe("headingIndexAtViewportTop", () => {
  it("picks the last heading at or above the viewport top", () => {
    expect(headingIndexAtViewportTop([0, 300, 600], 100)).toBe(0);
    expect(headingIndexAtViewportTop([0, 300, 600], 300)).toBe(1);
    expect(headingIndexAtViewportTop([0, 300, 600], 900)).toBe(2);
  });

  it("is -1 above the first heading and skips headings without a node", () => {
    expect(headingIndexAtViewportTop([50, 300], 10)).toBe(-1);
    expect(headingIndexAtViewportTop([null, 20, null, 400], 100)).toBe(1);
    expect(headingIndexAtViewportTop([], 100)).toBe(-1);
  });
});

describe("filterHeadingsByDepth", () => {
  const headings = [
    { pos: 0, level: 1, title: "a" },
    { pos: 5, level: 4, title: "b" },
    { pos: 9, level: 2, title: "c" }
  ];

  it("drops headings deeper than the limit and keeps everything at 6", () => {
    expect(filterHeadingsByDepth(headings, 2).map((heading) => heading.title)).toEqual(["a", "c"]);
    expect(filterHeadingsByDepth(headings, 6)).toBe(headings);
  });
});

describe("sameOutline / clampOutlineDepth", () => {
  it("compares outlines by content", () => {
    const a = [{ pos: 0, level: 1, title: "a" }];

    expect(sameOutline(a, [{ pos: 0, level: 1, title: "a" }])).toBe(true);
    expect(sameOutline(a, [{ pos: 0, level: 2, title: "a" }])).toBe(false);
    expect(sameOutline(a, [])).toBe(false);
  });

  it("clamps the depth into 1..6 and falls back to 6", () => {
    expect(clampOutlineDepth(0)).toBe(1);
    expect(clampOutlineDepth(9)).toBe(6);
    expect(clampOutlineDepth(Number.NaN)).toBe(6);
    expect(clampOutlineDepth(3.4)).toBe(3);
  });
});
