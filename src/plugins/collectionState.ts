/** Preserve visible cards while an updated Markdown file is being read. */
export function retainCollectionEntries<T extends { path: string }>(
  paths: string[], previous: T[], fresh: T[]
): T[] {
  const available = new Map(previous.map((entry) => [entry.path, entry]));
  for (const entry of fresh) available.set(entry.path, entry);
  return paths.flatMap((path) => available.has(path) ? [available.get(path)!] : []);
}

export function updateQuickNoteBody(markdown: string, text: string): string {
  const end = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown)?.[0].length ?? 0;
  return `${markdown.slice(0, end)}\n${text}\n`;
}

export function quickNoteBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/^#\s+[^\n]*\r?\n/, "").replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}
