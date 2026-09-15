import type { Editor as TipTapEditor } from "@tiptap/react";

import { getSelectionMarkdown } from "@/lib/editor/markdownStorage";

/**
 * Copies whatever a one-shot `copy` listener puts into the event. This is the
 * synchronous route through the browser's own clipboard pipeline: it needs no
 * permission and no secure context, which is what makes it the fallback for
 * `navigator.clipboard` (absent in the web edition served over plain http).
 * Capture phase on the document so the listener runs before ProseMirror's own
 * copy handler on the editor DOM, which is then skipped for this one event.
 */
function copyViaCommand(fill: (data: DataTransfer) => void): boolean {
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    fill(event.clipboardData);
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

async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or unavailable in this webview, so try the event route.
    }
  }

  return copyViaCommand((data) => data.setData("text/plain", text));
}

function selectionRange(editor: TipTapEditor): { from: number; to: number } | null {
  const { from, to, empty } = editor.state.selection;

  return empty ? null : { from, to };
}

/** The selection as markdown source (`**bold**`, `- item`, …). */
export async function copySelectionAsMarkdown(editor: TipTapEditor): Promise<boolean> {
  const range = selectionRange(editor);

  if (!range) {
    return false;
  }

  const markdown =
    getSelectionMarkdown(editor, range.from, range.to) ||
    editor.state.doc.textBetween(range.from, range.to, "\n");

  return writeClipboardText(markdown);
}

/** The selection as bare text, without formatting or markdown syntax. */
export async function copySelectionAsPlainText(editor: TipTapEditor): Promise<boolean> {
  const range = selectionRange(editor);

  if (!range) {
    return false;
  }

  return writeClipboardText(editor.state.doc.textBetween(range.from, range.to, "\n"));
}

/**
 * The same clipboard content Ctrl+C produces (HTML plus plain text, written
 * by ProseMirror's copy handler). A menu click is not a keystroke, so the
 * copy has to be triggered on the focused editor instead of re-serializing the
 * selection by hand: a second serializer would drift from what Ctrl+C gives.
 */
export function copySelectionFormatted(editor: TipTapEditor): boolean {
  if (!selectionRange(editor)) {
    return false;
  }

  editor.view.focus();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}
