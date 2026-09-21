import type { Editor as TipTapEditor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// tiptap-markdown has no error path for a node it can't express in Markdown:
// with html mode off its HTMLNode serializer writes the literal placeholder
// "[<node name>]" and carries on, and the editor keeps showing the node, so
// the loss is only visible after the note is reopened. That is how a whole
// table disappeared in issue #56. The table serializer no longer takes that
// path, but any node can in principle (a new extension without a markdown
// spec, a library upgrade), so serialization is watched: the editor pauses
// saving instead of writing a placeholder.
//
// Detection asks the serializer what it did, not what the text looks like.
// Searching the output for "[name]" cannot tell the placeholder apart from
// the same characters arriving legitimately: an image title is written
// without escaping brackets and never appears in doc.textContent, so
// `![a](a.png "[image]")` — ordinary Markdown a user can paste — read as a
// lost image node and blocked saving on a document that was perfectly fine.
// The wrapper below instead records the node names whose serializer actually
// took the placeholder branch, which no amount of document content can fake.

type MarkdownSerializerState = {
  out: string;
};

type NodeSerializer = (
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  ...rest: unknown[]
) => unknown;

type MarkdownSerializer = {
  nodes: Record<string, NodeSerializer>;
  serialize: (content: unknown) => string;
};

export type GuardedSerialization = {
  /** The document as markdown. */
  markdown: string;
  /** Node names the serializer could not write; empty when all is well. */
  lost: string[];
};

type MarkdownStorage = {
  markdown?: {
    serializer?: MarkdownSerializer;
  };
};

// The names recorded for the serializer runs of one editor. Keyed by the
// serializer object so two editors (the document and the AI preview) can't
// read each other's results.
const recorded = new WeakMap<MarkdownSerializer, Set<string>>();

// The placeholder the HTMLNode fallback writes for `name`, exactly as
// tiptap-markdown spells it.
function placeholderOf(name: string): string {
  return `[${name}]`;
}

// Wraps every node serializer so a run that emitted the node's own
// placeholder is recorded under that node's name.
//
// `nodes` is a getter that rebuilds the map on every access, so the wrapper
// is installed as an own property in front of it and re-wraps what the
// original getter returns. A serializer whose output for node X is exactly
// the placeholder for X is the fallback: a real serializer writes the node's
// content, and the one node that could write "[image]" from its own data (an
// image with that title) writes the surrounding "![alt](src ...)" too.
function watch(serializer: MarkdownSerializer): Set<string> {
  const existing = recorded.get(serializer);

  if (existing) {
    return existing;
  }

  const seen = new Set<string>();
  const prototype = Object.getPrototypeOf(serializer) as object;
  const original = Object.getOwnPropertyDescriptor(prototype, "nodes")?.get;

  if (!original) {
    // A tiptap-markdown that no longer builds `nodes` from a getter: leave
    // the serializer alone rather than guess at its shape. The guard then
    // reports nothing, which is the same position as before it existed.
    recorded.set(serializer, seen);
    return seen;
  }

  Object.defineProperty(serializer, "nodes", {
    configurable: true,
    get(this: MarkdownSerializer) {
      const nodes = original.call(this) as Record<string, NodeSerializer>;

      return Object.fromEntries(
        Object.entries(nodes).map(([name, serialize]) => [
          name,
          function (this: unknown, state: MarkdownSerializerState, ...rest: unknown[]) {
            const start = state.out.length;
            const result = (serialize as NodeSerializer).call(
              this,
              state,
              ...(rest as [ProseMirrorNode, ...unknown[]])
            );

            if (state.out.slice(start).trim() === placeholderOf(name)) {
              seen.add(name);
            }

            return result;
          }
        ])
      );
    }
  });

  recorded.set(serializer, seen);
  return seen;
}

/**
 * Serializes the whole document and reports both the markdown and the node
 * names whose serializer fell back to a placeholder while writing it.
 *
 * Serializing and checking belong together: the record is only meaningful
 * for the run that produced the text, so the caller cannot hold one without
 * the other or read a stale result.
 */
export function serializeGuarded(editor: TipTapEditor, fallback: string): GuardedSerialization {
  const serializer = (editor.storage as MarkdownStorage).markdown?.serializer;

  if (!serializer) {
    return { markdown: fallback, lost: [] };
  }

  const seen = watch(serializer);

  seen.clear();

  const markdown = serializer.serialize(editor.state.doc);

  return { markdown, lost: [...seen] };
}
