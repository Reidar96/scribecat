import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The title row's breadcrumb scrolls horizontally instead of being truncated.
 * Two things have to be arranged for that:
 *
 * - Opening a note parks the scroll at the end, so the file name is what's on
 *   screen. The folders in front of it are what the user scrolls back to,
 *   which is the opposite of what an ellipsis allows.
 * - The left fade (a mask in detail-panel.css) is dropped once there is
 *   nothing hidden to the left, so a path that fits shows no phantom edge.
 *
 * Kept out of DocumentPanel because it is layout bookkeeping, not part of what
 * the title row renders.
 */
export function useBreadcrumbScroll<T extends HTMLElement>(selectedFileLabel: string | null) {
  const elementRef = useRef<T | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);

  const syncFade = useCallback(() => {
    const element = elementRef.current;

    if (element) {
      setIsAtStart(element.scrollLeft <= 1);
    }
  }, []);

  // The label is the dependency, not the path: a rename changes what is
  // rendered without the note changing, and the new name is what should be in
  // view. scrollLeft is clamped by the browser, so an overshoot is the end.
  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    element.scrollLeft = element.scrollWidth;
    syncFade();
  }, [selectedFileLabel, syncFade]);

  return { elementRef, isAtStart, onScroll: syncFade };
}
