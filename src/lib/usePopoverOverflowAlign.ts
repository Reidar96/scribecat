import { useLayoutEffect, type CSSProperties, type RefObject } from "react";

/** Where a popover hangs off its trigger button, measured on open. */
export type PopoverAnchor = {
  /** Below the button: distance from the top of the viewport. */
  top: number;
  /** Above the button: distance from the bottom of the viewport. */
  bottom: number;
  left: number;
  /** Distance from the right edge of the viewport, for right-aligned popovers. */
  right: number;
};

const ANCHOR_GAP_PX = 6;

export function anchorForTrigger(rect: DOMRect): PopoverAnchor {
  return {
    top: rect.bottom + ANCHOR_GAP_PX,
    bottom: window.innerHeight - rect.top + ANCHOR_GAP_PX,
    left: rect.left,
    right: window.innerWidth - rect.right
  };
}

export function popoverStyle(
  anchor: PopoverAnchor,
  align: "left" | "right",
  valign: "below" | "above" = "below"
): CSSProperties {
  return {
    ...(valign === "above" ? { bottom: anchor.bottom } : { top: anchor.top }),
    ...(align === "right" ? { right: anchor.right } : { left: anchor.left })
  };
}

// Flips a popover from left- to right-aligned relative to its anchor button
// if it would otherwise overflow the right edge of the viewport, and from
// below to above it if it would overflow the bottom (the toolbar sits at the
// bottom of the screen on phones and tablets). Some popover contents (e.g.
// the emoji-mart custom element) only reach their final size asynchronously
// after mount, so a single measurement right after mount is not enough: a
// ResizeObserver re-checks every time the popover's size settles. `anchor`
// is only used as an effect dependency to re-measure whenever the popover
// (re)opens at a new position.
export function usePopoverOverflowAlign(
  anchor: unknown,
  ref: RefObject<HTMLElement | null>,
  setAlign: (align: "left" | "right") => void,
  setValign?: (valign: "below" | "above") => void
) {
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      return;
    }

    const element = ref.current;

    const checkOverflow = () => {
      const rect = element.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        setAlign("right");
      }
      if (setValign && rect.bottom > window.innerHeight) {
        setValign("above");
      }
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
}
