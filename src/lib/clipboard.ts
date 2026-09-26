/**
 * Copy plain text without relying on one particular browser/webview clipboard path.
 */
function copyViaCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  const previousActive = document.activeElement as HTMLElement | null;

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

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

  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through: some webviews expose the API but reject this write.
    }
  }

  return copyViaCommand(text);
}
