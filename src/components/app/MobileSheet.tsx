import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type MobileSheetProps = {
  /** Where the sheet comes from; "full" covers the whole viewport. */
  side: "left" | "right" | "full";
  label: string;
  /** Dim the rest of the app and close on a tap outside. Off for the tablet
      side sheets, where the editor underneath stays in use. */
  backdrop?: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * Container for a panel that is a grid column on the desktop but has no room
 * beside the editor on a phone or tablet: the sidebar, the chat and the
 * details panel render their usual component inside it. The panel component
 * itself does not know it is in a sheet; only the close path differs, and the
 * caller wires that to the same action that hides the column on the desktop.
 */
export function MobileSheet({
  side,
  label,
  backdrop = true,
  onClose,
  children,
  className
}: MobileSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // A sheet is opened by a tap somewhere else; the focus follows it in so the
  // next Tab lands inside and the Escape above is heard while typing in it.
  useEffect(() => {
    const previous = document.activeElement;
    sheetRef.current?.focus({ preventScroll: true });

    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div className={cn("mobile-sheet", `mobile-sheet--${side}`, backdrop && "mobile-sheet--backdrop")}>
      {backdrop ? (
        <div className="mobile-sheet__backdrop" aria-hidden="true" onClick={() => onCloseRef.current()} />
      ) : null}
      <div
        ref={sheetRef}
        className={cn("mobile-sheet__panel", className)}
        role="dialog"
        aria-modal={backdrop}
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
