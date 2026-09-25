import { useCallback, useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

type ContextMenuPoint = {
  x: number;
  y: number;
};

type LongPressOptions = {
  delayMs?: number;
  movementTolerancePx?: number;
};

/**
 * Gives every existing right-click target the same touch/pen long-press
 * behaviour. One hook instance can bind many targets (lists/grids) without
 * creating hooks inside a map.
 *
 * A successful long press suppresses the synthetic click that mobile browsers
 * emit after pointer-up, so opening the menu never also opens the file/card.
 */
export function useLongPressContextMenu<T>(
  onOpen: (target: T, point: ContextMenuPoint) => void,
  options: LongPressOptions = {}
) {
  const delayMs = options.delayMs ?? 480;
  const movementTolerancePx = options.movementTolerancePx ?? 12;
  const timerRef = useRef<number | null>(null);
  const activeRef = useRef<{
    pointerId: number;
    target: T;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const lastOpenAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearPointer = useCallback(() => {
    clearTimer();
    activeRef.current = null;
  }, [clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer]
  );

  const open = useCallback(
    (target: T, x: number, y: number, suppressClick: boolean) => {
      lastOpenAtRef.current = performance.now();
      suppressClickRef.current = suppressClick;
      onOpen(target, { x, y });
    },
    [onOpen]
  );

  const bind = useCallback(
    (target: T) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (
          event.button !== 0 ||
          (event.pointerType !== "touch" && event.pointerType !== "pen")
        ) {
          return;
        }

        clearPointer();
        activeRef.current = {
          pointerId: event.pointerId,
          target,
          x: event.clientX,
          y: event.clientY
        };

        timerRef.current = window.setTimeout(() => {
          const active = activeRef.current;
          timerRef.current = null;

          if (!active || active.pointerId !== event.pointerId) {
            return;
          }

          open(active.target, active.x, active.y, true);
        }, delayMs);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const active = activeRef.current;
        if (!active || active.pointerId !== event.pointerId) return;

        const dx = event.clientX - active.x;
        const dy = event.clientY - active.y;

        if (Math.hypot(dx, dy) > movementTolerancePx) {
          clearPointer();
        }
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        if (activeRef.current?.pointerId === event.pointerId) {
          clearPointer();
        }
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
        if (activeRef.current?.pointerId === event.pointerId) {
          clearPointer();
        }
      },
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();

        // Some mobile browsers emit a native contextmenu immediately after
        // our long-press timer. The menu is already open in that case.
        if (performance.now() - lastOpenAtRef.current < 350) {
          return;
        }

        open(target, event.clientX, event.clientY, false);
      },
      onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    }),
    [
      clearPointer,
      delayMs,
      movementTolerancePx,
      open
    ]
  );

  return bind;
}
