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

    const refreshFromCursor = () => {
      setActiveIndex(activeHeadingIndex(current, editor.state.selection.from));
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
    // filtered down to the one that carries the editor. One layout read per
    // heading per frame is cheap next to the scroll itself.
    const refreshFromScroll = (container: HTMLElement) => {
      if (frame) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = 0;

        if (editor.isDestroyed) {
          return;
        }

        // Scrolled to (or within a heading-detection-width of) the very end,
        // the last heading can never clear the viewport-top threshold below —
        // its own scroll-margin-top (editor-content.css) plus DPI/zoom
        // rounding can leave it a few px short of the exact max, so a 1px
        // tolerance here missed it and left the outline showing the section
        // above as active even though a jump had already landed on the last
        // one. The reader is in the last section either way.
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - VIEWPORT_TOP_OFFSET_PX) {
          setActiveIndex(current.length - 1);
          return;
        }

        const viewportTop = container.getBoundingClientRect().top + VIEWPORT_TOP_OFFSET_PX;
        const tops = current.map((heading) => {
          const element = editor.view.nodeDOM(heading.pos);
          return element instanceof HTMLElement ? element.getBoundingClientRect().top : null;
        });

        setActiveIndex(headingIndexAtViewportTop(tops, viewportTop));
      });
    };

    const handleScroll = (event: Event) => {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        !editor.isDestroyed &&
        editor.view.dom instanceof HTMLElement &&
        target !== editor.view.dom &&
        target.contains(editor.view.dom)
      ) {
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
