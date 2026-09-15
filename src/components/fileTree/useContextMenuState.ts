import { useEffect, useState } from "react";

/**
 * State for a right-click menu rendered through `ContextMenuSurface`, plus
 * everything that closes it again: any click, another right-click, scrolling
 * and Escape. `T` carries whatever the menu needs beyond its coordinates.
 */
export function useContextMenuState<T>() {
  const [contextMenu, setContextMenu] = useState<T | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);

    window.addEventListener("click", closeContextMenu);
    // Capture phase: must run before a new right-click on a target (bubble
    // phase) sets a fresh context menu, otherwise this handler would
    // immediately overwrite the new state with null again.
    window.addEventListener("contextmenu", closeContextMenu, true);
    window.addEventListener("scroll", closeContextMenu, true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("contextmenu", closeContextMenu, true);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  return { contextMenu, setContextMenu };
}
