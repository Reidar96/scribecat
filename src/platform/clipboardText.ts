import { isTauri } from "@tauri-apps/api/core";

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
  const markdown = `[${title.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}](${href})`;
  if (isTauri()) {
    const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
    await clipboard.writeHtml(`<a href="${href}">${escapedTitle}</a>`, markdown);
    return;
  }
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([`<a href="${href}">${escapedTitle}</a>`], { type: "text/html" }),
      "text/plain": new Blob([markdown], { type: "text/plain" })
    })]);
    return;
  }
  await writeClipboardText(markdown);
}
