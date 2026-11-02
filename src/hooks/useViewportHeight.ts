import { useEffect } from "react";

function focusedCaretRect(field: HTMLElement): DOMRect {
  if (field instanceof HTMLTextAreaElement) {
    const style = getComputedStyle(field);
    const mirror = document.createElement("div");
    mirror.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;";
    mirror.style.width = `${field.clientWidth}px`;
    mirror.style.padding = style.padding;
    mirror.style.font = style.font;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.lineHeight = style.lineHeight;
    mirror.append(document.createTextNode(field.value.slice(0, field.selectionStart)));
    const caret = document.createElement("span");
    caret.textContent = "\u200b";
    mirror.append(caret);
    document.body.append(mirror);
    const top = field.getBoundingClientRect().top + caret.offsetTop - field.scrollTop;
    const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    mirror.remove();
    return new DOMRect(field.getBoundingClientRect().left, top, 1, height);
  }
  if (field.isContentEditable) {
    const selection = window.getSelection();
    if (selection?.focusNode && field.contains(selection.focusNode)) {
      const range = document.createRange();
      range.setStart(selection.focusNode, selection.focusOffset);
      range.collapse(true);
      const rect = range.getClientRects()[0];
      if (rect?.height) return rect;
    }
  }
  return field.getBoundingClientRect();
}

function keepFocusedFieldVisible(viewport: VisualViewport) {
  if (!window.matchMedia("(max-width: 920px)").matches) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches("input:not([type='checkbox']):not([type='radio']),textarea,[contenteditable='true']")) return;
  const top = viewport.offsetTop + 16;
  const bottom = viewport.offsetTop + viewport.height - 24;
  const rect = focusedCaretRect(active);
  const keyboardOpen = viewport.height < window.innerHeight - 100;
  // Keep the insertion point near the top while typing. Checking the whole
  // textarea made long notes impossible to reveal reliably on iOS.
  const preferredTop = top + Math.min(96, viewport.height * .2);
  const delta = rect.top < top ? rect.top - top
    : keyboardOpen && rect.top > preferredTop ? rect.top - preferredTop
    : rect.bottom > bottom ? rect.bottom - bottom : 0;
  if (!delta) return;
  for (let parent = active.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (/(auto|scroll)/.test(overflow) && parent.scrollHeight > parent.clientHeight + 1) {
      parent.scrollTop += delta;
      break;
    }
  }
}

/**
 * Mirrors the visual viewport's height into `--viewport-height` on the root
 * element. On phones the on-screen keyboard takes part of the screen; Chrome
 * with `interactive-widget=resizes-content` shrinks the layout viewport
 * accordingly, but Safari on iOS leaves it alone and pans the page instead,
 * which pushes the toolbar out of view and lets the whole app shell scroll.
 * The narrow layouts size the shell with this variable (responsive.css), and
 * the pan is undone here, so the toolbar stays above the keyboard on both.
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    let frame = 0;
    let settle = 0;

    const reveal = () => {
      if (!window.matchMedia("(max-width: 920px)").matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => keepFocusedFieldVisible(viewport));
      window.clearTimeout(settle);
      // iOS animates the keyboard after focus; make a final adjustment once
      // the viewport and the app's scroll container have reached their size.
      settle = window.setTimeout(() => keepFocusedFieldVisible(viewport), 280);
    };

    const apply = () => {
      root.style.setProperty("--viewport-height", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--keyboard-edit-space", viewport.height < window.innerHeight - 100 ? `${Math.max(0, Math.round(viewport.height - 140))}px` : "0px");

      // Safari pans the document to keep the focused field visible even
      // though the shell is fixed. The shell has already been resized to the
      // visible area by the time this runs, so the pan only hides the top.
      if (window.scrollY !== 0 || viewport.offsetTop !== 0) {
        window.scrollTo(0, 0);
      }
      reveal();
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    document.addEventListener("focusin", reveal);
    document.addEventListener("input", reveal);
    document.addEventListener("selectionchange", reveal);

    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      document.removeEventListener("focusin", reveal);
      document.removeEventListener("input", reveal);
      document.removeEventListener("selectionchange", reveal);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      root.style.removeProperty("--viewport-height");
      root.style.removeProperty("--keyboard-edit-space");
    };
  }, []);
}
