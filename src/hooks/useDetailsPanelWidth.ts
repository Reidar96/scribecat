import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

const DETAILS_PANEL_WIDTH_STORAGE_KEY = "scribecat-details-panel-width";
const MIN_DETAILS_PANEL_WIDTH = 220;
const MAX_DETAILS_PANEL_WIDTH = 480;
const DEFAULT_DETAILS_PANEL_WIDTH = 240;
const DETAILS_PANEL_KEYBOARD_STEP = 16;

export const DETAILS_PANEL_MIN_WIDTH = MIN_DETAILS_PANEL_WIDTH;
export const DETAILS_PANEL_MAX_WIDTH = MAX_DETAILS_PANEL_WIDTH;

function clampDetailsPanelWidth(width: number): number {
  return Math.min(MAX_DETAILS_PANEL_WIDTH, Math.max(MIN_DETAILS_PANEL_WIDTH, width));
}

function getInitialDetailsPanelWidth(): number {
  try {
    const stored = window.localStorage.getItem(DETAILS_PANEL_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;

    if (!Number.isNaN(parsed)) {
      return clampDetailsPanelWidth(parsed);
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }

  return DEFAULT_DETAILS_PANEL_WIDTH;
}

function persistDetailsPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(DETAILS_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// Mirrors useChatWidth: the resizer sits on the details panel's left edge, so
// dragging left grows the panel and dragging right shrinks it (the opposite
// sign from the sidebar's resizer, which sits on the sidebar's right edge).
export function useDetailsPanelWidth() {
  const [detailsPanelWidth, setDetailsPanelWidth] = useState<number>(getInitialDetailsPanelWidth);
  const [isResizingDetailsPanel, setIsResizingDetailsPanel] = useState(false);

  const handleDetailsPanelResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailsPanelWidth;
    setIsResizingDetailsPanel(true);
    document.body.classList.add("is-resizing-details-panel");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setDetailsPanelWidth(clampDetailsPanelWidth(startWidth - (moveEvent.clientX - startX)));
    };

    const stopResizing = () => {
      setIsResizingDetailsPanel(false);
      document.body.classList.remove("is-resizing-details-panel");
      setDetailsPanelWidth((currentWidth) => {
        persistDetailsPanelWidth(currentWidth);
        return currentWidth;
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleDetailsPanelResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setDetailsPanelWidth((currentWidth) => {
        const nextWidth = clampDetailsPanelWidth(currentWidth + DETAILS_PANEL_KEYBOARD_STEP);
        persistDetailsPanelWidth(nextWidth);
        return nextWidth;
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setDetailsPanelWidth((currentWidth) => {
        const nextWidth = clampDetailsPanelWidth(currentWidth - DETAILS_PANEL_KEYBOARD_STEP);
        persistDetailsPanelWidth(nextWidth);
        return nextWidth;
      });
    }
  };

  return {
    detailsPanelWidth,
    isResizingDetailsPanel,
    handleDetailsPanelResizeStart,
    handleDetailsPanelResizeKeyDown
  };
}
