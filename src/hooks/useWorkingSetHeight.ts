import { useCallback, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

const STORAGE_KEY = "scribecat-working-set-height";
/** Fallback when the list has not rendered yet; the CSS variable is the truth. */
const FALLBACK_ROW_HEIGHT_PX = 44;
const DEFAULT_ROWS = 6;
const MIN_ROWS = 2;
/** The list never claims more than this share of the sidebar from the tree. */
const MAX_SIDEBAR_SHARE = 0.6;
const KEYBOARD_STEP_ROWS = 1;

function readStoredHeight(): number | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;

    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function persistHeight(height: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type UseWorkingSetHeightOptions = {
  /** The scrolling list; its content height is the upper bound of the drag. */
  listRef: RefObject<HTMLElement | null>;
  /** The sidebar area both sections share; 60 % of it is the other bound. */
  containerRef: RefObject<HTMLElement | null>;
};

/**
 * The height of the "In progress" list, as a *ceiling*: the list is as tall
 * as its rows, at most this tall, then scrolls. Same drag/keyboard/clamp/
 * localStorage pattern as useSidebarWidth, turned horizontal. The ceiling
 * is app-wide, the row height comes from CSS (`--working-set-row-height`),
 * so the two never disagree about what "one row" is.
 *
 * The clamp is what keeps the handle honest: it never drops below two rows
 * and never goes past the content, so with two entries the handle sits under
 * the second row and stays there.
 */
export function useWorkingSetHeight({ listRef, containerRef }: UseWorkingSetHeightOptions) {
  const [maxHeight, setMaxHeight] = useState<number>(() => readStoredHeight() ?? DEFAULT_ROWS * FALLBACK_ROW_HEIGHT_PX);
  const [isResizing, setIsResizing] = useState(false);

  const rowHeight = useCallback((): number => {
    const list = listRef.current;

    if (!list) {
      return FALLBACK_ROW_HEIGHT_PX;
    }

    const value = Number.parseFloat(getComputedStyle(list).getPropertyValue("--working-set-row-height"));

    return Number.isFinite(value) && value > 0 ? value : FALLBACK_ROW_HEIGHT_PX;
  }, [listRef]);

  const clamp = useCallback(
    (height: number): number => {
      const row = rowHeight();
      const contentHeight = listRef.current?.scrollHeight ?? Number.POSITIVE_INFINITY;
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY;
      const upper = Math.max(MIN_ROWS * row, Math.min(contentHeight, containerHeight * MAX_SIDEBAR_SHARE));

      return Math.min(upper, Math.max(MIN_ROWS * row, height));
    },
    [containerRef, listRef, rowHeight]
  );

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startY = event.clientY;
    // The drag starts from where the handle *is*, which is the visible
    // height, not a ceiling the content may never have reached.
    const startHeight = Math.min(maxHeight, listRef.current?.getBoundingClientRect().height ?? maxHeight);
    setIsResizing(true);
    document.body.classList.add("is-resizing-working-set");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setMaxHeight(clamp(startHeight + (moveEvent.clientY - startY)));
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.classList.remove("is-resizing-working-set");
      setMaxHeight((current) => {
        persistHeight(current);
        return current;
      });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const delta = (event.key === "ArrowDown" ? 1 : -1) * KEYBOARD_STEP_ROWS * rowHeight();

    setMaxHeight((current) => {
      const visible = Math.min(current, listRef.current?.getBoundingClientRect().height ?? current);
      const next = clamp(visible + delta);
      persistHeight(next);
      return next;
    });
  };

  return { maxHeight, isResizing, handleResizeStart, handleResizeKeyDown };
}

/** A collapsed/expanded flag kept app-wide in localStorage, default expanded. */
export function useStoredCollapsed(storageKey: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;

      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // localStorage may be unavailable in some environments.
      }

      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle];
}
