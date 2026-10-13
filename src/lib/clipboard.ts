/**
 * Copy text through the browser/webview clipboard pipeline.
 *
 * The copy event route is deliberately used as the fallback: unlike a
 * temporary textarea, it does not move focus away from the current document
 * selection and matches the synchronous mechanism used by the editor itself.
 */
function copyViaCommand(text: string): boolean {
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData("text/plain", text);
  };

  document.addEventListener("copy", handleCopy, { capture: true, once: true });

  try {
    if (document.execCommand("copy")) return true;
  } catch {
    // Try a selected textarea below when a browser needs a concrete selection.
  } finally {
    document.removeEventListener("copy", handleCopy, { capture: true });
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    selection?.removeAllRanges();
    ranges.forEach((range) => selection?.addRange(range));
    previousFocus?.focus({ preventScroll: true });
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or unavailable in this webview: use the same
      // synchronous copy-event route as editor selections.
    }
  }

  return copyViaCommand(text);
}
