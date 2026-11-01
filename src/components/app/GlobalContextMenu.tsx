import { useEffect, useState } from "react";
import { readClipboardText, writeClipboardText } from "@/platform/clipboardText";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";

/** Fallback for surfaces without their own richer ScribeCat context menu. */
export function GlobalContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  useEffect(() => {
    const context = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const input = target.closest("input,textarea");
      const editable = input || target.closest("[contenteditable=true]");
      const selection = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
        ? input.selectionStart !== input.selectionEnd : !!window.getSelection()?.toString();
      // Empty space has no action. Suppress the browser menu without showing
      // a misleading, custom-styled "Ingen handlinger her" popup.
      setMenu(editable || selection ? { x: event.clientX, y: event.clientY, target } : null);
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
  return <ContextMenuSurface x={menu.x} y={menu.y} title="Teksthandlinger" className="app-context-menu" onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
    {selection && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => action(() => void writeClipboardText(selection))}>Kopier</button>}
    {editable && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => action(() => void readClipboardText().then(insert).catch(() => undefined))}>Lim inn</button>}
    {editable && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => action(() => { editable.focus(); if (input) input.select(); else document.execCommand("selectAll"); })}>Marker alt</button>}
  </ContextMenuSurface>;
}
