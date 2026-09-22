import { Link } from "@tiptap/extension-link";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { CodeBlockLinks } from "@/lib/editor/codeBlockLinks";
import { HeadingNumbering } from "@/lib/editor/headingNumbering";
import { InactiveSelection } from "@/lib/inactiveSelection";
import { OutlineHighlight } from "@/lib/editor/outlineHighlight";
import { SearchHighlight } from "@/lib/searchHighlight";
import { VoiceInsertWidget } from "@/lib/voiceInsertWidget";

import { Callout } from "./callout";
import { CodeBlock } from "./codeBlock";
import { Highlight } from "./highlight";
import { EditorImage } from "./image";
import { BulletList, OrderedList } from "./lists";
import { HardBreak, Table, TableCell, TableHeader, TableRow } from "./table";
import { TaskItem, TaskList, TaskListMarkdown } from "./taskList";
import { Underline } from "./underline";

// Everything that defines the document model itself, in the order TipTap loads them.
function buildContentExtensions(): Extensions {
  return [
    // The lists, the hard break and the table are the local variants: they
    // refuse block content in table cells and serialize a cell without ever
    // falling back to tiptap-markdown's "[table]" placeholder (table.ts).
    StarterKit.configure({ codeBlock: false, bulletList: false, orderedList: false, hardBreak: false }),
    CodeBlock,
    BulletList,
    OrderedList,
    HardBreak,
    Callout,
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskListMarkdown,
    Underline,
    Highlight,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      autolink: false,
      linkOnPaste: false,
      openOnClick: false
    }),
    // html: false — raw HTML in a note stays visible text instead of being
    // parsed into the document; the price is the placeholder fallback the
    // table serializer works around.
    Markdown.configure({
      html: false,
      breaks: true
    })
  ];
}

// The complete extension set of the editor. Voice insert, search highlight,
// code block links and inactive selection are decoration-only and do not affect serialization. EditorImage lives here
// rather than in the content set: its NodeView resolves vault-relative paths
// into blob URLs, which only makes sense for a document that is actually open.
export function buildEditorExtensions(): Extensions {
  return [
    ...buildContentExtensions(),
    EditorImage,
    VoiceInsertWidget,
    SearchHighlight,
    CodeBlockLinks,
    OutlineHighlight,
    HeadingNumbering,
    InactiveSelection
  ];
}

// Content-only extension set used by read-only previews.
export function buildPreviewExtensions(): Extensions {
  return buildContentExtensions();
}
