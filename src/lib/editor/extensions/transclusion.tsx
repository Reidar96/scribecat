import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";

import { EditorFileContext } from "@/lib/editorFileContext";
import { resolveFileLinkTarget } from "@/lib/editor/fileLinks";
import { readMarkdownFile } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

type MarkdownSerializerState = { write: (value: string) => void; closeBlock: (node: ProseMirrorNode) => void };

function TransclusionView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const { filePath } = useContext(EditorFileContext);
  const href = String(node.attrs.href ?? "");
  const filePaths = useAppStore((state) => state.filePaths);
  const targetPath = useMemo(
    () => filePath ? resolveFileLinkTarget(href, filePath, filePaths) : null,
    [filePath, filePaths, href]
  );
  const openContent = useAppStore((state) => targetPath ? state.fileDocuments[targetPath]?.content : undefined);
  const [diskContent, setDiskContent] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!targetPath || openContent !== undefined) {
      setDiskContent(null);
      return () => { active = false; };
    }
    void readMarkdownFile(targetPath).then((content) => {
      if (active) setDiskContent(content);
    }).catch(() => {
      if (active) setDiskContent(null);
    });
    return () => { active = false; };
  }, [openContent, targetPath]);

  const content = openContent ?? diskContent;
  return (
    <NodeViewWrapper as="section" className="markdown-transclusion" contentEditable={false}>
      {targetPath ? content === null ? (
        <p className="markdown-transclusion__loading">{t("editor.transclusionLoading")}</p>
      ) : (
        <pre className="markdown-transclusion__content">{content}</pre>
      ) : (
        <p className="markdown-transclusion__missing">{t("editor.transclusionMissing")}</p>
      )}
    </NodeViewWrapper>
  );
}

function transclusionMarkdownPlugin(markdownit: MarkdownIt) {
  markdownit.core.ruler.after("inline", "scribecat_transclusion", (state) => {
    const tokens = state.tokens;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      const open = tokens[index];
      const inline = tokens[index + 1];
      const close = tokens[index + 2];
      if (open.type !== "paragraph_open" || inline.type !== "inline" || close.type !== "paragraph_close") continue;
      const match = /^\s*!\[\[([^\]]+)\]\]\s*$/.exec(inline.content);
      if (!match) continue;
      open.tag = "div";
      open.attrSet("data-transclusion", match[1]);
      close.tag = "div";
      tokens.splice(index + 1, 1);
      index += 1;
    }
  });
}

export const Transclusion = Node.create({
  name: "transclusion",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes() {
    return { href: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-transclusion") ?? "", renderHTML: (attributes: { href?: string }) => ({ "data-transclusion": attributes.href ?? "" }) } };
  },
  parseHTML() { return [{ tag: "div[data-transclusion]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "markdown-transclusion" })]; },
  addNodeView() { return ReactNodeViewRenderer(TransclusionView); },
  addStorage() {
    return { markdown: {
      serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
        state.write(`![[${String(node.attrs.href ?? "")}]]`);
        state.closeBlock(node);
      },
      parse: { setup(markdownit: MarkdownIt) { markdownit.use(transclusionMarkdownPlugin); } }
    } };
  }
});
