import { useEffect } from "react";

import { platform } from "@/platform";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

export function useWebviewZoom(): void {
  useEffect(() => {
    useEditorSettingsStore.getState().setZoomLevel(0);
    document.body.style.removeProperty("zoom");
    void platform.window.setZoom(1).catch(() => undefined);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) event.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);
}
