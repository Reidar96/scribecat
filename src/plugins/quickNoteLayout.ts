/** A stable assignment: resizing one card does not rebalance the other column. */
export function noteColumns<T>(items: readonly T[], count: number): T[][] {
  const columns = Array.from({ length: Math.max(1, count) }, () => [] as T[]);
  items.forEach((item, index) => columns[index % columns.length].push(item));
  return columns;
}

export function insertNote(paths: readonly string[], source: string, target: string, edge: "before" | "after"): string[] {
  if (source === target || !paths.includes(source) || !paths.includes(target)) return [...paths];
  const ordered = paths.filter((path) => path !== source);
  ordered.splice(ordered.indexOf(target) + (edge === "after" ? 1 : 0), 0, source);
  return ordered;
}

/** A note's edit time and body never participate in its display position. */
export function noteCreatedAt(metadata: Record<string, string>): number {
  return Date.parse(metadata.created ?? "") || 0;
}

export function noteManualPosition(metadata: Record<string, string>): number {
  const explicit = Number(metadata.order);
  return metadata.order && Number.isFinite(explicit) ? explicit : -noteCreatedAt(metadata);
}
