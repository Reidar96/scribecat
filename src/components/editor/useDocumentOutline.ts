import { useEffect, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";

import {
  activeHeadingIndex,
  collectHeadings,
  filterHeadingsByDepth,
  headingIndexAtViewportTop,
  numberOutline,
  sameOutline,
  type OutlineHeading
} from "@/lib/editor/documentOutline";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

export type DocumentOutline = {
  headings: OutlineHeading[];
  /** Index into `headings` of the section the reader is in, -1 above the first. */
  activeIndex: number;
};

// A jump scrolls the heading to the top edge minus its scroll-margin, so the
// reader's viewport top has to count a little below the edge for that heading
// to read as the current one.
const VIEWPORT_TOP_OFFSET_PX = 32;

/**
 * The open document's headings and the one the reader is in, kept current from
 * the editor's own events: the cursor decides after an edit or a click into
 * the text, the scroll position while the document is scrolled. Subscribed
 * here rather than lifted into <Editor>'s state so a cursor move or a scroll
 * frame re-renders the panel, not the whole editor tree; each state only
 * changes when its value does.
 */
export function useDocumentOutline(editor: TipTapEditor | null): DocumentOutline {
  const maxDepth = useEditorSettingsStore((state) => state.outlineMaxDepth);
  const numbering = useEditorSettingsStore((state) => state.headingNumbering);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!editor) {
      setHeadings([]);
      setActiveIndex(-1);
      return;
    }

    let current: OutlineHeading[] = [];
    let frame = 0;
    // Mirrors the last activeIndex outside React state, so refreshFromScroll
    // can compare against it synchronously without a stale closure over the
    // state value. Sourced from either path — the cursor (a click into the
    // text, an outline jump) or a previous scroll frame.
    let lastActiveIndex = -1;

    const setActive = (index: number) => {
      lastActiveIndex = index;
      setActiveIndex(index);
    };

    const refreshFromCursor = () => {
      setActive(activeHeadingIndex(current, editor.state.selection.from));
    };

    const refreshHeadings = () => {
      const next = filterHeadingsByDepth(
        numberOutline(collectHeadings(editor.state.doc), numbering),
        maxDepth
      );

      if (!sameOutline(current, next)) {
        current = next;
        setHeadings(next);
      }

      refreshFromCursor();
    };

    // The scroll container is not known when the panel mounts (the view may
    // not be attached yet), so scrolls are caught at the document and
    // filtered down to the one that carries the editor. Resolved lazily and
    // cached: not `target.contains(editor.view.dom)`, which also matches any
    // outer wrapper that merely happens to contain the editor without being
    // the one that scrolls it — the sidebar's own `item.scrollIntoView`
    // (DetailsOutlineSection) can nudge such a wrapper by a couple of px,
    // and a wrapper that small reads as "scrolled to the very bottom" on
    // every jump, forcing the outline onto the last heading regardless of
    // which one was actually clicked.
    let scrollContainer: HTMLElement | null = null;

    const resolveScrollContainer = (): HTMLElement | null => {
      if (scrollContainer?.isConnected) {
        return scrollContainer;
      }

      if (!(editor.view.dom instanceof HTMLElement)) {
        return null;
      }

      let node = editor.view.dom.parentElement;

      while (node) {
        const overflowY = getComputedStyle(node).overflowY;

        if (overflowY === "auto" || overflowY === "scroll") {
          scrollContainer = node;
          return node;
        }

        node = node.parentElement;
      }

      return null;
    };

    // One layout read per heading per frame is cheap next to the scroll itself.
    const refreshFromScroll = (container: HTMLElement) => {
      if (frame) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = 0;

        if (editor.isDestroyed) {
          return;
        }

        const viewportTop = container.getBoundingClientRect().top + VIEWPORT_TOP_OFFSET_PX;
        const tops = current.map((heading) => {
          const element = editor.view.nodeDOM(heading.pos);
          return element instanceof HTMLElement ? element.getBoundingClientRect().top : null;
        });

        let index = headingIndexAtViewportTop(tops, viewportTop);

        // At the very bottom of the scroll range there's nothing left to
        // scroll further up with, so a heading's own scroll-margin plus a
        // short tail of content after it can leave its measured top well
        // past the threshold above even though it's the one an explicit jump
        // (or the reader's own scrolling) just settled on — the browser
        // clamped the scroll before it could get any closer. Geometry alone
        // can't recover that heading's identity once it's clamped, so this
        // falls back to whichever heading was last established as active
        // (by the cursor, most recently, or an earlier scroll frame) rather
        // than silently regressing to whatever the loop above sees instead —
        // but only while that heading is still on screen at all, and only
        // once nothing more can be scrolled into view: an ordinary scroll
        // still has to move activeIndex both ways as the reader scrolls.
        const viewportBottom = container.getBoundingClientRect().bottom;
        const atScrollLimit = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

        if (index < lastActiveIndex && lastActiveIndex < current.length && atScrollLimit) {
          const element = editor.view.nodeDOM(current[lastActiveIndex].pos);
          const lastActiveTop = element instanceof HTMLElement ? element.getBoundingClientRect().top : null;

          if (lastActiveTop !== null && lastActiveTop <= viewportBottom) {
            index = lastActiveIndex;
          }
        }

        setActive(index);
      });
    };

    const handleScroll = (event: Event) => {
      if (editor.isDestroyed) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement && target === resolveScrollContainer()) {
        refreshFromScroll(target);
      }
    };

    refreshHeadings();
    editor.on("update", refreshHeadings);
    editor.on("selectionUpdate", refreshFromCursor);
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      editor.off("update", refreshHeadings);
      editor.off("selectionUpdate", refreshFromCursor);
      document.removeEventListener("scroll", handleScroll, { capture: true });

      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [editor, maxDepth, numbering]);

  return { headings, activeIndex };
}
