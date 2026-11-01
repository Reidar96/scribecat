export type ReceiptReference = { path: string; name: string };

const safePath = /^_attachments\/[^/\\?#\r\n]+$/;
const safeName = (name: string) => !!name && name.length <= 120 && !/[\[\]\\/\r\n\x00-\x1f]/.test(name);

/** Human-readable Markdown links; older plain paths remain readable. */
export function parseReceiptReferences(section: string, legacy = ""): ReceiptReference[] {
  const rows = new Map<string, ReceiptReference>();
  for (const line of section.split(/\r?\n/)) {
    const link = /^- \[([^\]]+)\]\((_attachments\/[^)]+)\)$/.exec(line);
    const plain = /^- (_attachments\/[^\r\n]+)$/.exec(line);
    const path = link?.[2] ?? plain?.[1];
    if (!path || !safePath.test(path)) continue;
    const name = link?.[1] ?? path.slice("_attachments/".length);
    if (safeName(name)) rows.set(path, { path, name });
  }
  if (safePath.test(legacy) && !rows.has(legacy)) rows.set(legacy, { path: legacy, name: legacy.slice("_attachments/".length) });
  return [...rows.values()];
}

export function receiptDisplayName(value: string, path: string): string | null {
  const extension = /\.[a-z0-9]{1,5}$/i.exec(path)?.[0] ?? "";
  const base = value.trim();
  const name = base.toLowerCase().endsWith(extension.toLowerCase()) ? base : `${base}${extension}`;
  return safeName(name) ? name : null;
}

export function receiptReferencesMarkdown(rows: readonly ReceiptReference[]): string {
  return rows.map(({ path, name }) => name === path.slice("_attachments/".length) ? `- ${path}` : `- [${name}](${path})`).join("\n");
}
