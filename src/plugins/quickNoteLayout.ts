/** A stable assignment: resizing one card does not rebalance the other column. */
export function noteColumns<T>(items: readonly T[], count: number, columnOf?: (item: T, index: number) => number): T[][] {
  const columns = Array.from({ length: Math.max(1, count) }, () => [] as T[]);
  items.forEach((item, index) => {
    const column = columnOf?.(item, index) ?? index;
    columns[((column % columns.length) + columns.length) % columns.length].push(item);
  });
  return columns;
}

/** Preserve assignments, but recover old collections that ended up entirely in one column. */
export function balancedNoteColumns<T>(items: readonly T[], count: number, columnOf: (item: T, index: number) => number, remember?: (item: T, column: number) => void): T[][] {
  if (count < 2 || items.length < 2) return noteColumns(items, count, columnOf);
  const assignments = items.map(columnOf);
  if (assignments.every((column) => column === assignments[0])) {
    items.forEach((item, index) => remember?.(item, index % count));
    return noteColumns(items, count);
  }
  return noteColumns(items, count, (_, index) => assignments[index]);
}

export function insertNote(paths: readonly string[], source: string, target: string, edge: "before" | "after"): string[] {
  if (source === target || !paths.includes(source) || !paths.includes(target)) return [...paths];
  const ordered = paths.filter((path) => path !== source);
  ordered.splice(ordered.indexOf(target) + (edge === "after" ? 1 : 0), 0, source);
  return ordered;
}

export function noteDropPlacement(cards: readonly { path: string; midpoint: number }[], y: number, source: string) {
  const candidates = cards.filter((card) => card.path !== source);
  const next = candidates.find((card) => y < card.midpoint);
  const target = next ?? candidates[candidates.length - 1];
  return target ? { path: target.path, edge: next ? "before" as const : "after" as const } : null;
}

/** Place a note within the chosen visual column, leaving the other one intact. */
export function moveNoteColumns(columns: readonly (readonly string[])[], source: string, target: string, edge: "before" | "after"): string[][] {
  const result = columns.map((column) => column.filter((path) => path !== source));
  const destination = result.findIndex((column) => column.includes(target));
  if (destination < 0 || !columns.some((column) => column.includes(source))) return columns.map((column) => [...column]);
  result[destination] = insertNote([...result[destination], source], source, target, edge);
  return result;
}

/** A note's edit time and body never participate in its display position. */
export function noteCreatedAt(metadata: Record<string, string>): number {
  return Date.parse(metadata.created ?? "") || 0;
}

export function noteManualPosition(metadata: Record<string, string>): number {
  const explicit = Number(metadata.order);
  return metadata.order && Number.isFinite(explicit) ? explicit : -noteCreatedAt(metadata);
}

/** New notes precede every existing manual or legacy (unnumbered) note. */
export function nextNoteTopOrder(items: readonly { metadata: Record<string, string> }[]): number {
  return items.reduce((lowest, item) => Math.min(lowest, noteManualPosition(item.metadata)), 0) - 1024;
}
