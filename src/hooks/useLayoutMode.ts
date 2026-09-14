import { useSyncExternalStore } from "react";

import {
  PHONE_QUERY,
  TABLET_QUERY,
  layoutModeForWidth,
  type LayoutMode
} from "@/lib/layoutMode";

// One pair of media query lists for the whole app; every subscriber sees the
// same answer as the stylesheets, which use the same two breakpoints.
let phoneQuery: MediaQueryList | null = null;
let tabletQuery: MediaQueryList | null = null;

function queries(): { phone: MediaQueryList; tablet: MediaQueryList } | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  phoneQuery ??= window.matchMedia(PHONE_QUERY);
  tabletQuery ??= window.matchMedia(TABLET_QUERY);

  return { phone: phoneQuery, tablet: tabletQuery };
}

function subscribe(onChange: () => void): () => void {
  const lists = queries();

  if (!lists) {
    return () => undefined;
  }

  lists.phone.addEventListener("change", onChange);
  lists.tablet.addEventListener("change", onChange);

  return () => {
    lists.phone.removeEventListener("change", onChange);
    lists.tablet.removeEventListener("change", onChange);
  };
}

function snapshot(): LayoutMode {
  const lists = queries();

  if (!lists) {
    return "desktop";
  }

  if (lists.phone.matches) {
    return "phone";
  }

  return lists.tablet.matches ? "tablet" : "desktop";
}

/**
 * Which of the three layouts the viewport currently gets. Only the places
 * where the React tree differs (a panel rendered as a sheet instead of a grid
 * column, a menu that exists only on narrow screens) read it; everything
 * that is purely visual stays in CSS behind the same breakpoints.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () =>
    layoutModeForWidth(Number.POSITIVE_INFINITY)
  );
}
