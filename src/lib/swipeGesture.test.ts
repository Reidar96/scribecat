// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  isCloseSidebarSwipe,
  isOpenSidebarSwipe,
  isTouchInHorizontalScroller,
  isTouchInsideDialog,
  isTouchOnFocusedEditable,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MIN_DISTANCE
} from "./swipeGesture";

const at = (x: number, y: number, time = 0) => ({ x, y, time });

describe("isOpenSidebarSwipe", () => {
  it("accepts a quick, mostly horizontal swipe to the right", () => {
    expect(isOpenSidebarSwipe(at(10, 100), at(10 + SWIPE_MIN_DISTANCE, 110, 200))).toBe(true);
  });

  it("rejects a swipe to the left", () => {
    expect(isOpenSidebarSwipe(at(200, 100), at(20, 100, 200))).toBe(false);
  });

  it("rejects a swipe that is too short", () => {
    expect(isOpenSidebarSwipe(at(10, 100), at(10 + SWIPE_MIN_DISTANCE - 1, 100, 200))).toBe(false);
  });

  it("rejects a diagonal drag that is mostly a scroll", () => {
    expect(isOpenSidebarSwipe(at(10, 100), at(90, 180, 200))).toBe(false);
  });

  it("rejects a slow drag", () => {
    expect(isOpenSidebarSwipe(at(10, 100), at(200, 100, SWIPE_MAX_DURATION_MS + 1))).toBe(false);
  });
});

describe("isCloseSidebarSwipe", () => {
  it("accepts a quick swipe to the left", () => {
    expect(isCloseSidebarSwipe(at(200, 100), at(200 - SWIPE_MIN_DISTANCE, 110, 200))).toBe(true);
  });

  it("rejects a swipe to the right and a vertical scroll", () => {
    expect(isCloseSidebarSwipe(at(20, 100), at(200, 100, 200))).toBe(false);
    expect(isCloseSidebarSwipe(at(200, 100), at(140, 300, 200))).toBe(false);
  });
});

describe("isTouchOnFocusedEditable", () => {
  it("is false outside any editable region", () => {
    const toolbar = document.createElement("div");
    expect(isTouchOnFocusedEditable(toolbar, null)).toBe(false);
  });

  it("is true when the touch starts in the editable that holds the focus", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    editor.appendChild(paragraph);

    expect(isTouchOnFocusedEditable(paragraph, editor)).toBe(true);
  });

  it("is false over the editable once the focus has left it", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    editor.appendChild(paragraph);
    const button = document.createElement("button");

    expect(isTouchOnFocusedEditable(paragraph, button)).toBe(false);
    expect(isTouchOnFocusedEditable(paragraph, null)).toBe(false);
  });

  it("treats a focused input like the editor", () => {
    const input = document.createElement("input");
    expect(isTouchOnFocusedEditable(input, input)).toBe(true);
  });
});

describe("isTouchInsideDialog", () => {
  it("is true for a touch inside a dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const child = document.createElement("span");
    dialog.appendChild(child);

    expect(isTouchInsideDialog(child)).toBe(true);
    expect(isTouchInsideDialog(document.createElement("span"))).toBe(false);
  });
});

describe("isTouchInHorizontalScroller", () => {
  const scroller = (overflowX: string, scrollWidth: number, clientWidth: number) => {
    const element = document.createElement("div");
    element.style.overflowX = overflowX;
    Object.defineProperty(element, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(element, "clientWidth", { value: clientWidth });
    document.body.appendChild(element);

    return element;
  };

  it("is true inside an overflowing toolbar", () => {
    const toolbar = scroller("auto", 800, 400);
    const button = document.createElement("button");
    toolbar.appendChild(button);

    expect(isTouchInHorizontalScroller(button)).toBe(true);
  });

  it("is false when the content fits", () => {
    const toolbar = scroller("auto", 400, 400);
    expect(isTouchInHorizontalScroller(toolbar)).toBe(false);
  });

  it("is false when the overflow is clipped rather than scrollable", () => {
    const box = scroller("hidden", 800, 400);
    expect(isTouchInHorizontalScroller(box)).toBe(false);
  });
});
