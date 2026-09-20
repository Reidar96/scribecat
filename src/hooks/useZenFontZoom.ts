import { useEffect, useState } from "react";

import {
  applyWheelZoom,
  distanceBetween,
  isZoomWheel,
  pinchedFontSizePt,
  type WheelZoomState
} from "@/lib/zenFontZoom";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/** How long the size readout stays on screen after the last gesture. */
const READOUT_MS = 900;

/**
 * Reader-style text zoom in Zen mode: a two-finger pinch on a touch screen
 * or Ctrl+wheel (Cmd+wheel on a Mac) resizes the document text and nothing
 * else. Both gestures are claimed here so the webview does not zoom the
 * page instead, which is also why the touch listener is not passive.
 *
 * The size lands in `zenFontSizePt`, which only the Zen column reads; the
 * normal view and the exports keep the document size from the settings.
 * Returns the size to show in a readout while a gesture is in progress,
 * `null` once it has faded.
 */
export function useZenFontZoom(enabled: boolean): number | null {
  const [readoutSizePt, setReadoutSizePt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let readoutTimer: ReturnType<typeof setTimeout> | null = null;

    const currentSizePt = () => {
      const { zenFontSizePt, fontSizePt } = useEditorSettingsStore.getState();
      return zenFontSizePt ?? fontSizePt;
    };

    const commit = (sizePt: number) => {
      useEditorSettingsStore.getState().setZenFontSizePt(sizePt);
      setReadoutSizePt(useEditorSettingsStore.getState().zenFontSizePt);

      if (readoutTimer !== null) {
        clearTimeout(readoutTimer);
      }

      readoutTimer = setTimeout(() => {
        setReadoutSizePt(null);
      }, READOUT_MS);
    };

    // The pinch is measured against its own start, not incrementally, so a
    // finger jitter does not drift the size.
    let pinchStart: { distance: number; sizePt: number } | null = null;

    const touchDistance = (touches: TouchList) =>
      distanceBetween(
        { x: touches[0].clientX, y: touches[0].clientY },
        { x: touches[1].clientX, y: touches[1].clientY }
      );

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchStart = { distance: touchDistance(event.touches), sizePt: currentSizePt() };
      } else {
        pinchStart = null;
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!pinchStart || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      commit(pinchedFontSizePt(pinchStart.sizePt, pinchStart.distance, touchDistance(event.touches)));
    };

    const handleTouchEnd = () => {
      pinchStart = null;
    };

    let wheel: WheelZoomState = { sizePt: currentSizePt(), carry: 0 };

    const handleWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) {
        return;
      }

      event.preventDefault();
      // Re-read the size in case a pinch or the settings changed it meanwhile.
      wheel = applyWheelZoom({ ...wheel, sizePt: currentSizePt() }, event.deltaY);
      commit(wheel.sizePt);
    };

    // Safari's own pinch event; preventing it is what keeps the page still.
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
    document.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("gesturestart", preventGesture);

    return () => {
      if (readoutTimer !== null) {
        clearTimeout(readoutTimer);
      }

      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("wheel", handleWheel);
      document.removeEventListener("gesturestart", preventGesture);
      setReadoutSizePt(null);
    };
  }, [enabled]);

  return readoutSizePt;
}
