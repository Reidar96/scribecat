/**
 * Copy text reliably in browsers and desktop webviews.
 *
 * The synchronous execCommand path runs while the button click still has
 * user activation. This matters because awaiting navigator.clipboard first
 * can consume that activation and make the fallback fail in some webviews.
 */
function copyViaExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  const previousActive = document.activeElement as HTMLElement | null;

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none"
  });

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    previousActive?.focus?.({ preventScroll: true });
  }

  return copied;
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // Prefer the synchronous route so a click on Copy keeps its user-activation
  // context in Chromium/Tauri webviews.
  if (copyViaExecCommand(text)) {
    return true;
  }

  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
