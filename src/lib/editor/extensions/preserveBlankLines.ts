import { Extension } from "@tiptap/core";
import type MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";

/** Keep additional empty lines between Markdown paragraphs as empty editor paragraphs. */
export const PreserveBlankLines = Extension.create({
  name: "preserveBlankLines",

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.core.ruler.after("block", "scribecat_preserve_blank_lines", (state) => {
              const tokens = state.tokens;
              for (let index = 0; index < tokens.length - 1; index += 1) {
                const close = tokens[index];
                const nextOpen = tokens[index + 1];
                if (close.type !== "paragraph_close" || nextOpen.type !== "paragraph_open") continue;
                const previousInline = tokens[index - 1];
                const closeMap = previousInline?.type === "inline" ? previousInline.map : null;
                const openMap = nextOpen.map;
                if (!closeMap || !openMap) continue;
                const extraParagraphs = Math.max(0, openMap[0] - closeMap[1] - 1);
                if (extraParagraphs === 0) continue;
                if (previousInline?.type !== "inline") continue;
                const inserted: Token[] = [];
                for (let count = 0; count < extraParagraphs; count += 1) {
                  const emptyOpen = new Token("paragraph_open", "p", 1);
                  emptyOpen.block = true;
                  emptyOpen.level = nextOpen.level;
                  const emptyInline = new Token("inline", "", 0);
                  emptyInline.block = true;
                  emptyInline.level = nextOpen.level + 1;
                  emptyInline.content = "";
                  emptyInline.children = [];
                  const emptyClose = new Token("paragraph_close", "p", -1);
                  emptyClose.block = true;
                  emptyClose.level = nextOpen.level;
                  inserted.push(emptyOpen, emptyInline, emptyClose);
                }
                tokens.splice(index + 1, 0, ...inserted);
                index += inserted.length;
              }
            });
          }
        }
      }
    };
  }
});
