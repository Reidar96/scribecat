// Automatic heading numbering, computed from document structure and never
// written into the markdown. This module is the one place the rules live; the
// editor decorations, the details panel's outline and every export format
// call into it so all three agree on the same "1.2." for the same heading.

export type HeadingNumberingSettings = {
  enabled: boolean;
  /** First level that gets a number: 1, or 2 when H1 is the document title. */
  startLevel: 1 | 2;
  /** Deepest heading level that still gets a number, startLevel..6. */
  maxDepth: number;
  /**
   * Where the numbers show. "everywhere" paints them in the editor and
   * writes them into every export; "outline" keeps them to the details
   * panel, for navigating a long note whose text and PDF should stay clean.
   * The export follows the editor, never the outline, so what the writer
   * sees is what the reader gets.
   */
  scope: HeadingNumberingScope;
  /**
   * When the editor shows the `{-}` marker: always, or only in the heading
   * the cursor is in. The marker stays in the markdown either way.
   */
  marker: HeadingNumberingMarker;
};

export type HeadingNumberingScope = "everywhere" | "outline";
export type HeadingNumberingMarker = "always" | "activeLine";

export const HEADING_NUMBERING_DEPTH_MAX = 6;

export const DEFAULT_HEADING_NUMBERING: HeadingNumberingSettings = {
  enabled: false,
  startLevel: 2,
  maxDepth: HEADING_NUMBERING_DEPTH_MAX,
  scope: "everywhere",
  marker: "activeLine"
};

export function normalizeHeadingNumberingSettings(raw: unknown): HeadingNumberingSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const startLevel = source.startLevel === 1 ? 1 : 2;
  const depth = typeof source.maxDepth === "number" && Number.isFinite(source.maxDepth)
    ? Math.round(source.maxDepth)
    : HEADING_NUMBERING_DEPTH_MAX;

  return {
    enabled: source.enabled === true,
    startLevel,
    maxDepth: Math.min(HEADING_NUMBERING_DEPTH_MAX, Math.max(startLevel, depth)),
    scope: source.scope === "outline" ? "outline" : "everywhere",
    marker: source.marker === "always" ? "always" : "activeLine"
  };
}

// Pandoc's way of opting a heading out: a trailing attribute block that holds
// the bare `-` or the `.unnumbered` class, e.g. "# Preface {-}" or
// "# Preface {#pre .unnumbered}". Only that block is recognised (and hidden);
// any other attribute block stays visible text, as it did before.
const TRAILING_ATTRIBUTES = /\s*\{([^{}]*)\}\s*$/;

/**
 * Where the unnumbered marker sits in `text`, as a character offset of its
 * first char (the whitespace before it included), or -1 when there is none.
 */
export function findUnnumberedMarker(text: string): number {
  const match = TRAILING_ATTRIBUTES.exec(text);

  if (!match) {
    return -1;
  }

  const attributes = match[1].trim().split(/\s+/);
  return attributes.includes("-") || attributes.includes(".unnumbered") ? match.index : -1;
}

export function isUnnumberedHeading(text: string): boolean {
  return findUnnumberedMarker(text) !== -1;
}

/** The heading title with the unnumbered marker removed, trimmed. */
export function stripUnnumberedMarker(text: string): string {
  const index = findUnnumberedMarker(text);
  return (index === -1 ? text : text.slice(0, index)).trim();
}

export function formatHeadingNumber(counters: number[]): string {
  return `${counters.join(".")}.`;
}

/**
 * The number of every heading in document order, null for one that gets
 * none. Counters below a heading restart whenever it appears — including a
 * heading above the start level, so a second H1 chapter restarts its H2s at
 * 1 even when H1 itself is not numbered. A level skipped on the way down
 * reads as 0 ("1.0.1."), the same as Pandoc, so the gap in the structure
 * stays visible instead of being papered over. An unnumbered heading takes
 * its whole subtree with it: sections below "Appendix {-}" carry no number
 * until the next numbered heading at its level or above.
 */
export function computeHeadingNumbers(
  headings: readonly { level: number; title: string }[],
  settings: HeadingNumberingSettings
): (string | null)[] {
  if (!settings.enabled) {
    return headings.map(() => null);
  }

  const counters = new Array<number>(HEADING_NUMBERING_DEPTH_MAX + 1).fill(0);
  // Level of the nearest unnumbered ancestor still in effect, null when none.
  let unnumberedRoot: number | null = null;

  return headings.map((heading) => {
    const level = Math.min(HEADING_NUMBERING_DEPTH_MAX, Math.max(1, heading.level));

    for (let deeper = level + 1; deeper <= HEADING_NUMBERING_DEPTH_MAX; deeper += 1) {
      counters[deeper] = 0;
    }

    if (unnumberedRoot !== null && level <= unnumberedRoot) {
      unnumberedRoot = null;
    }

    if (level < settings.startLevel || level > settings.maxDepth) {
      return null;
    }

    if (isUnnumberedHeading(heading.title)) {
      unnumberedRoot = level;
      return null;
    }

    if (unnumberedRoot !== null) {
      return null;
    }

    counters[level] += 1;
    return formatHeadingNumber(counters.slice(settings.startLevel, level + 1));
  });
}
