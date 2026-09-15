import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  computeHeadingNumbers,
  stripUnnumberedMarker,
  type HeadingNumberingSettings
} from "@/lib/editor/headingNumbers";

export type OutlineHeading = {
  /** Position of the heading node in the document, the anchor a jump lands on. */
  pos: number;
  level: number;
  /** Plain text of the heading, "" for an empty one. */
  title: string;
  /** Automatic number ("1.2.") once numberOutline ran; absent when it gets none. */
  number?: string;
};

export const OUTLINE_DEPTH_MIN = 1;
export const OUTLINE_DEPTH_MAX = 6;

// Read off the ProseMirror document rather than the markdown (lib/chat's
// outlineOf): the panel needs a position it can scroll the editor to, and a
// line number would have to be mapped back through tables, images and code
// blocks to become one.
export function collectHeadings(doc: ProseMirrorNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ pos, level: Number(node.attrs.level) || 1, title: node.textContent.trim() });
      return false;
    }

    // Headings are block-level; nothing worth descending into sits below one.
    return node.isBlock;
  });

  return headings;
}

export function hasHeading(doc: ProseMirrorNode): boolean {
  let found = false;

  doc.descendants((node) => {
    if (found) {
      return false;
    }

    if (node.type.name === "heading") {
      found = true;
      return false;
    }

    return node.isBlock;
  });

  return found;
}

/**
 * Attaches the automatic numbers and hides the `{-}` marker from the titles.
 * Runs on the complete list, before any depth filter: a number depends on
 * every heading above it, listed or not. A no-op while numbering is off.
 */
export function numberOutline(headings: OutlineHeading[], settings: HeadingNumberingSettings): OutlineHeading[] {
  if (!settings.enabled) {
    return headings;
  }

  const numbers = computeHeadingNumbers(headings, settings);

  return headings.map((heading, index) => {
    const number = numbers[index];
    const title = stripUnnumberedMarker(heading.title);
    return number === null ? { ...heading, title } : { ...heading, title, number };
  });
}

export function filterHeadingsByDepth(headings: OutlineHeading[], maxDepth: number): OutlineHeading[] {
  return maxDepth >= OUTLINE_DEPTH_MAX ? headings : headings.filter((heading) => heading.level <= maxDepth);
}

/**
 * Index of the section the cursor is in: the last heading at or before the
 * cursor. -1 when the cursor sits above the first heading (or there is none).
 */
export function activeHeadingIndex(headings: OutlineHeading[], cursorPos: number): number {
  let index = -1;

  for (let i = 0; i < headings.length; i += 1) {
    if (headings[i].pos <= cursorPos) {
      index = i;
    } else {
      break;
    }
  }

  return index;
}

/**
 * Index of the heading a reader is "in" while scrolling: the last heading
 * whose top edge sits at or above the viewport top. -1 when every heading is
 * still below it (or none has a measurable top). `tops` is one entry per
 * heading, null for one that has no DOM node right now.
 */
export function headingIndexAtViewportTop(tops: (number | null)[], viewportTop: number): number {
  let index = -1;

  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i];

    if (top === null) {
      continue;
    }

    if (top <= viewportTop) {
      index = i;
    } else {
      break;
    }
  }

  return index;
}

export function sameOutline(a: OutlineHeading[], b: OutlineHeading[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((heading, index) => {
    const other = b[index];
    return (
      heading.pos === other.pos &&
      heading.level === other.level &&
      heading.title === other.title &&
      heading.number === other.number
    );
  });
}

export function clampOutlineDepth(depth: number): number {
  if (!Number.isFinite(depth)) {
    return OUTLINE_DEPTH_MAX;
  }

  return Math.min(OUTLINE_DEPTH_MAX, Math.max(OUTLINE_DEPTH_MIN, Math.round(depth)));
}
