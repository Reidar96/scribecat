import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { readClipboardText, writeClipboardText } from "@/platform/clipboardText";

/** Fallback for surfaces without their own richer ScribeCat context menu. */
export function GlobalContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  useEffect(() => {
    const context = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const target = event.target;
      if (target instanceof HTMLElement) setMenu({ x: event.clientX, y: event.clientY, target });
    };
    const close = () => setMenu(null);
    window.addEventListener("contextmenu", context);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("contextmenu", context); window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, []);
  if (!menu) return null;
  const input = menu.target.closest<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  const editable = input ?? menu.target.closest<HTMLElement>("[contenteditable=true]");
  const selection = input ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) : window.getSelection()?.toString() ?? "";
  const insert = (text: string) => {
    if (!editable) return;
    editable.focus();
    if (input) {
      input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else document.execCommand("insertText", false, text);
  };
  const action = (fn: () => void) => { fn(); setMenu(null); };
  return createPortal(<div className="global-context-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 160) }} onPointerDown={(event) => event.stopPropagation()}>
    {selection && <button role="menuitem" onClick={() => action(() => void writeClipboardText(selection))}>Kopier</button>}
    {editable && <button role="menuitem" onClick={() => action(() => void readClipboardText().then(insert).catch(() => undefined))}>Lim inn</button>}
    {editable && <button role="menuitem" onClick={() => action(() => { editable.focus(); if (input) input.select(); else document.execCommand("selectAll"); })}>Marker alt</button>}
    {!editable && !selection && <span>Ingen handlinger her</span>}
  </div>, document.body);
}
