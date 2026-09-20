import BaseHighlight from "@tiptap/extension-highlight";
import type MarkdownIt from "markdown-it";
import markPlugin from "markdown-it-mark";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlighter: {
      /** Switch the marker tool on or off. */
      toggleHighlighterMode: () => ReturnType;
      /** Switch the marker tool off (no-op when it is already off). */
      exitHighlighterMode: () => ReturnType;
    };
  }
}

const highlighterKey = new PluginKey<boolean>("highlighter");

/** Whether the marker tool is currently switched on for this editor. */
export function isHighlighterModeActive(view: EditorView | { state: EditorView["state"] }): boolean {
  return highlighterKey.getState(view.state) === true;
}

/** DOM class on the editor element while the marker tool is on; the CSS turns the cursor into a marker. */
export const HIGHLIGHTER_MODE_CLASS = "editor--highlighter-mode";

// Highlighted text is written as "==text==" (markdown-it-mark's syntax, which
// Obsidian and friends read as well). Only one colour exists so far; the mark
// deliberately carries no colour attribute, which is what keeps the file free
// of inline HTML.
//
// Beyond the mark itself the extension owns the "marker tool": switched on
// from the toolbar (or Ctrl+Shift+H without a selection), every selection made
// with the mouse or a finger is highlighted the moment it is released — the
// selection already snaps along the text, which is what makes the tool feel
// like running a marker over a line. Dragging over text that is highlighted
// throughout removes the highlight instead, so the same tool erases. The mode
// is plugin state (not React state) so the toolbar re-renders with it through
// the ordinary transaction listener, and Escape or a second click ends it.
export const Highlight = BaseHighlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "==", close: "==", expelEnclosingWhitespace: true },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(markPlugin);
          }
        }
      }
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      toggleHighlighterMode:
        () =>
        ({ state, tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(highlighterKey, !isHighlighterModeActive({ state }));
          }

          return true;
        },
      exitHighlighterMode:
        () =>
        ({ state, tr, dispatch }) => {
          if (!isHighlighterModeActive({ state })) {
            return false;
          }

          if (dispatch) {
            tr.setMeta(highlighterKey, false);
          }

          return true;
        }
    };
  },

  addKeyboardShortcuts() {
    return {
      // Only claimed while the tool is on; otherwise Escape keeps whatever
      // meaning the other extensions give it.
      Escape: () => this.editor.commands.exitHighlighterMode()
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    // The selection as it was when the pointer went down. On touch the
    // browser moves the selection only *after* touchend, so a tap next to a
    // still-standing selection would otherwise read as a stroke over it and
    // erase what the toolbar button had just highlighted. Only a selection
    // that changed during the gesture counts as a stroke.
    let selectionAtPointerDown: { from: number; to: number } | null = null;

    const rememberSelection = (view: EditorView) => {
      const { from, to } = view.state.selection;
      selectionAtPointerDown = { from, to };
      return false;
    };

    const applyToSelection = (view: EditorView) => {
      if (!isHighlighterModeActive(view)) {
        return;
      }

      const before = selectionAtPointerDown;
      selectionAtPointerDown = null;

      // Deferred so the browser has finished settling the selection (a
      // mouseup right after a double-click still moves it) before we read it.
      window.setTimeout(() => {
        const { from, to, empty } = view.state.selection;
        const unchanged = before !== null && before.from === from && before.to === to;

        if (!isHighlighterModeActive(view) || empty || unchanged) {
          return;
        }

        const chain = editor.chain();
        (editor.isActive("highlight") ? chain.unsetHighlight() : chain.setHighlight())
          // Collapsing the selection is what makes the next stroke start clean
          // instead of extending the current one.
          .setTextSelection(to)
          .run();
      }, 0);
    };

    return [
      new Plugin<boolean>({
        key: highlighterKey,
        state: {
          init: () => false,
          apply(tr, current) {
            const next = tr.getMeta(highlighterKey) as boolean | undefined;
            return next ?? current;
          }
        },
        props: {
          attributes(state): Record<string, string> {
            return highlighterKey.getState(state) ? { class: HIGHLIGHTER_MODE_CLASS } : {};
          },
          handleDOMEvents: {
            mousedown: rememberSelection,
            touchstart: rememberSelection,
            mouseup(view) {
              applyToSelection(view);
              return false;
            },
            touchend(view) {
              applyToSelection(view);
              return false;
            }
          }
        }
      })
    ];
  }
});
