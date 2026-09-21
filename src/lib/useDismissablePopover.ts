import { useEffect, type RefObject } from "react";

// Closes a button-opened popover (grid picker, context menu, ...) on
// click/right-click outside, on scroll, or with Escape. Mirrors the context
// menu behavior in FileTree.tsx, but without being tied to mouse events.
//
// The scroll listener runs in the capture phase so it sees scrolling of any
// ancestor, but that also catches the popover's own content scrolling (e.g. a
// long version list) since capture-phase listeners on window see every scroll
// event regardless of bubbling. containerRef lets callers whose popover body
// can scroll internally opt out of dismissing for scrolls that originate
// inside it.
export function useDismissablePopover(
  active: boolean,
  onDismiss: () => void,
  containerRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const dismiss = () => onDismiss();

    const dismissOnScroll = (event: Event) => {
      if (containerRef?.current && event.target instanceof Node && containerRef.current.contains(event.target)) {
        return;
      }
      dismiss();
    };

    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss, true);
    window.addEventListener("scroll", dismissOnScroll, true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss, true);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onDismiss, containerRef]);
}
