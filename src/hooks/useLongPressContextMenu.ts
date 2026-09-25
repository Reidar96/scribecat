import { useEffect, useRef } from "react";
import type { MouseEventHandler, PointerEventHandler } from "react";

const LONG_PRESS_MS = 520;
const MOVE_TOLERANCE_PX = 10;

type LongPressState<T> = {
  target: T;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  fired: boolean;
};

export type LongPressProps = {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onClickCapture: MouseEventHandler<HTMLElement>;
};

export function useLongPressContextMenu<T>(
  onOpen: (target: T, x: number, y: number) => void
) {
  const stateRef = useRef<LongPressState<T> | null>(null);
  const suppressNextClickRef = useRef(false);

  const clear = () => {
    const state = stateRef.current;
    if (state) {
      window.clearTimeout(state.timer);
      stateRef.current = null;
    }
  };

  useEffect(
    () => () => {
      const state = stateRef.current;
      if (state) {
        window.clearTimeout(state.timer);
      }
    },
    []
  );

  const getLongPressProps = (target: T): LongPressProps => ({
    onPointerDown: (event) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;

      clear();
      const state: LongPressState<T> = {
        target,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: 0,
        fired: false
      };

      state.timer = window.setTimeout(() => {
        if (stateRef.current !== state) return;
        state.fired = true;
        suppressNextClickRef.current = true;
        onOpen(state.target, state.x, state.y);
      }, LONG_PRESS_MS);

      stateRef.current = state;
    },
    onPointerMove: (event) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== event.pointerId || state.fired) return;

      if (
        Math.abs(event.clientX - state.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - state.y) > MOVE_TOLERANCE_PX
      ) {
        clear();
      }
    },
    onPointerUp: (event) => {
      if (stateRef.current?.pointerId === event.pointerId) clear();
    },
    onPointerCancel: (event) => {
      if (stateRef.current?.pointerId === event.pointerId) clear();
    },
    onClickCapture: (event) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  });

  return { getLongPressProps };
}
