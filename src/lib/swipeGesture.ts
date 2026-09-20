/**
 * Pure decision logic for the phone's sidebar swipe: left to right opens the
 * file list, right to left inside the open sheet closes it. The hook
 * (`useSidebarSwipe`) only feeds it touch points and DOM nodes, so the rules
 * live here where they can be tested without a browser.
 */

export type SwipePoint = {
  x: number;
  y: number;
  /** `performance.now()` or `Date.now()` at the time of the touch. */
  time: number;
};

/** Minimum horizontal travel before a touch counts as a swipe. */
export const SWIPE_MIN_DISTANCE = 60;

/** A slow drag is a scroll or a selection, not a gesture. */
export const SWIPE_MAX_DURATION_MS = 600;

/**
 * Horizontal travel has to dominate the vertical one by this factor: a
 * diagonal scroll through a long note must not pull the sidebar in.
 */
const SWIPE_AXIS_RATIO = 2;

export type HorizontalSwipe = "left" | "right";

export function classifyHorizontalSwipe(start: SwipePoint, end: SwipePoint): HorizontalSwipe | null {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);

  if (end.time - start.time > SWIPE_MAX_DURATION_MS) {
    return null;
  }

  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < dy * SWIPE_AXIS_RATIO) {
    return null;
  }

  return dx > 0 ? "right" : "left";
}

export function isOpenSidebarSwipe(start: SwipePoint, end: SwipePoint): boolean {
  return classifyHorizontalSwipe(start, end) === "right";
}

export function isCloseSidebarSwipe(start: SwipePoint, end: SwipePoint): boolean {
  return classifyHorizontalSwipe(start, end) === "left";
}

/**
 * The gesture is off exactly where the caret is: a touch that starts inside
 * an editable region while that region (or any editable one) holds the
 * focus would fight the native text selection. Everywhere else, and over the
 * editor once the caret has left it, the swipe works.
 */
export function isTouchOnFocusedEditable(target: EventTarget | null, activeElement: Element | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const editable = target.closest('[contenteditable="true"], input, textarea');

  if (!editable) {
    return false;
  }

  return activeElement !== null && editable.contains(activeElement);
}

/**
 * A touch inside an open dialog or sheet belongs to that dialog; opening a
 * second sheet from underneath it would stack two panels.
 */
export function isTouchInsideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * A touch that starts in something that scrolls sideways (the phone's
 * toolbar, a wide table, a code block) is a scroll, whichever way it goes;
 * only content that actually overflows counts, a toolbar that fits does not.
 */
export function isTouchInHorizontalScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth) {
      continue;
    }

    const overflowX = getComputedStyle(element).overflowX;

    if (overflowX === "auto" || overflowX === "scroll") {
      return true;
    }
  }

  return false;
}
