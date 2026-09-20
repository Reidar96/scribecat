import { useEffect, useRef } from "react";

import {
  classifyHorizontalSwipe,
  isTouchInHorizontalScroller,
  isTouchInsideDialog,
  isTouchOnFocusedEditable,
  type SwipePoint
} from "@/lib/swipeGesture";

type UseSidebarSwipeOptions = {
  /** Only the phone layout has the sidebar in a sheet. */
  enabled: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/**
 * Sidebar sheet gestures on the phone: a left-to-right swipe anywhere in the
 * app opens it, a right-to-left swipe inside the open sheet closes it.
 *
 * Two places stay silent. Over the focused editor the touch is the user's
 * text selection, not a gesture (see `isTouchOnFocusedEditable`). And while
 * a tree row is being dragged, the finger movement is the drag: the webview
 * cancels the touch when a native drag starts, and the `dragstart`/`dragend`
 * pair below covers the platforms where it does not.
 */
export function useSidebarSwipe({ enabled, isOpen, onOpen, onClose }: UseSidebarSwipeOptions): void {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let start: SwipePoint | null = null;
    let isDragging = false;

    const handleTouchStart = (event: TouchEvent) => {
      start = null;

      if (event.touches.length !== 1 || isDragging || isTouchInHorizontalScroller(event.target)) {
        return;
      }

      const insideSheet = isTouchInsideSidebarSheet(event.target);

      // Closed: any surface but a dialog and the caret's own region. Open:
      // the sheet and its dimmed backdrop, but not a dialog stacked on top.
      if (isOpen ? !insideSheet : isTouchInsideDialog(event.target)) {
        return;
      }

      if (!isOpen && isTouchOnFocusedEditable(event.target, document.activeElement)) {
        return;
      }

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const from = start;
      start = null;

      if (!from || isDragging || event.changedTouches.length !== 1) {
        return;
      }

      const touch = event.changedTouches[0];
      const end: SwipePoint = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      const swipe = classifyHorizontalSwipe(from, end);

      if (isOpen && swipe === "left") {
        onCloseRef.current();
      } else if (!isOpen && swipe === "right") {
        onOpenRef.current();
      }
    };

    const reset = () => {
      start = null;
    };

    const handleDragStart = () => {
      isDragging = true;
      start = null;
    };

    const handleDragEnd = () => {
      isDragging = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    window.addEventListener("dragstart", handleDragStart);
    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("drop", handleDragEnd);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", reset);
      window.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("drop", handleDragEnd);
    };
  }, [enabled, isOpen]);
}

function isTouchInsideSidebarSheet(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const sheet = target.closest(".mobile-sheet");

  if (!sheet || !sheet.querySelector(".mobile-sheet__panel--sidebar")) {
    return false;
  }

  // The sheet panel is itself a dialog; only one above it takes the touch.
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');

  return dialog === null || dialog.classList.contains("mobile-sheet__panel--sidebar");
}
