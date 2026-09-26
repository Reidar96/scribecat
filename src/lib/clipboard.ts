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
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", handleCopy, { capture: true });
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
