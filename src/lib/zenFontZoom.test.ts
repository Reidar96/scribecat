import { describe, expect, it } from "vitest";

import {
  applyWheelZoom,
  clampZenFontSizePt,
  distanceBetween,
  getZenFontScale,
  isZoomWheel,
  pinchedFontSizePt,
  ZEN_FONT_SIZE_PT_MAX,
  ZEN_FONT_SIZE_PT_MIN,
  ZEN_WHEEL_PX_PER_STEP
} from "./zenFontZoom";

describe("clampZenFontSizePt", () => {
  it("snaps to half points inside the range", () => {
    expect(clampZenFontSizePt(11.3)).toBe(11.5);
    expect(clampZenFontSizePt(11.2)).toBe(11);
  });

  it("stays inside the reader range", () => {
    expect(clampZenFontSizePt(2)).toBe(ZEN_FONT_SIZE_PT_MIN);
    expect(clampZenFontSizePt(99)).toBe(ZEN_FONT_SIZE_PT_MAX);
    expect(clampZenFontSizePt(Number.NaN)).toBe(ZEN_FONT_SIZE_PT_MIN);
  });
});

describe("getZenFontScale", () => {
  it("scales past the settings range the document size is limited to", () => {
    expect(getZenFontScale(11)).toBe(1);
    expect(getZenFontScale(22)).toBe(2);
  });
});

describe("pinchedFontSizePt", () => {
  it("scales the starting size by the finger distance ratio", () => {
    expect(pinchedFontSizePt(12, 100, 150)).toBe(18);
    expect(pinchedFontSizePt(12, 100, 50)).toBe(ZEN_FONT_SIZE_PT_MIN);
  });

  it("keeps the size when the gesture started with the fingers together", () => {
    expect(pinchedFontSizePt(12, 0, 80)).toBe(12);
  });

  it("measures the distance between two touches", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("applyWheelZoom", () => {
  it("enlarges on scroll up by one step per notch", () => {
    const next = applyWheelZoom({ sizePt: 12, carry: 0 }, -100);
    expect(next.sizePt).toBe(13);
    expect(next.carry).toBe(0);
  });

  it("shrinks on scroll down", () => {
    expect(applyWheelZoom({ sizePt: 12, carry: 0 }, ZEN_WHEEL_PX_PER_STEP).sizePt).toBe(11.5);
  });

  it("accumulates trackpad deltas below one step", () => {
    const first = applyWheelZoom({ sizePt: 12, carry: 0 }, -20);
    expect(first.sizePt).toBe(12);
    expect(first.carry).toBe(20);

    const second = applyWheelZoom(first, -35);
    expect(second.sizePt).toBe(12.5);
    expect(second.carry).toBe(5);
  });

  it("drops the carry at the limits so the way back starts at once", () => {
    const pinned = applyWheelZoom({ sizePt: ZEN_FONT_SIZE_PT_MAX, carry: 0 }, -1000);
    expect(pinned.sizePt).toBe(ZEN_FONT_SIZE_PT_MAX);
    expect(pinned.carry).toBe(0);
  });
});

describe("isZoomWheel", () => {
  it("recognises the browser zoom modifiers", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});
