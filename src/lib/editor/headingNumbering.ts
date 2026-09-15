import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { collectHeadings } from "@/lib/editor/documentOutline";
import {
  computeHeadingNumbers,
  findUnnumberedMarker,
  type HeadingNumberingSettings
} from "@/lib/editor/headingNumbers";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

// Shows the automatic "1.2." in front of every numbered heading. Decorations,
// not document content: the number is a `data-heading-number` attribute on
// the heading's DOM node, painted by a CSS ::before (editor-content.css), so
// nothing about it ever reaches the markdown, the undo history or the
// clipboard. The `{-}` marker that opts a heading out stays in the text (it
// is the user's markdown) and is only dimmed, so the reader can see it was
// understood as a marker rather than as part of the title.
const headingNumberingKey = new PluginKey<DecorationSet>("headingNumbering");

/** DOM attribute carrying the number; the outline jump highlight reads it too. */
export const HEADING_NUMBER_ATTRIBUTE = "data-heading-number";
const NUMBER_ATTRIBUTE = HEADING_NUMBER_ATTRIBUTE;
const MARKER_CLASS = "heading-unnumbered-marker";

function buildDecorations(doc: ProseMirrorNode, settings: HeadingNumberingSettings): DecorationSet {
  if (!settings.enabled) {
    return DecorationSet.empty;
  }

  const headings = collectHeadings(doc);
  const numbers = computeHeadingNumbers(headings, settings);
  const decorations: Decoration[] = [];

  headings.forEach((heading, index) => {
    const node = doc.nodeAt(heading.pos);

    if (!node) {
      return;
    }

    const number = numbers[index];

    if (number !== null) {
      decorations.push(
        Decoration.node(heading.pos, heading.pos + node.nodeSize, { [NUMBER_ATTRIBUTE]: number })
      );
    }

    // The marker is dimmed only when it sits inside the heading's last text
    // node in one piece; split across marks (`{-` + `}`) or after an inline
    // node, it still counts (the title text is what decides) but stays as is.
    const last = node.lastChild;

    if (!last?.isText || !last.text) {
      return;
    }

    const markerStart = findUnnumberedMarker(last.text);

    if (markerStart === -1) {
      return;
    }

    const lastStart = heading.pos + 1 + node.content.size - last.nodeSize;
    decorations.push(
      Decoration.inline(lastStart + markerStart, lastStart + last.text.length, { class: MARKER_CLASS })
    );
  });

  return DecorationSet.create(doc, decorations);
}

export const HeadingNumbering = Extension.create({
  name: "headingNumbering",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: headingNumberingKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, useEditorSettingsStore.getState().headingNumbering),
          apply(tr, value) {
            // Recomputed from scratch on every edit rather than mapped: a
            // typed character can move every number below it, and a document
            // has few headings next to the characters in it.
            if (tr.docChanged || tr.getMeta(headingNumberingKey)) {
              return buildDecorations(tr.doc, useEditorSettingsStore.getState().headingNumbering);
            }

            return value;
          }
        },
        props: {
          decorations(state) {
            return headingNumberingKey.getState(state) ?? null;
          }
        },
        view(view) {
          // A settings change has no transaction of its own, so the store
          // subscription dispatches an empty one that asks for a rebuild.
          const unsubscribe = useEditorSettingsStore.subscribe((state, previous) => {
            if (state.headingNumbering !== previous.headingNumbering && !view.isDestroyed) {
              view.dispatch(view.state.tr.setMeta(headingNumberingKey, true));
            }
          });

          return { destroy: unsubscribe };
        }
      })
    ];
  }
});
