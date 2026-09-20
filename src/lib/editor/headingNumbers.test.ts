import { describe, expect, it } from "vitest";

import {
  computeHeadingNumbers,
  findUnnumberedMarker,
  normalizeHeadingNumberingSettings,
  stripUnnumberedMarker,
  type HeadingNumberingSettings
} from "./headingNumbers";

const on = (overrides: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings => ({
  enabled: true,
  startLevel: 1,
  maxDepth: 6,
  scope: "everywhere",
  marker: "activeLine",
  ...overrides
});

const h = (level: number, title: string) => ({ level, title });

describe("computeHeadingNumbers", () => {
  it("numbers decimal style and restarts lower levels under a new parent", () => {
    const headings = [h(1, "A"), h(2, "A.1"), h(3, "A.1.1"), h(2, "A.2"), h(1, "B"), h(2, "B.1")];

    expect(computeHeadingNumbers(headings, on())).toEqual(["1.", "1.1.", "1.1.1.", "1.2.", "2.", "2.1."]);
  });

  it("gives nothing while switched off", () => {
    expect(computeHeadingNumbers([h(1, "A"), h(2, "B")], on({ enabled: false }))).toEqual([null, null]);
  });

  it("starts at H2 and still restarts under an unnumbered H1", () => {
    const headings = [h(1, "Title"), h(2, "One"), h(3, "One.One"), h(1, "Part two"), h(2, "Two")];

    expect(computeHeadingNumbers(headings, on({ startLevel: 2 }))).toEqual([null, "1.", "1.1.", null, "1."]);
  });

  it("stops at the configured depth without disturbing the counters", () => {
    const headings = [h(1, "A"), h(2, "A.1"), h(3, "deep"), h(2, "A.2")];

    expect(computeHeadingNumbers(headings, on({ maxDepth: 2 }))).toEqual(["1.", "1.1.", null, "1.2."]);
  });

  it("reads a skipped level as 0, the way Pandoc does", () => {
    expect(computeHeadingNumbers([h(1, "A"), h(3, "A.?.1")], on())).toEqual(["1.", "1.0.1."]);
  });

  it("leaves a {-} heading and its subtree without a number and does not count it", () => {
    const headings = [
      h(1, "Preface {-}"),
      h(2, "Thanks"),
      h(1, "Intro"),
      h(2, "Scope"),
      h(2, "Notes {.unnumbered}"),
      h(3, "Below notes"),
      h(2, "Method")
    ];

    expect(computeHeadingNumbers(headings, on())).toEqual([null, null, "1.", "1.1.", null, null, "1.2."]);
  });

  it("recognises the marker inside a larger attribute block", () => {
    expect(computeHeadingNumbers([h(1, "A {#a .unnumbered}"), h(1, "B")], on())).toEqual([null, "1."]);
  });
});

describe("unnumbered marker", () => {
  it("finds {-} and {.unnumbered} at the end of the title only", () => {
    expect(findUnnumberedMarker("Preface {-}")).toBe(7);
    expect(findUnnumberedMarker("Preface {.unnumbered}  ")).toBe(7);
    expect(findUnnumberedMarker("Preface {#id .unnumbered}")).toBe(7);
    expect(findUnnumberedMarker("{-} Preface")).toBe(-1);
    expect(findUnnumberedMarker("Preface {#id}")).toBe(-1);
    expect(findUnnumberedMarker("Preface {-} more")).toBe(-1);
  });

  it("strips only the marker from the title", () => {
    expect(stripUnnumberedMarker("Preface {-}")).toBe("Preface");
    expect(stripUnnumberedMarker("Preface {#id}")).toBe("Preface {#id}");
    expect(stripUnnumberedMarker("Plain")).toBe("Plain");
  });
});

describe("normalizeHeadingNumberingSettings", () => {
  it("falls back to the defaults for garbage", () => {
    const defaults = { enabled: false, startLevel: 2, maxDepth: 6, scope: "everywhere", marker: "activeLine" };

    expect(normalizeHeadingNumberingSettings(null)).toEqual(defaults);
    expect(
      normalizeHeadingNumberingSettings({ enabled: "yes", startLevel: 3, maxDepth: "x", scope: "editor", marker: 1 })
    ).toEqual(defaults);
  });

  it("keeps the display options a file from an older version does not have at their defaults", () => {
    const settings = normalizeHeadingNumberingSettings({ enabled: true, startLevel: 1, maxDepth: 3 });

    expect(settings.scope).toBe("everywhere");
    expect(settings.marker).toBe("activeLine");
    expect(normalizeHeadingNumberingSettings({ scope: "outline", marker: "always" })).toMatchObject({
      scope: "outline",
      marker: "always"
    });
  });

  it("keeps the depth at or below the start level and within 6", () => {
    expect(normalizeHeadingNumberingSettings({ enabled: true, startLevel: 2, maxDepth: 1 })).toMatchObject({
      enabled: true,
      startLevel: 2,
      maxDepth: 2
    });
    expect(normalizeHeadingNumberingSettings({ enabled: true, startLevel: 1, maxDepth: 9 }).maxDepth).toBe(6);
  });
});
