import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type MarkdownIt from "markdown-it";

import { ImageView } from "@/components/ImageView";

// Images are referenced in markdown relative to the file (e.g. "images/foto.png"
// or "../images/foto.png"), but the browser can't load that path directly — the
// NodeView resolves it at runtime via the filesystem into a blob URL, without
// changing the stored markdown path.
// CommonMark has no image-width syntax. To keep a width changed via drag across
// save/reload, it's encoded in the title part of the standard image syntax
// (e.g. `![alt](src "width=300")`). The "title" attribute isn't used anywhere
// else in the app, so this trick is lossless and stays valid CommonMark.
const IMAGE_WIDTH_TITLE_PATTERN = /^width=(\d+)$/;

type MarkdownSerializerState = {
  esc: (str: string) => string;
  write: (content: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

// TipTap's default attribute parser (fromString in @tiptap/core) turns a value
// that looks like a number into a Number and "true"/"false" into booleans. A
// photo from a phone camera is called "1000078813.jpg", so its alt text (the
// file name without extension) came back from the DOM as a Number and
// state.esc(alt) below crashed the whole serializer, and with it every save
// and reload of that note. Parsing these attributes as the raw strings they
// are keeps the markdown round-trip lossless for such names.
const rawStringAttribute = (name: string) => ({
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute(name)
});

const attributeAsString = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);


function isLocalPdfHref(href: string): boolean {
  if (
    !href ||
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith("//") ||
    href.startsWith("#")
  ) {
    return false;
  }

  const [path] = href.split(/[?#]/);
  return /\.pdf$/i.test(path);
}

/**
 * 0.24.5 stored the combined PDF choice as a normal Markdown link. Rendering
 * that link through the browser made server vaults try GET /_attachments/*.pdf
 * and showed a 404 instead of ScribeCat's PDF reader.
 *
 * Treat local PDF links as media nodes while parsing. Existing 0.24.5 notes
 * therefore immediately gain the inline PDF window, and the next serialization
 * writes the portable image-style Markdown form used by new 0.24.6 inserts.
 */
export function pdfLinkAsMediaMarkdownItPlugin(markdownit: MarkdownIt): void {
  markdownit.core.ruler.push("scribecat_pdf_link_as_media", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }

      const children = token.children;

      for (let index = 0; index < children.length; index += 1) {
        const open = children[index];

        if (open.type !== "link_open") {
          continue;
        }

        const href = open.attrGet("href") ?? "";

        if (!isLocalPdfHref(href)) {
          continue;
        }

        let closeIndex = index + 1;

        while (
          closeIndex < children.length &&
          children[closeIndex].type !== "link_close"
        ) {
          closeIndex += 1;
        }

        if (closeIndex >= children.length) {
          continue;
        }

        const labelChildren = children.slice(index + 1, closeIndex);
        const label = labelChildren.map((child) => child.content).join("");

        // Reuse the link_open token object instead of constructing a private
        // markdown-it Token class. The image renderer only needs the standard
        // image fields below.
        open.type = "image";
        open.tag = "img";
        open.nesting = 0;
        open.attrs = [
          ["src", href],
          ["alt", label]
        ];
        open.children = labelChildren;
        open.content = label;
        open.markup = "";

        children.splice(index, closeIndex - index + 1, open);
      }
    }
  });
}

// With `breaks: true` every newline inside a paragraph becomes a <br>, so
// "![a](a.png)" + newline + "![b](b.png)" arrives as one paragraph holding
// image, softbreak, image. The image node is a block node, so ProseMirror
// splits that paragraph around each image when it parses the HTML — and the softbreak that sat
// between two images is left over as a paragraph containing nothing but a hard
// break. That is the empty line users see between images they never typed.
// A line break directly before or after a block-level image has no visible
// effect anyway (the image already starts its own block), so it is dropped
// here, at the point where the information about its neighbours still exists.
export function imageLineBreakMarkdownItPlugin(markdownit: MarkdownIt): void {
  markdownit.core.ruler.push("scribecat_image_line_break", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }

      token.children = token.children.filter((child, index, children) => {
        if (child.type !== "softbreak" && child.type !== "hardbreak") {
          return true;
        }

        return children[index - 1]?.type !== "image" && children[index + 1]?.type !== "image";
      });
    }
  });
}

export const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: rawStringAttribute("src"),
      alt: rawStringAttribute("alt"),
      width: {
        default: null,
        parseHTML: (element) => {
          const attrWidth = element.getAttribute("width");

          if (attrWidth) {
            return Number.parseInt(attrWidth, 10);
          }

          const match = element.getAttribute("title")?.match(IMAGE_WIDTH_TITLE_PATTERN);
          return match ? Number.parseInt(match[1], 10) : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {})
      },
      title: {
        ...(this.parent?.() as { title?: object } | undefined)?.title,
        parseHTML: (element) => {
          const title = element.getAttribute("title");
          return title && IMAGE_WIDTH_TITLE_PATTERN.test(title) ? null : title;
        }
      }
    };
  },
  addNodeView() {
    // trackNodeViewPosition keeps the NodeView's cached position in sync when
    // the document shifts around it. Without it the cache is only refreshed
    // when the node view itself updates, so typing in a paragraph *above* an
    // image left every image below it holding the position it had before the
    // edit. Selection is decided against that cached value, so a click on such
    // an image no longer marked it selected: no outline, no resize handles,
    // and Backspace hit the wrong place. It also feeds the getPos() that
    // ImageView's own touch handler builds its NodeSelection from.
    return ReactNodeViewRenderer(ImageView, { trackNodeViewPosition: true });
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const alt = attributeAsString(node.attrs.alt);
          const src = attributeAsString(node.attrs.src);
          const width = node.attrs.width as number | null;
          const title = width ? `width=${width}` : attributeAsString(node.attrs.title);

          state.write(
            `![${state.esc(alt)}](${src.replace(/[()]/g, "\\$&")}${
              title ? ` "${title.replace(/"/g, '\\"')}"` : ""
            })`
          );
          // Without this, the serializer never marks the block as closed, so
          // a following block (e.g. a heading) gets written directly onto
          // the same line with no separating newline — see closeBlock/
          // flushClose in prosemirror-markdown's to_markdown.ts.
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            // Convert legacy/local PDF links before the line-break cleanup so
            // the latter sees them as the block-level media nodes they become.
            markdownit.use(pdfLinkAsMediaMarkdownItPlugin);
            markdownit.use(imageLineBreakMarkdownItPlugin);
          }
        }
      }
    };
  }
});
