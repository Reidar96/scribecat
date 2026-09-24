import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import type { PickedImageFile } from "@/platform/types";
import { EditorContent, type Editor as TipTapEditor, useEditor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { LinkDialog, type LinkDialogResult } from "@/components/LinkDialog";
import { Toolbar } from "@/components/Toolbar";
import { PdfViewerModal } from "@/components/PdfViewerModal";
import { TableEdgeControls } from "@/components/TableEdgeControls";
import { FileLinkSuggestionPopover } from "@/components/editor/FileLinkSuggestionPopover";
import { DetailsPanel } from "@/components/editor/DetailsPanel";
import { SelectionContextMenu, type SelectionContextMenuState } from "@/components/editor/SelectionContextMenu";
import { MobileSheet } from "@/components/app/MobileSheet";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import {
  DETAILS_PANEL_MAX_WIDTH,
  DETAILS_PANEL_MIN_WIDTH,
  useDetailsPanelWidth
} from "@/hooks/useDetailsPanelWidth";
import { useFileLinkSuggestion } from "@/components/editor/useFileLinkSuggestion";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { CODE_LINK_ATTR } from "@/lib/editor/codeBlockLinks";
import { EditorFileContext } from "@/lib/editorFileContext";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { hasHeading, type OutlineHeading } from "@/lib/editor/documentOutline";
import { updateOutlineHighlight } from "@/lib/editor/outlineHighlight";
import {
  buildFileLinkHref,
  buildVaultFileOptions,
  decodeFileLinkHref,
  getDraggedVaultFilePaths,
  getFileLinkLabel,
  isFileLinkHref,
  resolveFileLinkTarget,
  type VaultFileOption
} from "@/lib/editor/fileLinks";
import { extractErrorMessage } from "@/lib/editor/errorMessages";
import {
  getImageFilesFromClipboard,
  getImageFilesFromDataTransfer,
  getNonImageFilesFromDataTransfer
} from "@/lib/editor/imageTransfer";
import { moveLine, moveListItem, toggleTaskItemChecked } from "@/lib/editor/listCommands";
import { normalizeEscapedCheckboxes } from "@/lib/editor/markdownNormalize";
import { looksLikeMarkdown, pasteMarkdown } from "@/lib/editor/pasteMarkdown";
import { normalizePastedSlice } from "@/lib/editor/pasteNormalize";
import { getEditorMarkdown, getSelectionMarkdown } from "@/lib/editor/markdownStorage";
import { serializeGuarded } from "@/lib/editor/serializationGuard";
import {
  copySelectionAsMarkdown,
  copySelectionAsPlainText,
  copySelectionFormatted,
  type SelectionRange
} from "@/lib/editor/selectionClipboard";
import {
  ABSOLUTE_URL_PATTERN,
  getLastOpenedFolderPath,
  getRelativeImageMarkdownPath,
  saveImageToFolder
} from "@/lib/fileSystem";
import { dirname, join } from "@/platform/paths";
import { updateSearchHighlight } from "@/lib/searchHighlight";
import { canDownloadMarkdown, downloadNoteAsMarkdown } from "@/lib/export/markdownDownload";
import { printMarkdown } from "@/lib/print";
import { replaceBody } from "@/lib/documentFrontmatter";
import { couldBeShortcut } from "@/lib/shortcuts/binding";
import { matchFixedEditorShortcut } from "@/lib/shortcuts/fixed";
import { isRetiredDefault, matchShortcut } from "@/lib/shortcuts/resolve";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useShortcutsStore } from "@/store/useShortcutsStore";

// What the editor embeds as an image — the toolbar's file filter and the drop
// handler share this list, so both accept exactly the same files.
const EDITOR_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

// Marks the surface as a light page inside the dark UI; tokens.css and the
// dark variant in App.css key off this exact name.
const PAPER_SURFACE_CLASS = "editor-view__surface--paper";

type EditorProps = {
  markdown: string;
  /** Full note including YAML frontmatter; the editor itself only sees markdown body. */
  documentMarkdown: string;
  onMarkdownChange: (markdown: string) => void;
  onDocumentMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown?: (filePath: string, markdown: string) => void;
  folderPath: string | null;
  filePath: string | null;
  editorFocusRequestId?: number;
  onRequestSidebarFocus?: () => void;
  onRequestFileOpen?: (filePath: string) => void;
  onZenModeRequest: () => void;
  onDeleteRequest: () => void;
  deleteEnabled: boolean;
  documentLocked: boolean;
  onDocumentLockToggle: () => void;
  /** Where the toolbar renders instead of inside the editor (the document
   *  panel's slot above the title row on desktop); null keeps it inline. */
  toolbarContainer?: HTMLElement | null;
};

export type EditorHandle = {
  printDocument: () => void;
  getMarkdown: () => string;
  getSelectionText: () => string;
  /**
   * The selected range, for a caller that is about to take the focus away:
   * ProseMirror collapses its selection when the editor is blurred, so the
   * document header's menu keeps the range from before it opened and hands
   * it back to `copyRange`.
   */
  getSelectionRange: () => SelectionRange | null;
  copyRange: (range: SelectionRange, variant: "markdown" | "plainText") => void;
};

type LinkDialogState = {
  /** Href of the link the caret sits in, "" for a new link. */
  href: string;
  selectedText: string;
  isLinkActive: boolean;
};

type PdfPreviewState = {
  absolutePath: string;
  label: string;
};

function isLocalPdfHref(href: string): boolean {
  if (
    !href ||
    ABSOLUTE_URL_PATTERN.test(href) ||
    href.startsWith("//") ||
    href.startsWith("#")
  ) {
    return false;
  }

  const [path] = href.split(/[?#]/);
  return /\.pdf$/i.test(path);
}

// The selected passage as markdown — the form the chat agent's get_selection
// tool and the composer's selection chip both work with. Plain text would drop
// exactly the markers the agent has to carry over when it rewrites or extends
// the passage: a selected checklist would come back as bare sentences.
function selectionText(editor: TipTapEditor): string {
  const { from, to } = editor.state.selection;

  return normalizeEscapedCheckboxes(
    getSelectionMarkdown(editor, from, to) || editor.state.doc.textBetween(from, to, "\n")
  );
}

// Turns a node selection (a selected image with its resize handles) into a
// caret before the node. The resize handles and the toolbar prevent the
// default on pointer/mouse down, so neither takes focus away from the editor.
function collapseNodeSelection(editor: TipTapEditor): void {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection) {
    editor.commands.setTextSelection(selection.from);
  }
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    markdown,
    documentMarkdown,
    onMarkdownChange,
    onDocumentMarkdownChange,
    onCanonicalMarkdown,
    folderPath,
    filePath,
    editorFocusRequestId,
    onRequestSidebarFocus,
    onRequestFileOpen,
    onZenModeRequest,
    onDeleteRequest,
    deleteEnabled,
    documentLocked,
    onDocumentLockToggle,
    toolbarContainer = null
  },
  ref
) {
  const { t } = useTranslation();
  const editorRef = useRef<TipTapEditor | null>(null);
  const documentLockedRef = useRef(documentLocked);
  documentLockedRef.current = documentLocked;
  // The pointer type of the last press inside the editor, for the context
  // menu guard below: the event itself does not always say where it came from.
  const lastPointerTypeRef = useRef<string | null>(null);
  // Set by Ctrl+Shift+V and consumed by the paste event it triggers: the
  // clipboard event itself carries no modifier state.
  const plainPasteRequestedRef = useRef(false);
  const lastSyncedMarkdownRef = useRef(markdown);
  // Kept in a ref so the sync effect below doesn't re-run for a new callback
  // identity: it may only react to actual content changes. Declared up here
  // because the editor's onUpdate reaches for it too.
  const onCanonicalMarkdownRef = useRef(onCanonicalMarkdown);
  onCanonicalMarkdownRef.current = onCanonicalMarkdown;
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const documentWidth = useEditorSettingsStore((state) => state.documentWidth);
  const detailsPanelVisible = useEditorSettingsStore((state) => state.detailsPanelVisible);
  const layout = useLayoutMode();
  // Phone and tablet show the details panel as a sheet with its own switch.
  const detailsSheetOpen = useEditorSettingsStore((state) => state.detailsSheetOpen);
  const setDetailsSheetOpen = useEditorSettingsStore((state) => state.setDetailsSheetOpen);
  const setDetailsPanelVisible = useEditorSettingsStore((state) => state.setDetailsPanelVisible);
  const {
    detailsPanelWidth,
    isResizingDetailsPanel,
    handleDetailsPanelResizeStart,
    handleDetailsPanelResizeKeyDown
  } = useDetailsPanelWidth();
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState | null>(null);
  // Node types the serializer replaced with a placeholder in the last
  // serialization (see lib/editor/serializationGuard). While the list is
  // not empty the document is not reported to the store, so nothing with a
  // placeholder in it can reach the disk, and a banner says so.
  const [unserializableNodes, setUnserializableNodes] = useState<string[]>([]);
  // Tab out of the document hands focus to the details panel's outline; the
  // panel watches this counter the way the editor watches editorFocusRequestId.
  const [outlineFocusRequestId, setOutlineFocusRequestId] = useState(0);

  // The vault's notes: what the link dialog and the "[[" picker offer, and what
  // a clicked link is resolved against. editorProps handlers are created once,
  // so they read the list through a ref that stays current.
  const vaultFilePaths = useAppStore((state) => state.filePaths);
  const vaultFilePathsRef = useRef(vaultFilePaths);
  vaultFilePathsRef.current = vaultFilePaths;

  const fileLinkOptions = useMemo(
    () => (filePath ? buildVaultFileOptions(folderPath, vaultFilePaths, filePath) : []),
    [folderPath, vaultFilePaths, filePath]
  );

  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null);

  const { contextMenu: selectionMenu, setContextMenu: setSelectionMenu } =
    useContextMenuState<SelectionContextMenuState>();

  // Clipboard failures (a webview without clipboard permission, a browser
  // blocking the API) are reported on the editor's shared feedback channel,
  // no dialog for a copy that did not happen.
  const reportCopyResult = (copied: boolean) => {
    if (!copied) {
      setFeedback({ kind: "error", message: t("editorContextMenu.copyFailed") });
    }
  };

  const copySelection = (variant: "formatted" | "markdown" | "plainText") => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (variant === "formatted") {
      reportCopyResult(copySelectionFormatted(currentEditor));
      return;
    }

    const copy = variant === "markdown" ? copySelectionAsMarkdown : copySelectionAsPlainText;
    void copy(currentEditor).then(reportCopyResult);
  };

  // Right-click on a selection offers the three portable copy formats.
  const handleEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    // On a touch screen the long press (and on Android the double tap that
    // selects a word) arrives as this event too; it is how a word gets
    // selected there, and our menu would open instead of the selection
    // handles. The paw button in the toolbar is the way in on touch.
    //
    // The event's own pointerType is not enough: Android synthesises the
    // contextmenu of the double tap from the selection, not from the finger,
    // and reports it as a mouse. The last pointer that actually went down in
    // the editor is what decides; only a menu opened without any pointer
    // (keyboard) falls back to the device's primary pointer.
    const nativeEvent = event.nativeEvent as PointerEvent | MouseEvent;
    const eventPointerType = "pointerType" in nativeEvent ? nativeEvent.pointerType : "";
    const pointerType = lastPointerTypeRef.current ?? eventPointerType;
    const isTouchPointer = (type: string) => type === "touch" || type === "pen";
    const fromTouch =
      isTouchPointer(eventPointerType) ||
      isTouchPointer(pointerType) ||
      (pointerType === "" && window.matchMedia("(pointer: coarse)").matches);

    if (fromTouch) {
      return;
    }

    if (currentEditor.state.selection.empty) {
      return;
    }

    event.preventDefault();
    setSelectionMenu({ x: event.clientX, y: event.clientY });
  };

  // Panel visibility (and the whole search state) lives in useSearchStore
  // so it survives the per-file remount of this component during
  // cross-file match navigation.
  const openFindPanel = () => {
    useSearchStore.getState().openPanel();
  };

  const closeFindPanel = () => {
    useSearchStore.getState().closePanel();

    const currentEditor = editorRef.current;

    if (currentEditor) {
      updateSearchHighlight(currentEditor, null);
      currentEditor.commands.focus();
    }
  };

  // Opening the find panel must work regardless of where the focus currently
  // is (editor, toolbar, sidebar), so that shortcut is registered globally in
  // useGlobalShortcuts rather than in the ProseMirror keymap.

  // The heading goes to the top of the viewport rather than "just visible":
  // the point of a jump is to read the section, not to see its title at the
  // bottom edge.
  const jumpToHeading = (heading: OutlineHeading) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }

    const { doc } = currentEditor.state;
    const node = doc.nodeAt(heading.pos);

    if (!node || node.type.name !== "heading") {
      return;
    }

    // Deliberately does not call .focus(): stealing DOM focus into the editor
    // would pull it out of the outline row, and arrow-key navigation there
    // stops working after the very first jump. Escape / Shift+Tab remain the
    // explicit way back into the document (see onRequestEditorFocus).
    currentEditor.commands.setTextSelection(heading.pos + 1);
    updateOutlineHighlight(currentEditor, heading.pos);

    const element = currentEditor.view.nodeDOM(heading.pos);

    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "start" });
    }
  };

  const focusEditor = () => {
    const currentEditor = editorRef.current;

    if (currentEditor && !currentEditor.isDestroyed && currentEditor.isEditable) {
      currentEditor.commands.focus();
    }
  };

  const handleLinkRequest = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const { from, to } = currentEditor.state.selection;

    setLinkDialog({
      href: (currentEditor.getAttributes("link").href as string | undefined) ?? "",
      selectedText: currentEditor.state.doc.textBetween(from, to, " "),
      isLinkActive: currentEditor.isActive("link")
    });
  };

  const handleLinkSubmit = ({ href, text }: LinkDialogResult) => {
    const currentEditor = editorRef.current;
    setLinkDialog(null);

    if (!currentEditor) {
      return;
    }

    // With a selection (or the caret inside an existing link) the document
    // already provides the link text, so only the mark changes. Otherwise the
    // link is inserted with a text of its own: the chosen label, the note's
    // file name, or the URL itself as a last resort.
    if (currentEditor.isActive("link") || !currentEditor.state.selection.empty) {
      currentEditor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      return;
    }

    const label = text || (isFileLinkHref(href) ? getFileLinkLabel(decodeFileLinkHref(href)) : href);

    currentEditor
      .chain()
      .focus()
      .insertContent([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }])
      .run();
  };

  const handleLinkRemove = () => {
    setLinkDialog(null);
    editorRef.current?.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  /**
   * Inserts links to other notes of the vault — used by the sidebar drop and
   * by the "[[" picker. `replaceRange` is the typed trigger the chosen link
   * takes the place of; without it the links are inserted at `insertPos`.
   */
  const insertFileLinks = (
    targetFilePaths: string[],
    insertPos: number,
    replaceRange?: { from: number; to: number }
  ) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || targetFilePaths.length === 0) {
      return;
    }

    if (!filePath) {
      setFeedback({ kind: "error", message: t("editor.linkRequiresFile") });
      return;
    }

    const content = targetFilePaths.flatMap((targetFilePath, index) => {
      const link = {
        type: "text",
        text: getFileLinkLabel(targetFilePath),
        marks: [{ type: "link", attrs: { href: buildFileLinkHref(filePath, targetFilePath) } }]
      };

      return index === 0 ? [link] : [{ type: "text", text: " " }, link];
    });

    currentEditor
      .chain()
      .focus()
      .insertContentAt(replaceRange ?? insertPos, content)
      .run();
  };

  const {
    suggestion: fileLinkSuggestion,
    refreshSuggestion,
    closeSuggestion,
    selectSuggestion,
    setActiveIndex: setSuggestionActiveIndex,
    handleSuggestionKeyDown
  } = useFileLinkSuggestion({
    editorRef,
    fileOptions: fileLinkOptions,
    onSelect: (option: VaultFileOption, range) => {
      insertFileLinks([option.filePath], range.from, range);
    }
  });

  // A link to a note opens that note instead of the browser — routed through
  // App so the unsaved-changes dialog guards the switch, exactly like clicking
  // the file in the sidebar.
  const openFileLink = (href: string) => {
    const targetFilePath = filePath
      ? resolveFileLinkTarget(href, filePath, vaultFilePathsRef.current)
      : null;

    if (!targetFilePath) {
      setFeedback({
        kind: "error",
        message: t("editor.linkTargetMissing", { href: decodeFileLinkHref(href) })
      });
      return;
    }

    onRequestFileOpen?.(targetFilePath);
  };

  const openLocalPdf = async (href: string) => {
    if (!filePath) {
      return;
    }

    const [rawPath] = href.split(/[?#]/);
    const decodedPath = decodeFileLinkHref(rawPath);

    try {
      const absolutePath = await join(await dirname(filePath), decodedPath);
      const label = decodedPath.replace(/\\/g, "/").split("/").pop() || decodedPath;
      setPdfPreview({ absolutePath, label });
    } catch {
      setFeedback({
        kind: "error",
        message: t("pdfViewer.error")
      });
    }
  };

  type ImagePayload = { fileName: string; mimeType: string; data: Uint8Array };

  const insertImagePayloads = async (payloads: ImagePayload[], insertPos: number) => {
    const currentEditor = editorRef.current;

    if (!currentEditor || payloads.length === 0) {
      return;
    }

    if (!folderPath || !filePath) {
      setFeedback({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    // Paste and drop cannot be disabled like a button; refuse up front with
    // the same hint instead of failing per image.
    if (!getVaultCapabilities().images) {
      setFeedback({ kind: "error", message: vaultCapabilityHint() });
      return;
    }

    let pos = insertPos;

    for (const { fileName, mimeType, data } of payloads) {
      try {
        const rootRelativePath = await saveImageToFolder(
          folderPath,
          filePath,
          fileName,
          mimeType,
          data
        );
        const markdownPath = await getRelativeImageMarkdownPath(
          folderPath,
          filePath,
          rootRelativePath
        );
        const altText = fileName.replace(/\.[^.]+$/, "");

        const sizeBefore = currentEditor.state.doc.content.size;
        currentEditor
          .chain()
          .focus()
          .insertContentAt(pos, { type: "image", attrs: { src: markdownPath, alt: altText } })
          .run();
        const sizeAfter = currentEditor.state.doc.content.size;

        pos += sizeAfter - sizeBefore;
      } catch (error) {
        setFeedback({
          kind: "error",
          message: t("editor.imageInsertFailed", { fileName, error: extractErrorMessage(error, t) })
        });
      }
    }
  };

  const insertImageFiles = async (files: File[], insertPos: number) => {
    const payloads = await Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type,
        data: new Uint8Array(await file.arrayBuffer())
      }))
    );

    await insertImagePayloads(payloads, insertPos);
  };

  // Toolbar image button: pick one or more image files through the shell's
  // picker (the native dialog opened at the current vault, or the browser's
  // file input), then insert them like a paste/drop.
  const handleImageInsertRequest = async () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (!folderPath || !filePath) {
      setFeedback({
        kind: "error",
        message: t("editor.imageRequiresFile")
      });
      return;
    }

    let picked: PickedImageFile[];

    try {
      picked = await platform.imagePicker.pickImages({
        defaultPath: folderPath ?? getLastOpenedFolderPath() ?? undefined,
        title: t("editor.imageDialogTitle"),
        filterName: t("editor.imageDialogFilter"),
        extensions: EDITOR_IMAGE_EXTENSIONS
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: extractErrorMessage(error, t)
      });
      return;
    }

    if (picked.length === 0) {
      return;
    }

    const payloads: ImagePayload[] = [];

    for (const file of picked) {
      try {
        payloads.push({ fileName: file.fileName, ...(await file.read()) });
      } catch (error) {
        setFeedback({
          kind: "error",
          message: t("editor.imageInsertFailed", {
            fileName: file.fileName,
            error: extractErrorMessage(error, t)
          })
        });
      }
    }

    await insertImagePayloads(payloads, currentEditor.state.selection.from);
  };

  const printDocument = () => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const currentMarkdown = getEditorMarkdown(currentEditor, markdown);

    printMarkdown(currentMarkdown, filePath).catch((error: unknown) => {
      console.error("Print failed:", error);
    });
  };

  // The note as the .md it is, with what the editor holds right now. Only
  // offered where the file is not on this machine (see markdownDownload).
  const downloadDocument =
    filePath && canDownloadMarkdown(folderPath)
      ? () => {
          const currentEditor = editorRef.current;

          if (!currentEditor) {
            return;
          }

          downloadNoteAsMarkdown(filePath, replaceBody(documentMarkdown, getEditorMarkdown(currentEditor, markdown))).catch((error: unknown) => {
            console.error("Markdown download failed:", error);
          });
        }
      : null;

  // Serializes the document and returns the markdown only when it is a
  // faithful form of it. Null means the serializer fell back to a placeholder
  // for some node (issue #56: "[table]" for a table with a list in a cell),
  // and the document must not reach the store, let alone the disk, in that
  // form. The banner it raises stays until a later serialization comes back
  // clean.
  const guardSerialization = (currentEditor: TipTapEditor, fallback: string): string | null => {
    const { markdown: serialized, lost } = serializeGuarded(currentEditor, fallback);

    setUnserializableNodes((previous) =>
      previous.length === lost.length && previous.every((name, index) => name === lost[index]) ? previous : lost
    );

    if (lost.length > 0) {
      console.error(`Markdown serialization lost nodes (${lost.join(", ")}); the note is not saved in this state.`);
      return null;
    }

    return serialized;
  };

  const getMarkdown = () => {
    const currentEditor = editorRef.current;
    return currentEditor ? getEditorMarkdown(currentEditor, markdown) : "";
  };

  const getSelectionText = () => {
    const currentEditor = editorRef.current;
    return currentEditor ? selectionText(currentEditor) : "";
  };

  const getSelectionRange = (): SelectionRange | null => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return null;
    }

    const { from, to, empty } = currentEditor.state.selection;
    return empty ? null : { from, to };
  };

  const copyRange = (range: SelectionRange, variant: "markdown" | "plainText") => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    const copy = variant === "markdown" ? copySelectionAsMarkdown : copySelectionAsPlainText;
    void copy(currentEditor, range).then(reportCopyResult);
  };

  useImperativeHandle(
    ref,
    () => ({
      printDocument,
      getMarkdown,
      getSelectionText,
      getSelectionRange,
      copyRange
    }),
    [markdown]
  );

  // The file's markdown goes into the editor verbatim: normalizing it here
  // (e.g. unescaping "\[ \]" into a real checkbox) rewrites the document
  // against what's on disk, and the file shows up as unsaved the moment it is
  // opened. External content is normalized only at its explicit import/paste boundary.
  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: markdown,
    editable: !documentLocked,
    // editorRef is assigned during render (below), not here: under
    // React.StrictMode useEditor creates a second instance and discards the
    // first, and the first one's deferred onCreate would put the destroyed
    // instance back into the ref until the next render.
    onCreate: () => {
      lastSyncedMarkdownRef.current = markdown;
    },
    onUpdate: ({ editor, transaction }) => {
      const nextMarkdown = guardSerialization(editor, markdown);

      if (nextMarkdown === null) {
        // The store keeps the last good form; the banner asks the user to
        // undo. The rest of the update (selection mirror, suggestions) is
        // unaffected.
        refreshSuggestion();
        return;
      }

      lastSyncedMarkdownRef.current = nextMarkdown;

      // A document change that only an appended transaction made is not an
      // edit: StarterKit's TrailingNode adds an empty paragraph after a
      // closing code block (or table, image) on the first transaction after
      // the file opens, which a plugin fires right at mount. Reported as an
      // edit it made every such note "unsaved" the moment it was opened,
      // since the baseline still had the file's own form. It is formatting,
      // so it goes to the baseline first, the way the sync effect below
      // reports the canonical form; a note with real unsaved edits keeps
      // them (adoptCanonicalFileContent leaves a dirty document alone).
      if (!transaction.docChanged && filePath) {
        onCanonicalMarkdownRef.current?.(filePath, nextMarkdown);
      }

      onMarkdownChange(nextMarkdown);

      // An edit can change what the selection covers without the selection
      // itself moving, so the mirror is refreshed from here too.
      refreshSuggestion();
    },
    onSelectionUpdate: () => {
      refreshSuggestion();
    },
    onBlur: ({ editor: currentEditor }) => {
      closeSuggestion();
      // A selected image stays selected when the editor loses focus, so a click
      // outside would leave it highlighted with its resize handles.
      collapseNodeSelection(currentEditor);
    },
    // Real focus in the editor means the reader is looking at the caret, not
    // hunting for a section anymore — whichever of the several ways back in
    // they used (click, Escape, Shift+Tab).
    onFocus: ({ editor: currentEditor }) => {
      updateOutlineHighlight(currentEditor, null);
    },
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (documentLockedRef.current) {
          event.preventDefault();
          return true;
        }

        if (moved) {
          return false;
        }

        const droppedAt = () => {
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          return coordinates?.pos ?? view.state.selection.from;
        };

        // Notes dragged out of the sidebar become links, images dragged in from
        // outside the app are embedded.
        const draggedFilePaths = getDraggedVaultFilePaths(event.dataTransfer);

        if (draggedFilePaths.length > 0) {
          event.preventDefault();
          insertFileLinks(draggedFilePaths, droppedAt());
          return true;
        }

        const files = getImageFilesFromDataTransfer(event.dataTransfer);

        // Documents are deliberately not converted into the open text: they
        // belong in the vault as their own note, so the drop is refused with a
        // pointer to the file list rather than pasting a PDF into a sentence.
        if (getNonImageFilesFromDataTransfer(event.dataTransfer).length > 0) {
          event.preventDefault();
          setFeedback({ kind: "error", message: t("editor.dropDocumentHint") });

          if (files.length === 0) {
            return true;
          }
        }

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        void insertImageFiles(files, droppedAt());

        return true;
      },
      transformPasted: (slice) => normalizePastedSlice(slice),
      handlePaste: (view, event) => {
        if (documentLockedRef.current) {
          event.preventDefault();
          return true;
        }

        const plainPasteRequested = plainPasteRequestedRef.current;
        plainPasteRequestedRef.current = false;

        const files = getImageFilesFromClipboard(event.clipboardData);

        if (files.length > 0) {
          event.preventDefault();

          void insertImageFiles(files, view.state.selection.from);
          return true;
        }

        // Plain text that reads as Markdown is pasted as what it describes.
        // Not when the clipboard also carries HTML (a copy out of a browser
        // or Word, which ProseMirror already parses — a "*" in that text is
        // a character, not emphasis), not into a code block, and not when
        // the user asked for the raw text with Ctrl+Shift+V.
        const currentEditor = editorRef.current;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const hasHtml = Boolean(event.clipboardData?.getData("text/html"));
        const inCode = view.state.selection.$from.parent.type.spec.code === true;

        if (
          plainPasteRequested ||
          hasHtml ||
          inCode ||
          !currentEditor ||
          !useEditorSettingsStore.getState().pasteMarkdown ||
          !looksLikeMarkdown(text)
        ) {
          return false;
        }

        if (!pasteMarkdown(currentEditor, text)) {
          return false;
        }

        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

          if (!anchor) {
            // A URL inside a code block is plain text carrying a decoration
            // (src/lib/editor/codeBlockLinks.ts), not an <a>: it opens in the
            // browser like any other external link.
            const codeLink = target?.closest(`[${CODE_LINK_ATTR}]`)?.getAttribute(CODE_LINK_ATTR);

            if (!codeLink) {
              return false;
            }

            event.preventDefault();
            void platform.shell.openUrl(codeLink);
            return true;
          }

          event.preventDefault();

          // A plain click follows the link — a note opens in the editor, any
          // other target in the system browser. The raw attribute is what a
          // note link has to be resolved from: the DOM property would resolve
          // the relative path against the app's own base URL.
          const rawHref = anchor.getAttribute("href") ?? "";

          if (isFileLinkHref(rawHref)) {
            openFileLink(rawHref);
          } else if (isLocalPdfHref(rawHref)) {
            void openLocalPdf(rawHref);
          } else {
            void platform.shell.openUrl(anchor.href);
          }

          return true;
        }
      },
      handleKeyDown: (view, event) => {
        // While the "[[" picker is open it owns the arrow keys, Enter, Tab and
        // Escape — nothing of that may reach the document.
        if (handleSuggestionKeyDown(event)) {
          return true;
        }

        if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          // Where Tab already means something (indent in lists and code, next
          // cell in tables) it stays with the extensions' keymaps; only outside
          // does it move focus: Shift+Tab to the sidebar, Tab to the details
          // panel's outline. Sidebar, document, outline: one direction, left
          // to right.
          const currentEditor = editorRef.current;
          const tabHasMeaning =
            !documentLockedRef.current &&
            (currentEditor?.isActive("bulletList") ||
              currentEditor?.isActive("orderedList") ||
              currentEditor?.isActive("taskList") ||
              currentEditor?.isActive("table") ||
              currentEditor?.isActive("codeBlock"));

          if (tabHasMeaning) {
            return false;
          }

          if (event.shiftKey) {
            event.preventDefault();
            onRequestSidebarFocus?.();
            return true;
          }

          // With nothing to land on, Tab keeps today's behaviour rather than
          // becoming a dead key. The panel is checked in the DOM, not the
          // store: Zen mode and narrow windows hide it with CSS while it
          // stays mounted, and a hidden button cannot take focus.
          const panel = view.dom.closest(".editor-view")?.querySelector<HTMLElement>(".details-sidebar");

          if (!panel || panel.offsetParent === null || !hasHeading(view.state.doc)) {
            return false;
          }

          event.preventDefault();
          setOutlineFocusRequestId((id) => id + 1);
          return true;
        }

        if (!couldBeShortcut(event)) {
          return false;
        }

        // The copy combos are fixed on purpose (lib/shortcuts/fixed.ts), so
        // they are settled before the remappable registry gets a look. Only
        // a selection is copied: with nothing selected the keystrokes stay
        // with the browser, which keeps Ctrl+C native in every other focus.
        const fixedShortcut = matchFixedEditorShortcut(event);

        if (fixedShortcut === "pastePlainText") {
          // The keystroke stays with the browser, which pastes the plain
          // text; the flag only tells handlePaste to skip the Markdown
          // conversion. Cleared shortly after in case no paste follows
          // (empty clipboard, permission refused).
          plainPasteRequestedRef.current = true;
          window.setTimeout(() => {
            plainPasteRequestedRef.current = false;
          }, 500);

          return false;
        }

        if (fixedShortcut) {
          if (view.state.selection.empty || fixedShortcut === "copyFormatted") {
            return false;
          }

          event.preventDefault();
          copySelection(fixedShortcut === "copyMarkdown" ? "markdown" : "plainText");
          return true;
        }

        // Everything below is user-remappable, so the combo is looked up
        // instead of compared inline. getState() keeps a rebind effective
        // without recreating the editor.
        const { overrides } = useShortcutsStore.getState();
        const action = matchShortcut(overrides, event, "editor");

        if (documentLockedRef.current) {
          if (action || isRetiredDefault(overrides, event, "editor")) {
            event.preventDefault();
            return true;
          }

          return false;
        }

        if (!action) {
          // A default the user moved elsewhere must not silently fall through
          // to TipTap's own keymap (Ctrl+B, Ctrl+I, Ctrl+U, …).
          if (isRetiredDefault(overrides, event, "editor")) {
            event.preventDefault();
            return true;
          }

          return false;
        }

        const chain = () => editorRef.current?.chain().focus();

        switch (action) {
          case "moveListItemUp":
          case "moveListItemDown": {
            const direction = action === "moveListItemUp" ? "up" : "down";
            const moved = moveListItem(view, direction) || moveLine(view, direction);

            if (moved) {
              event.preventDefault();
            }

            return moved;
          }
          case "checkboxToggle":
            event.preventDefault();
            toggleTaskItemChecked(view);
            return true;
          default:
            break;
        }

        event.preventDefault();

        switch (action) {
          case "bold":
            chain()?.toggleBold().run();
            break;
          case "italic":
            chain()?.toggleItalic().run();
            break;
          case "underline":
            chain()?.toggleUnderline().run();
            break;
          case "highlight":
            // With a selection the combo is a plain format toggle; without one
            // it switches the marker tool, so the keyboard reaches the same
            // two behaviours as the toolbar button.
            if (view.state.selection.empty) {
              chain()?.toggleHighlighterMode().run();
            } else {
              chain()?.toggleHighlight().run();
            }
            break;
          case "strikethrough":
            chain()?.toggleStrike().run();
            break;
          case "inlineCode":
            chain()?.toggleCode().run();
            break;
          case "codeBlock":
            chain()?.toggleCodeBlock().run();
            break;
          case "blockquote":
            chain()?.toggleBlockquote().run();
            break;
          case "insertLink":
            handleLinkRequest();
            break;
          case "bulletList":
            chain()?.toggleBulletList().run();
            break;
          case "orderedList":
            chain()?.toggleOrderedList().run();
            break;
          case "checkbox":
            chain()?.toggleTaskList().run();
            break;
          case "heading1":
          case "heading2":
          case "heading3":
          case "heading4":
          case "heading5":
          case "heading6": {
            const level = Number(action.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6;
            chain()?.toggleHeading({ level }).run();
            break;
          }
          default:
            break;
        }

        return true;
      },
      attributes: {
        class: cn(
          "editor-view__surface prose dark:prose-invert max-w-none",
          paperSurface && PAPER_SURFACE_CLASS
        ),
        "data-testid": "editor",
        spellcheck: "false"
      }
    }
  });

  if (editor) {
    editorRef.current = editor;
  }

  useEffect(() => {
    editor?.view.dom.setAttribute("spellcheck", "false");
    editor?.setEditable(!documentLocked);

    if (documentLocked && editor) {
      collapseNodeSelection(editor);
    }
  }, [editor, documentLocked]);

  useEffect(() => {
    editor?.view.dom.classList.toggle(PAPER_SURFACE_CLASS, paperSurface);
  }, [editor, paperSurface]);

  // A tap on an image selects it without focusing the editor (see ImageView),
  // so there is no blur to clear that selection on. A pointer going down
  // anywhere outside the editor surface clears it instead.
  useEffect(() => {
    if (!editor) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && !editor.view.dom.contains(target)) {
        collapseNodeSelection(editor);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editor]);

  // A focus request from outside (file tree: Tab) moves focus into the editor
  // with the cursor at the document start, so navigation can continue with
  // the arrow keys.
  // Tracks the last handled request value instead of a "skip first run" guard:
  // under React.StrictMode, mount effects run twice while refs persist, so a
  // bool guard would wrongly focus again on the second run and steal focus
  // from, e.g., the title rename after creating a new file.
  const lastHandledEditorFocusRequestRef = useRef(editorFocusRequestId);

  useEffect(() => {
    if (lastHandledEditorFocusRequestRef.current === editorFocusRequestId) {
      return;
    }

    lastHandledEditorFocusRequestRef.current = editorFocusRequestId;
    editorRef.current?.commands.focus("start");
  }, [editorFocusRequestId]);

  useEffect(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor) {
      return;
    }

    if (
      markdown !== lastSyncedMarkdownRef.current &&
      markdown !== getEditorMarkdown(currentEditor, "")
    ) {
      currentEditor.commands.setContent(markdown, { emitUpdate: false });
    }

    lastSyncedMarkdownRef.current = markdown;

    // A file whose content the serializer can't write back must not have
    // its baseline replaced by the placeholder form either.
    const canonicalMarkdown = guardSerialization(currentEditor, markdown);

    if (canonicalMarkdown === null) {
      return;
    }

    // The same document can be written in several equivalent ways, and the
    // editor always serializes the canonical one — so markdown that is valid
    // but formatted differently (loose lists, "*" bullets, "1)" numbering)
    // comes back changed on the very first serialization, with no edit
    // involved. Reporting that form back as the baseline is what keeps a
    // freshly opened file from showing up as unsaved; nothing is written to
    // disk here.
    if (filePath && canonicalMarkdown !== markdown) {
      lastSyncedMarkdownRef.current = canonicalMarkdown;
      onCanonicalMarkdownRef.current?.(filePath, canonicalMarkdown);
    }
  }, [markdown, editor, filePath]);

  if (!editor) {
    return null;
  }

  const toolbar = (
    <Toolbar
      editor={editor}
      onLinkRequest={handleLinkRequest}
      onImageInsertRequest={handleImageInsertRequest}
      onPrintRequest={printDocument}
      onDeleteRequest={onDeleteRequest}
      deleteEnabled={deleteEnabled}
      onDownloadMarkdownRequest={downloadDocument}
      onSearchRequest={openFindPanel}
      onZenModeRequest={onZenModeRequest}
      documentLocked={documentLocked}
      onDocumentLockToggle={onDocumentLockToggle}
    />
  );

  return (
    <div className={cn("editor-view", documentLocked && "editor-view--locked", documentWidth === "compact" && "editor-view--compact")}>
      {pdfPreview ? (
        <PdfViewerModal
          absolutePath={pdfPreview.absolutePath}
          label={pdfPreview.label}
          onClose={() => setPdfPreview(null)}
        />
      ) : null}
      {unserializableNodes.length > 0 ? (
        <div className="editor-view__feedback editor-view__feedback--error" role="alert">
          <span className="editor-view__feedback-message">
            {t("editor.unserializableContent", { nodes: unserializableNodes.join(", ") })}
          </span>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={
            feedback.kind === "error"
              ? "editor-view__feedback editor-view__feedback--error"
              : "editor-view__feedback editor-view__feedback--success"
          }
          aria-live="polite"
        >
          <span className="editor-view__feedback-message">{feedback.message}</span>
          <button
            type="button"
            className="editor-view__feedback-dismiss"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={() => setFeedback(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}

      <EditorFileContext.Provider value={{ folderPath, filePath }}>
        <div className="editor-view__body">
          <FindReplacePanel
            editor={editor}
            folderPath={folderPath}
            filePath={filePath}
            onClose={closeFindPanel}
            onRequestFileOpen={onRequestFileOpen}
          />
          <div className="editor-view__panes">
            <ScrollArea className="editor-view__scroll">
              <EditorContent
                editor={editor}
                className="editor-view__content"
                onPointerDownCapture={(event) => {
                  lastPointerTypeRef.current = event.pointerType;
                }}
                onContextMenu={handleEditorContextMenu}
                // The wrapper fills the scroll area below a short document.
                // A click there is outside the contenteditable, so left to
                // itself the browser parks the DOM selection on the nearest
                // selectable element before it, the toolbar's separator,
                // which then lights up as a stray caret. Treat it as "after
                // the last paragraph" instead, the way editors do.
                onMouseDown={(event) => {
                  if (event.target !== event.currentTarget || !editor || documentLockedRef.current) {
                    return;
                  }

                  event.preventDefault();
                  editor.commands.focus("end");
                }}
              />
            </ScrollArea>
            <TableEdgeControls editor={editor} disabled={documentLocked} />

            {detailsSheetOpen && layout !== "desktop" ? (
              <MobileSheet
                side={layout === "phone" ? "full" : "right"}
                backdrop={layout === "phone"}
                label={t("detailsPanel.title")}
                onClose={() => setDetailsSheetOpen(false)}
                className="mobile-sheet__panel--details"
              >
                <DetailsPanel
                  editor={editor}
                  folderPath={folderPath}
                  filePath={filePath}
                  markdown={markdown}
                  documentMarkdown={documentMarkdown}
                  readOnly={documentLocked}
                  onDocumentMarkdownChange={onDocumentMarkdownChange}
                  vaultFilePaths={vaultFilePaths}
                  outlineFocusRequestId={outlineFocusRequestId}
                  onJumpToHeading={jumpToHeading}
                  onRequestEditorFocus={focusEditor}
                  onRequestFileOpen={onRequestFileOpen}
                  onClose={() => setDetailsSheetOpen(false)}
                  width={detailsPanelWidth}
                />
              </MobileSheet>
            ) : null}

            {detailsPanelVisible && layout === "desktop" ? (
              <>
                <div
                  className={cn(
                    "workspace-resizer",
                    isResizingDetailsPanel && "workspace-resizer--active"
                  )}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("detailsPanel.resizeLabel")}
                  aria-valuenow={detailsPanelWidth}
                  aria-valuemin={DETAILS_PANEL_MIN_WIDTH}
                  aria-valuemax={DETAILS_PANEL_MAX_WIDTH}
                  tabIndex={0}
                  onPointerDown={handleDetailsPanelResizeStart}
                  onKeyDown={handleDetailsPanelResizeKeyDown}
                >
                  <span className="workspace-resizer__grip" aria-hidden="true" />
                </div>
                <DetailsPanel
                  editor={editor}
                  folderPath={folderPath}
                  filePath={filePath}
                  markdown={markdown}
                  documentMarkdown={documentMarkdown}
                  readOnly={documentLocked}
                  onDocumentMarkdownChange={onDocumentMarkdownChange}
                  vaultFilePaths={vaultFilePaths}
                  outlineFocusRequestId={outlineFocusRequestId}
                  onJumpToHeading={jumpToHeading}
                  onRequestEditorFocus={focusEditor}
                  onRequestFileOpen={onRequestFileOpen}
                  onClose={() => setDetailsPanelVisible(false)}
                  width={detailsPanelWidth}
                />
              </>
            ) : null}
          </div>
        </div>
      </EditorFileContext.Provider>

      {fileLinkSuggestion ? (
        <FileLinkSuggestionPopover
          suggestion={fileLinkSuggestion}
          onSelect={selectSuggestion}
          onActiveIndexChange={setSuggestionActiveIndex}
        />
      ) : null}

      <LinkDialog
        open={linkDialog !== null}
        initialHref={linkDialog?.href ?? ""}
        selectedText={linkDialog?.selectedText ?? ""}
        isLinkActive={linkDialog?.isLinkActive ?? false}
        fileOptions={fileLinkOptions}
        currentFilePath={filePath}
        onSubmit={handleLinkSubmit}
        onRemove={handleLinkRemove}
        onCancel={() => setLinkDialog(null)}
      />

      {selectionMenu ? (
        <SelectionContextMenu
          x={selectionMenu.x}
          y={selectionMenu.y}
          onCopyFormatted={() => copySelection("formatted")}
          onCopyMarkdown={() => copySelection("markdown")}
          onCopyPlainText={() => copySelection("plainText")}
          onClose={() => setSelectionMenu(null)}
        />
      ) : null}






    </div>
  );
});