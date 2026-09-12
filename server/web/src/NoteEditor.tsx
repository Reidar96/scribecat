import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";

type MarkdownStorage = {
  markdown?: { getMarkdown?: () => string };
};

/** The document serialized back to markdown, mirroring the desktop's helper. */
export function getEditorMarkdown(editor: Editor): string {
  return (editor.storage as MarkdownStorage).markdown?.getMarkdown?.() ?? "";
}

type NoteEditorProps = {
  /** Identity of the open note; a change replaces the document. */
  noteKey: string;
  markdown: string;
  onChange: (markdown: string) => void;
  onSaveShortcut: () => void;
};

export function NoteEditor({ noteKey, markdown, onChange, onSaveShortcut }: NoteEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSaveShortcut);
  onSaveRef.current = onSaveShortcut;

  const editor = useEditor({
    extensions: [
      // The same markdown options as the desktop editor (html off, soft
      // breaks on), so a note round-trips through both the same way.
      StarterKit.configure({
        link: { autolink: false, linkOnPaste: false, openOnClick: false }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, breaks: true })
    ],
    content: markdown,
    autofocus: "start",
    editorProps: {
      attributes: { class: "note-editor", "data-testid": "editor" },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSaveRef.current();
          return true;
        }

        return false;
      }
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current(getEditorMarkdown(current));
    }
  });

  // Switching notes replaces the document rather than remounting the editor.
  // The first note arrived through the `content` option above, so the effect
  // only ever acts on a *change* of note; running it on mount too would
  // reset the caret a moment after the user's first click.
  const loadedKeyRef = useRef<string>(noteKey);

  useEffect(() => {
    if (!editor || loadedKeyRef.current === noteKey) {
      return;
    }

    loadedKeyRef.current = noteKey;
    editor.commands.setContent(markdown, { emitUpdate: false });
    editor.commands.focus("start");
  }, [editor, noteKey, markdown]);

  return <EditorContent editor={editor} className="note-editor-host" />;
}
