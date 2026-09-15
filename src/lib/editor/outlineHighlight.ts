import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import { HEADING_NUMBER_ATTRIBUTE } from "@/lib/editor/headingNumbering";

// Marks the heading a details-panel outline jump landed on, so the reader can
// find it in the text before their eyes catch up with the scroll. Cleared the
// moment the editor gets real focus again (typing or clicking back in) — see
// updateOutlineHighlight's call sites — since by then the reader is looking
// at the caret, not hunting for the section.
//
// Rendered as ONE absolutely positioned box measured from the title's
// rendered text, not as an inline decoration on the text itself: an inline
// decoration is split by ProseMirror into one DOM span per mark run, and a
// title with inline code in it ("Planung (`agentPlanning`)") then shows a
// bracket, a step or a gap at the code chip — the chip renders at a smaller
// font-size, so its fragment can never line up with the ones around it. A
// single box laid over the union of the title's text rects has no such seams
// and can carry the same rounded corners and accent bar as the outline row
// in the details panel.
//
// The box is a widget decoration rather than a DOM node appended by hand:
// widget DOM is what ProseMirror's mutation observer knows to ignore, while
// a foreign child of view.dom would be read back into the document.
const outlineHighlightKey = new PluginKey<OutlineHighlightState>("outlineHighlight");

type OutlineHighlightState = {
  pos: number | null;
  decorations: DecorationSet;
};

const OVERLAY_CLASS = "outline-jump-highlight";
// Breathing room around the title, in px at the root font size (0.5rem/0.2rem).
const INFLATE_X_REM = 0.5;
const INFLATE_Y_REM = 0.2;

function rootFontSizePx(): number {
  const raw = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(raw) && raw > 0 ? raw : 16;
}

function isHeadingAt(doc: ProseMirrorNode, pos: number): boolean {
  const node = doc.nodeAt(pos);
  return Boolean(node && node.type.name === "heading" && node.content.size > 0);
}

/**
 * Positions the overlay over the title's rendered text. The rect is measured
 * as the union of the text's client rects, so a title that mixes plain text
 * with a code chip still gets one box of one height; a title that wraps onto
 * a second line gets the bounding box of both lines, which is a rarer and far
 * softer imperfection than a seam on every title with a mark in it.
 */
function placeOverlay(view: EditorView, overlay: HTMLElement, pos: number | null): void {
  if (pos === null || !isHeadingAt(view.state.doc, pos)) {
    overlay.hidden = true;
    return;
  }

  const heading = view.nodeDOM(pos);

  if (!(heading instanceof HTMLElement) || heading.childNodes.length === 0) {
    overlay.hidden = true;
    return;
  }

  const range = document.createRange();
  range.setStart(heading, 0);
  range.setEnd(heading, heading.childNodes.length);
  const text = range.getBoundingClientRect();

  if (text.width === 0 || text.height === 0) {
    overlay.hidden = true;
    return;
  }

  // The automatic number is a ::before (headingNumbering.ts), which no range
  // over the child nodes can measure — it starts at the heading's content
  // edge, so the box is stretched left to that edge and covers number and
  // title together, the way the outline row in the details panel does.
  let left = text.left;

  if (heading.hasAttribute(HEADING_NUMBER_ATTRIBUTE)) {
    const box = heading.getBoundingClientRect();
    const paddingLeft = Number.parseFloat(getComputedStyle(heading).paddingLeft) || 0;
    left = Math.min(left, box.left + heading.clientLeft + paddingLeft);
  }

  const width = text.right - left;

  // The widget sits inside view.dom, which is the overlay's containing block
  // (position: relative in editor-content.css), so viewport coordinates are
  // translated into that box, border excluded.
  const surface = view.dom.getBoundingClientRect();
  const rem = rootFontSizePx();
  const inflateX = INFLATE_X_REM * rem;
  const inflateY = INFLATE_Y_REM * rem;

  overlay.hidden = false;
  overlay.style.left = `${left - surface.left - view.dom.clientLeft - inflateX}px`;
  overlay.style.top = `${text.top - surface.top - view.dom.clientTop - inflateY}px`;
  overlay.style.width = `${width + inflateX * 2}px`;
  overlay.style.height = `${text.height + inflateY * 2}px`;
}

function buildDecorations(doc: ProseMirrorNode, pos: number | null, overlay: HTMLElement): DecorationSet {
  if (pos === null || !isHeadingAt(doc, pos)) {
    return DecorationSet.empty;
  }

  // Anchored just before the heading block so the widget lives next to the
  // title it marks and disappears with it; its own layout is absolute, so it
  // takes no space in the flow.
  return DecorationSet.create(doc, [
    Decoration.widget(pos, () => overlay, {
      key: OVERLAY_CLASS,
      side: -1,
      ignoreSelection: true
    })
  ]);
}

export const OutlineHighlight = Extension.create({
  name: "outlineHighlight",

  addProseMirrorPlugins() {
    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute("aria-hidden", "true");
    overlay.hidden = true;

    return [
      new Plugin<OutlineHighlightState>({
        key: outlineHighlightKey as PluginKey,
        state: {
          init: () => ({ pos: null, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(outlineHighlightKey) as { pos: number | null } | undefined;

            if (meta) {
              return { pos: meta.pos, decorations: buildDecorations(tr.doc, meta.pos, overlay) };
            }

            // An edit invalidates the highlighted position outright rather
            // than trying to map it — the reader can only have caused this by
            // typing, which already means the editor has focus and the
            // highlight is on its way out anyway.
            if (tr.docChanged && value.pos !== null) {
              return { pos: null, decorations: DecorationSet.empty };
            }

            return value;
          }
        },
        props: {
          decorations(state) {
            return outlineHighlightKey.getState(state)?.decorations ?? null;
          }
        },
        view(view) {
          // Layout that moves the title without a transaction: a resized
          // window or details panel, a zoom step, a font change.
          const observer = new ResizeObserver(() => {
            placeOverlay(view, overlay, outlineHighlightKey.getState(view.state)?.pos ?? null);
          });
          observer.observe(view.dom);

          return {
            update(updatedView) {
              placeOverlay(updatedView, overlay, outlineHighlightKey.getState(updatedView.state)?.pos ?? null);
            },
            destroy() {
              observer.disconnect();
              overlay.remove();
            }
          };
        }
      })
    ];
  }
});

export function updateOutlineHighlight(editor: Editor, pos: number | null): void {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(outlineHighlightKey, { pos }));
}
