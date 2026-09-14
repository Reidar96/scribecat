import { useEffect } from "react";

/**
 * Mirrors the visual viewport's height into `--viewport-height` on the root
 * element. On phones the on-screen keyboard takes part of the screen; Chrome
 * with `interactive-widget=resizes-content` shrinks the layout viewport
 * accordingly, but Safari on iOS leaves it alone and pans the page instead,
 * which pushes the toolbar out of view and lets the whole app shell scroll.
 * The narrow layouts size the shell with this variable (responsive.css), and
 * the pan is undone here, so the toolbar stays above the keyboard on both.
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const root = document.documentElement;

    const apply = () => {
      root.style.setProperty("--viewport-height", `${Math.round(viewport.height)}px`);

      // Safari pans the document to keep the focused field visible even
      // though the shell is fixed. The shell has already been resized to the
      // visible area by the time this runs, so the pan only hides the top.
      if (window.scrollY !== 0 || viewport.offsetTop !== 0) {
        window.scrollTo(0, 0);
      }
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);

    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      root.style.removeProperty("--viewport-height");
    };
  }, []);
}
