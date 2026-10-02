/**
 * navigator.clipboard.read() can return HTML where the whole fragment has
 * been entity-escaped (for example &lt;p&gt;text&lt;/p&gt;). Passing that
 * directly to TipTap inserts the markup itself as visible text. Decode that
 * wrapper once so the editor can parse the original rich fragment.
 */
function containsTagMarkup(value: string): boolean {
  const start = value.indexOf("<");
  if (start < 0) return false;
  const nameStart = value[start + 1] === "/" ? start + 2 : start + 1;
  return /[a-z]/i.test(value[nameStart] ?? "");
}

export function normalizeClipboardHtml(html: string): string {
  if (!html.includes("&lt;") || containsTagMarkup(html)) {
    return html;
  }

  const decoder = document.createElement("textarea");
  decoder.innerHTML = html;
  const decoded = decoder.value;
  return containsTagMarkup(decoded) ? decoded : html;
}
