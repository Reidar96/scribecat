import { isTauri } from "@tauri-apps/api/core";
import { copyText } from "@/lib/clipboard";

export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
    return clipboard.readText();
  }
  if (!navigator.clipboard?.readText) throw new Error("Clipboard text is unavailable.");
  return navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
    await clipboard.writeText(text);
    return;
  }
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard text is unavailable.");
  await navigator.clipboard.writeText(text);
}

export async function writeHeadingLink(title: string, href: string): Promise<void> {
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedHref = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const markdown = `[${title.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}](${href})`;
  if (isTauri()) {
    try {
      const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
      await clipboard.writeHtml(`<a href="${escapedHref}">${escapedTitle}</a>`, markdown);
      return;
    } catch {
      // Some desktop clipboard backends reject HTML even when text is allowed.
      try {
        await writeClipboardText(markdown);
        return;
      } catch {
        // Fall through to the browser/webview's copy event.
      }
    }
  }
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([`<a href="${escapedHref}">${escapedTitle}</a>`], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" })
      })]);
      return;
    } catch {
      // Permission, focus or unsupported MIME type: plain text is sufficient.
    }
  }
  if (await copyText(markdown)) return;
  throw new Error("Clipboard write failed.");
}
