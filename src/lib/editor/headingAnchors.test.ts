import { describe, expect, it } from "vitest";

import { headingAnchor, headingMatchesAnchor, slugifyHeading } from "./headingAnchors";

describe("heading anchors", () => {
  it("makes readable fragments and distinguishes duplicate titles", () => {
    expect(slugifyHeading("Såing & stell! ")).toBe("såing-stell");
    const headings = [
      { pos: 1, level: 2, title: "Start" },
      { pos: 8, level: 2, title: "Start" }
    ];
    expect(headingAnchor(headings, 1)).toBe("#start");
    expect(headingAnchor(headings, 8)).toBe("#start-2");
  });

  it("finds the matching rendered heading, including duplicates", () => {
    const first = { textContent: "Start" } as Element;
    const second = { textContent: "Start" } as Element;
    expect(headingMatchesAnchor([first, second], "#start-2")).toBe(second);
  });
});
