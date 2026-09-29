import { Node, mergeAttributes } from "@tiptap/core";
import { EditorContent, ReactNodeViewRenderer, NodeViewWrapper, useEditor, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";

import { EditorFileContext } from "@/lib/editorFileContext";
import { splitFrontmatter, replaceBody } from "@/lib/documentFrontmatter";
import { resolveFileLinkTarget } from "@/lib/editor/fileLinks";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { serializeGuarded } from "@/lib/editor/serializationGuard";
import { useAppStore } from "@/store/useAppStore";
import { TableCellContextMenu } from "@/components/TableCellContextMenu";

type MarkdownSerializerState = { write: (value: string) => void; closeBlock: (node: ProseMirrorNode) => void };

// Break circular embeds before they can mount editors indefinitely.
const EmbeddedPathContext = createContext<readonly string[]>([]);

function EmbeddedContent({ targetPath, content, editable }: { targetPath: string; content: string; editable: boolean }) {
  const parentContext = useContext(EditorFileContext);
  const ancestors = useContext(EmbeddedPathContext);
  const lastLocalBody = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const body = splitFrontmatter(content).body;
  const nestedEditor = useEditor({
    extensions: buildEditorExtensions(),
    content: body,
    editable,
    onUpdate: ({ editor, transaction }) => {
      if (!transaction.docChanged) return;
      const result = serializeGuarded(editor, body);
      if (result.lost.length) return;
      const state = useAppStore.getState();
      const current = state.fileDocuments[targetPath]?.content;
      if (current === undefined) return;
      const nextContent = replaceBody(current, result.markdown);
      if (nextContent === current) return;
      lastLocalBody.current = result.markdown;
      state.updateFileContent(targetPath, nextContent);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void useAppStore.getState().saveFilePath(targetPath, { trigger: "auto" });
      }, 900);
    }
  }, [targetPath]);

  useEffect(() => {
    if (!nestedEditor || nestedEditor.isDestroyed || body === lastLocalBody.current) return;
    nestedEditor.commands.setContent(body, { emitUpdate: false });
  }, [body, nestedEditor]);

  useEffect(() => {
    nestedEditor?.setEditable(editable);
  }, [editable, nestedEditor]);

  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      void useAppStore.getState().saveFilePath(targetPath, { trigger: "auto" });
    }
  }, [targetPath]);

  if (!nestedEditor) return null;
  return (
    <EmbeddedPathContext.Provider value={[...ancestors, targetPath]}>
      <EditorFileContext.Provider value={{ ...parentContext, filePath: targetPath }}>
        <EditorContent editor={nestedEditor} className="markdown-transclusion__editor" />
        <TableCellContextMenu editor={nestedEditor} disabled={!editable} />
      </EditorFileContext.Provider>
    </EmbeddedPathContext.Provider>
  );
}

function TransclusionView({ node, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const { filePath } = useContext(EditorFileContext);
  const href = String(node.attrs.href ?? "");
  const filePaths = useAppStore((state) => state.filePaths);
  const targetPath = useMemo(
    () => filePath ? resolveFileLinkTarget(href, filePath, filePaths) : null,
    [filePath, filePaths, href]
  );
  const openContent = useAppStore((state) => targetPath ? state.fileDocuments[targetPath]?.content : undefined);
  const loadFileDocument = useAppStore((state) => state.loadFileDocument);
  const ancestors = useContext(EmbeddedPathContext);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    if (targetPath && openContent === undefined) {
      void loadFileDocument(targetPath).then((loaded) => {
        if (active) setLoadFailed(!loaded);
      }).catch(() => {
        if (active) setLoadFailed(true);
      });
    }
    return () => { active = false; };
  }, [loadFileDocument, openContent === undefined, targetPath]);

  const cycle = Boolean(targetPath && (targetPath === filePath || ancestors.includes(targetPath)));
  return (
    <NodeViewWrapper as="section" className="markdown-transclusion" contentEditable={false}>
      {targetPath && !cycle && openContent !== undefined ? (
        <EmbeddedContent key={targetPath} targetPath={targetPath} content={openContent} editable={editor.isEditable} />
      ) : targetPath && !cycle && !loadFailed ? (
        <p className="markdown-transclusion__loading">{t("editor.transclusionLoading")}</p>
      ) : cycle ? (
        <p className="markdown-transclusion__missing">{t("editor.transclusionCycle")}</p>
      ) : (
        <p className="markdown-transclusion__missing">{t("editor.transclusionMissing")}</p>
      )}
      {targetPath && !cycle && openContent !== undefined ? (
        <span className="markdown-transclusion__path" title={targetPath}>{href}</span>
      ) : null}
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
  addNodeView() {
    return ReactNodeViewRenderer(TransclusionView, {
      // The embedded document has its own ProseMirror view. Its selection,
      // paste and drag events belong to that view, never the host note.
      stopEvent: ({ event }) =>
        event.target instanceof Element && Boolean(event.target.closest(".markdown-transclusion__editor"))
    });
  },
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
