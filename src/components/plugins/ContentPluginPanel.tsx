import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Search, ChartNoAxesCombined, Trash2, BookOpen, CookingPot, Package, ShoppingBasket, Pin, ArchiveRestore, Archive, GripVertical, MoreHorizontal, FolderInput, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { splitFrontmatter } from "@/lib/documentFrontmatter";
import { createPluginApi } from "@/plugins/api";
import { newPluginDocument, pluginMetadata, pluginSlug, safeDocumentName, setPluginField } from "@/plugins/markdown";
import { pluginById, type PluginId } from "@/plugins/registry";
import { dirname, join } from "@/platform/paths";
import { exists, mkdir } from "@/platform/vaultFs";
import { usePluginStore } from "@/store/usePluginStore";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { PluginCover } from "@/components/plugins/PluginCover";
import { ContentPluginDetail } from "@/components/plugins/ContentPluginDetail";
import { PluginStatistics } from "@/components/plugins/PluginStatistics";
import { PluginDialog } from "@/components/plugins/PluginDialog";
import { useAppStore } from "@/store/useAppStore";
import { PluginTopbar } from "@/components/plugins/PluginTopbar";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";
import { readClipboardText, writeClipboardText } from "@/platform/clipboardText";
import { quickNoteBody, retainCollectionEntries, updateQuickNoteBody } from "@/plugins/collectionState";
import { balancedNoteColumns, moveNoteColumns, nextNoteTopOrder, noteColumns as partitionNotes, noteCreatedAt, noteDropPlacement, noteManualPosition } from "@/plugins/quickNoteLayout";
import { readingCardSummary } from "../../../server/src/public/readingModel";

type Entry = { path: string; markdown: string; metadata: Record<string, string>; title: string };
const entryCache = new Map<string, { mtime: number; entry: Entry }>();
function noteBody(markdown: string) { return quickNoteBody(markdown); }
function QuickNoteCard({ entry, initialEdit, onSave, onCategoryChange, onOpenActions, children }: { entry: Entry; initialEdit: boolean; onSave: (text: string, expected: string) => Promise<boolean>; onCategoryChange: (category: string) => void; onOpenActions: (x: number, y: number, moving?: boolean) => void; children: ReactNode }) {
  const draftKey = `scribecat:quick-note-draft:${entry.path}`;
  const restored = useRef<{ value: string } | null>(null);
  if (restored.current === null) {
    try { restored.current = { value: localStorage.getItem(draftKey) ?? "" }; } catch { restored.current = { value: "" }; }
  }
  const [draft, setDraft] = useState(() => restored.current!.value || noteBody(entry.markdown));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [category, setCategory] = useState(entry.metadata.category ?? "");
  const baseline = useRef(entry.markdown);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { contextMenu: textMenu, setContextMenu: setTextMenu } = useContextMenuState<{ x: number; y: number; start: number; end: number }>();
  const saved = noteBody(entry.markdown);
  useEffect(() => { setCategory(entry.metadata.category ?? ""); }, [entry.metadata.category]);
  useEffect(() => { if (draft === saved) { baseline.current = entry.markdown; setDraft(saved); } }, [saved, entry.markdown]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const scroller = field.closest<HTMLElement>(".content-plugin-panel__body");
    const scrollTop = scroller?.scrollTop;
    field.style.height = "0px";
    field.style.height = `${Math.max(field.scrollHeight, 44)}px`;
    // Safari scroll anchoring may pan the whole collection by a few pixels
    // when the focused card grows or receives its saved Markdown echo.
    if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop;
  }, [draft]);
  useEffect(() => {
    try {
      if (draft !== saved) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch { /* Storage can be unavailable in private mode. */ }
  }, [draft, saved, draftKey]);
  useEffect(() => {
    if (draft === saved) return;
    const timer = window.setTimeout(() => {
      const expected = baseline.current;
      setSaving(true);
      void onSaveRef.current(draft, expected).then((ok) => {
        setSaveError(!ok);
      }).catch(() => setSaveError(true)).finally(() => setSaving(false));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, saved]);
  const status = saveError ? "Kunne ikke lagre – teksten er beholdt" : saving ? "Lagrer …" : draft !== saved ? "Lagrer automatisk" : "Lagret";
  const links = [...new Set((draft.match(/https?:\/\/[^\s<>"')]+/g) ?? []).map((url) => url.replace(/[.,;!?]+$/, "")))].slice(0, 8);
  const replaceSelection = (value: string, start: number, end: number) => {
    setDraft((current) => current.slice(0, start) + value + current.slice(end));
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(start + value.length, start + value.length); });
  };
  return <>
    <div className="content-plugin-panel__note"><textarea ref={textarea} data-note-path={entry.path} aria-label="Huskelapp" value={draft} placeholder="Skriv noe …" onChange={(event) => setDraft(event.target.value)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTextMenu({ x: event.clientX, y: event.clientY, start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }); }} autoFocus={initialEdit} />{links.length > 0 && <div className="content-plugin-panel__note-links">{links.map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" title={url}>{url}</a>)}</div>}</div>
    <div className="content-plugin-panel__note-controls">
      <input className="content-plugin-panel__note-category" aria-label="Kategori for huskelapp" list="quick-note-categories" placeholder="Kategori" value={category} onChange={(event) => setCategory(event.target.value)} onBlur={() => { if (category.trim() !== (entry.metadata.category ?? "")) onCategoryChange(category.trim()); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      <span className="content-plugin-panel__note-status" role="status" title={status}>{status}</span>
      {children}
    </div>
    {textMenu && <ContextMenuSurface x={textMenu.x} y={textMenu.y} className="quick-note-context-menu" title="Huskelapp" onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
      {textMenu.end > textMenu.start && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { const { start, end } = textMenu; void writeClipboardText(draft.slice(start, end)); setTextMenu(null); }}>Kopier</button>}
      {textMenu.end > textMenu.start && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { const { start, end } = textMenu; void writeClipboardText(draft.slice(start, end)).then(() => replaceSelection("", start, end)).catch(() => undefined); setTextMenu(null); }}>Klipp ut</button>}
      <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { const { start, end } = textMenu; setTextMenu(null); void readClipboardText().then((text) => replaceSelection(text, start, end)).catch(() => undefined); }}>Lim inn</button>
      <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { setTextMenu(null); textarea.current?.focus(); textarea.current?.select(); }}>Marker alt</button>
      <div className="editor-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { onOpenActions(textMenu.x, textMenu.y, true); setTextMenu(null); }}><FolderInput aria-hidden="true" /> Flytt huskelapp</button>
      <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { onOpenActions(textMenu.x, textMenu.y); setTextMenu(null); }}><MoreHorizontal aria-hidden="true" /> Flere valg</button>
    </ContextMenuSurface>}
  </>;
}

export function ContentPluginPanel({ id, folderPath, filePaths, sidebarVisible, onSidebarVisibilityToggle, onOpenSidebar, onOpenFile, onClose }: {
  id: PluginId;
  folderPath: string;
  filePaths: string[];
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onOpenSidebar: () => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const manifest = pluginById(id)!;
  const isPhone = useLayoutMode() === "phone";
  const folder = usePluginStore((state) => state.config.plugins[id]?.folder ?? manifest.defaultFolder ?? "");
  const publicView = usePluginStore((state) => state.config.plugins[id]?.publicView ?? false);
  const deleteFile = useAppStore((state) => state.deleteFilePath);
  const deleteFolder = useAppStore((state) => state.deleteFolderPath);
  const fileMtimeMs = useAppStore((state) => state.fileMtimeMs);
  const api = createPluginApi(id, folderPath, onOpenFile);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState("");
  const [quickSort, setQuickSort] = useState<"pinned" | "newest" | "oldest" | "title" | "manual">("manual");
  const quickSortChosen = useRef(false);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [mobileReordering, setMobileReordering] = useState(false);
  const { contextMenu: noteMenu, setContextMenu: setNoteMenu } = useContextMenuState<{ path: string; x: number; y: number; moving?: boolean }>();
  const { getLongPressProps: getNoteLongPress } = useLongPressContextMenu<string>((path, x, y) => setNoteMenu({ path, x, y }));
  const [dropTarget, setDropTarget] = useState<{ path: string; edge: "before" | "after" } | null>(null);
  const [noteColumns, setNoteColumns] = useState(() => window.matchMedia("(max-width: 640px)").matches ? 1 : 2);
  const noteGridRef = useRef<HTMLDivElement>(null);
  const noteColumnAssignments = useRef(new Map<string, number>());
  const notePositions = useRef(new Map<string, number>());
  const pointerDrag = useRef<string | null>(null);
  const [groupView, setGroupView] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const updateDraft = (markdown: string | null) => { draftRef.current = markdown; setDraftMarkdown(markdown); };
  const [savedMarkdown, setSavedMarkdown] = useState<string | null>(null);
  const [newNotePath, setNewNotePath] = useState<string | null>(null);
  // Keep a newly created card in the collection until the vault file index
  // catches up. Otherwise an autosave can briefly remove and reinsert it.
  const [pendingNewPath, setPendingNewPath] = useState<string | null>(null);
  const focusedNewNote = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [scanRemaining, setScanRemaining] = useState(0);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "delete" | "category" | "discard" | "move-note"; path?: string; label?: string; field?: string } | null>(null);
  const pendingWrites = useRef(new Map<string, Promise<void>>());
  const quickNoteSavedBodies = useRef(new Map<string, string>());
  const pendingNavigation = useRef<(() => void) | null>(null);
  const paths = useMemo(() => {
    const indexed = filePaths.filter((path) => {
    const relative = path.replace(/\\/g, "/");
    const root = folderPath.replace(/\\/g, "/").replace(/\/$/, "");
    return relative.startsWith(`${root}/${folder}/`);
    });
    return pendingNewPath && !indexed.includes(pendingNewPath) ? [pendingNewPath, ...indexed] : indexed;
  }, [filePaths, folderPath, folder, pendingNewPath]);
  useEffect(() => {
    if (pendingNewPath && filePaths.includes(pendingNewPath)) setPendingNewPath(null);
  }, [filePaths, pendingNewPath]);
  useLayoutEffect(() => {
    if (id !== "quick-notes" || !noteGridRef.current) return;
    const grid = noteGridRef.current;
    const update = () => {
      const width = grid.clientWidth;
      // Keep the same two card columns as the rest of the collection UI.
      // A scrollbar changing the available width must not repeatedly move
      // notes between columns while someone is typing.
      setNoteColumns((previous) => width < 640 ? 1 : width > 720 ? 2 : previous);
    };
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    update();
    return () => observer.disconnect();
  }, [id, groupView, filter]);

  useEffect(() => {
    let current = true;
    const ready = paths.map((path) => entryCache.get(path)).filter((cached) => cached && cached.mtime === fileMtimeMs[cached.entry.path]).map((cached) => cached!.entry);
    setEntries((previous) => retainCollectionEntries(paths, previous, ready));
    const missing = paths.filter((path) => !entryCache.has(path) || entryCache.get(path)!.mtime !== fileMtimeMs[path]);
    setScanRemaining(missing.length);
    void (async () => {
      const loadedNotes: Entry[] = [];
      // Bound vault reads so opening a large collection does not saturate
      // desktop IPC or the remote server. Show cached rows immediately.
      for (let at = 0; at < missing.length && current; at += 24) {
        const batch = await Promise.all(missing.slice(at, at + 24).map(async (path) => {
          try {
            const markdown = await api.readMarkdown(path);
            const metadata = pluginMetadata(markdown);
            if (metadata["scribecat-plugin"] && metadata["scribecat-plugin"] !== id) return null;
            const title = metadata.title || metadata.name || /^#\s+(.+)$/m.exec(splitFrontmatter(markdown).body)?.[1]
              || path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || "";
            const entry = { path, markdown, metadata, title };
            entryCache.set(path, { mtime: fileMtimeMs[path], entry });
            while (entryCache.size > 1_400) entryCache.delete(entryCache.keys().next().value!);
            return entry;
          } catch { return null; }
        }));
        if (current) {
          const loaded = batch.filter((entry): entry is Entry => entry !== null);
          if (id === "quick-notes") loadedNotes.push(...loaded);
          else setEntries((previous) => retainCollectionEntries(paths, previous, loaded));
        }
        if (current) setScanRemaining(Math.max(0, missing.length - at - batch.length));
      }
      if (current && loadedNotes.length) setEntries((previous) => retainCollectionEntries(paths, previous, loadedNotes));
    })();
    return () => { current = false; };
  }, [paths, id, fileMtimeMs]);

  useEffect(() => {
    if (!newNotePath) { focusedNewNote.current = null; return; }
    if (isPhone) return;
    if (focusedNewNote.current === newNotePath) return;
    const field = document.querySelector<HTMLTextAreaElement>(`[data-note-path="${CSS.escape(newNotePath)}"]`);
    if (field) { field.focus(); focusedNewNote.current = newNotePath; }
  }, [newNotePath, entries, isPhone]);
  useEffect(() => {
    if (id === "quick-notes" && !quickSortChosen.current && entries.some((entry) => entry.metadata.order)) setQuickSort("manual");
  }, [id, entries]);
  const draftKey = (path: string | null) => `scribecat:plugin-draft:${folderPath}:${id}:${path ?? "new"}`;
  const openEntry = (entry: Entry) => {
    let savedDraft: string | null = null;
    try { savedDraft = localStorage.getItem(draftKey(entry.path)); } catch { /* unavailable storage */ }
    setCreating(false);
    setSelectedPath(entry.path);
    updateDraft(savedDraft ?? entry.markdown);
    setSavedMarkdown(entry.markdown);
    setShowStats(false);
  };
  useEffect(() => {
    if (draftMarkdown === null || (!creating && !selectedPath)) return;
    try {
      const key = draftKey(creating ? null : selectedPath);
      if (draftMarkdown === savedMarkdown) localStorage.removeItem(key);
      else localStorage.setItem(key, draftMarkdown);
    } catch { /* unavailable storage */ }
  }, [draftMarkdown, savedMarkdown, creating, selectedPath, folderPath, id]);

  const selectedFilter = filter ? JSON.parse(filter) as [string, string] : null;
  const stableNotePosition = (entry: Entry) => {
    let position = notePositions.current.get(entry.path);
    if (position === undefined) {
      position = noteManualPosition(entry.metadata);
      notePositions.current.set(entry.path, position);
    }
    return position;
  };
  const visible = useMemo(() => entries.filter((entry) => {
    const [field, value] = selectedFilter ?? ["", ""];
    if (id === "quick-notes" && field !== "archived" && entry.metadata.archived === "true") return false;
    if (field === "warranty-until" && (!entry.metadata[field] || entry.metadata[field] < new Date().toISOString().slice(0, 10))) return false;
    if (field && field !== "warranty-until" && entry.metadata[field] !== value) return false;
    return `${entry.title} ${entry.markdown}`.toLocaleLowerCase().includes(deferredQuery.toLocaleLowerCase());
  }).sort((a, b) => {
    if (id !== "quick-notes") return 0;
    if (quickSort === "manual") {
      return stableNotePosition(a) - stableNotePosition(b) || a.path.localeCompare(b.path);
    }
    if (quickSort === "title") return noteBody(a.markdown).localeCompare(noteBody(b.markdown), "no") || a.path.localeCompare(b.path);
    if (quickSort === "pinned" && a.metadata.pinned !== b.metadata.pinned) return a.metadata.pinned === "true" ? -1 : 1;
    // Modification time changes on every autosave. It must never change the
    // visible card position when editing an older note.
    const aTime = noteCreatedAt(a.metadata);
    const bTime = noteCreatedAt(b.metadata);
    return (quickSort === "oldest" ? aTime - bTime : bTime - aTime) || a.path.localeCompare(b.path);
  }), [entries, filter, deferredQuery, id, quickSort]);
  const columnOf = (entry: Entry, index: number) => {
    if (noteColumns === 1) return 0;
    const remembered = noteColumnAssignments.current.get(entry.path);
    if (remembered !== undefined) return remembered;
    const stored = Number(entry.metadata["note-column"]);
    if (entry.metadata["note-column"] === "0" || entry.metadata["note-column"] === "1") {
      noteColumnAssignments.current.set(entry.path, stored);
      return stored;
    }
    const initial = index % noteColumns;
    noteColumnAssignments.current.set(entry.path, initial);
    return initial;
  };
  const visibleColumns = id !== "quick-notes" ? [] : filter || deferredQuery
    ? partitionNotes(visible, noteColumns, columnOf)
    : balancedNoteColumns(visible, noteColumns, columnOf, (entry, column) => noteColumnAssignments.current.set(entry.path, column));
  const options: Array<[string, string, string]> = id === "books" ? [["status", "want-to-read", "Vil lese"], ["status", "reading", "Leser"], ["status", "finished", "Lest"]]
    : id === "quick-notes" ? [["pinned", "true", "Festet"], ["archived", "true", "Arkiv"]]
    : id === "inventory" ? [["warranty-until", "active", "Garanti"]]
    : id === "recipes" ? [["favorite", "true", "Favoritter"]] : [];
  const groupLabels: Record<string, string> = { category: "Kategori", author: "Forfatter", series: "Serie", collection: "Samling", location: "Plassering" };
  const fields = id === "books" ? ["category", "author", "series", "collection"] : id === "inventory" ? ["category", "location"] : id === "recipes" || id === "quick-notes" ? ["category"] : [];
  for (const field of fields) for (const value of new Set(entries.map((entry) => entry.metadata[field]).filter(Boolean))) options.push([field, value, `${groupLabels[field]}: ${value}`]);
  const groupNames: Record<string, string> = { category: "Kategorier", author: "Forfattere", series: "Serier", collection: "Samlinger", location: "Plasseringer" };

  const add = async (title: string, markdown = newPluginDocument(id, title)): Promise<string | null> => {
    if (!title?.trim()) return null;
    const name = safeDocumentName(title);
    const root = await join(folderPath, ...folder.split("/"));
    let entryFolder = await join(root, name);
    let number = 2;
    while (await exists(entryFolder).catch(() => false) || filePaths.some((existing) => existing.toLocaleLowerCase().startsWith(`${entryFolder.toLocaleLowerCase()}/`))) {
      entryFolder = await join(root, `${name} ${number++}`);
    }
    const path = await join(entryFolder, `${entryFolder.split(/[\\/]/).pop()}.md`);
    let uniqueMarkdown = setPluginField(markdown, "slug", pluginSlug(entryFolder.split(/[\\/]/).pop() || title));
    if (id === "quick-notes") {
      uniqueMarkdown = setPluginField(uniqueMarkdown, "order", String(nextNoteTopOrder(entries)));
      const selectedCategory = filter ? JSON.parse(filter) as [string, string] : null;
      if (selectedCategory?.[0] === "category") uniqueMarkdown = setPluginField(uniqueMarkdown, "category", selectedCategory[1]);
      setQuickSort("manual");
    }
    try {
      setSavingNew(true);
      if (await api.saveMarkdown(path, uniqueMarkdown)) {
        if (manifest.capabilities.includes("attachments")) await mkdir(await join(entryFolder, "_attachments"), { recursive: true });
        if (id === "quick-notes") {
          const optimistic = { path, markdown: uniqueMarkdown, metadata: pluginMetadata(uniqueMarkdown), title };
          notePositions.current.set(path, noteManualPosition(optimistic.metadata));
          // Existing columns must not be redistributed when the new file
          // arrives through the async file index or autosave echo.
          noteColumnAssignments.current.set(path, 0);
          entryCache.set(path, { mtime: fileMtimeMs[path], entry: optimistic });
          setPendingNewPath(path);
          setEntries((items) => [optimistic, ...items.filter((item) => item.path !== path)]);
          setNewNotePath(path);
          setSelectedPath(null);
          updateDraft(null);
          setSavedMarkdown(null);
        } else {
          setSelectedPath(path);
          updateDraft(uniqueMarkdown);
          setSavedMarkdown(uniqueMarkdown);
        }
        setCreating(false);
        try { localStorage.removeItem(draftKey(null)); } catch { /* unavailable storage */ }
        setError("");
        return path;
      }
      else setError("Kunne ikke opprette dokumentet.");
    } catch { setError("Kunne ikke opprette dokumentet."); }
    finally { setSavingNew(false); }
    return null;
  };

  const requestAdd = () => navigate(() => {
    if (id === "quick-notes") void add(`Huskelapp ${new Date().toLocaleString("sv-SE").replace(/[ :]/g, "-")}`);
    else {
      setSelectedPath(null);
      setCreating(true);
      let savedDraft: string | null = null;
      try { savedDraft = localStorage.getItem(draftKey(null)); } catch { /* unavailable storage */ }
      updateDraft(savedDraft ?? newPluginDocument(id, ""));
      setSavedMarkdown(null);
      setShowStats(false);
    }
  });

  const discard = () => {
    try { localStorage.removeItem(draftKey(creating ? null : selectedPath)); } catch { /* unavailable storage */ }
    setCreating(false); setSelectedPath(null); updateDraft(null); setSavedMarkdown(null); setDialog(null);
  };
  const cancelEdit = () => {
    if (creating) { discard(); return; }
    if (selectedPath) {
      try { localStorage.removeItem(draftKey(selectedPath)); } catch { /* unavailable storage */ }
      updateDraft(savedMarkdown);
    }
  };
  const back = () => {
    if (draftMarkdown !== null && draftMarkdown !== savedMarkdown && (savedMarkdown !== null || pluginMetadata(draftMarkdown).title || pluginMetadata(draftMarkdown).name)) {
      setDialog({ kind: "discard" });
    } else discard();
  };
  function navigate(action: () => void) {
    if (draftRef.current !== null && draftRef.current !== savedMarkdown && (savedMarkdown !== null || pluginMetadata(draftRef.current).title || pluginMetadata(draftRef.current).name)) {
      pendingNavigation.current = action;
      setDialog({ kind: "discard" });
    } else action();
  }
  const saveDraft = async () => {
    if (savingNew) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".plugin-detail")) active.blur();
    const content = draftRef.current;
    if (content === null) return;
    const metadata = pluginMetadata(content);
    if (creating) {
      const title = (metadata.title || metadata.name || "").trim();
      if (!title) { setError("Gi oppføringen et navn før du lagrer."); return; }
      await add(title, setPluginField(content, "slug", pluginSlug(title)));
      return;
    }
    if (!selectedPath) return;
    const existing = entries.find((entry) => entry.path === selectedPath);
    if (!existing) return;
    setSavingNew(true);
    try {
      const current = await api.readMarkdown(selectedPath);
      if (current !== savedMarkdown) throw new Error("Dokumentet ble endret utenfor denne visningen. Utkastet er beholdt.");
      if (!await api.saveMarkdown(selectedPath, content)) throw new Error("Lagring mislyktes");
      setEntries((items) => items.map((item) => item.path === selectedPath ? {
        ...item, markdown: content, metadata, title: metadata.title || metadata.name || item.title
      } : item));
      setSavedMarkdown(content);
      entryCache.set(selectedPath, { mtime: fileMtimeMs[selectedPath], entry: { ...existing, markdown: content, metadata, title: metadata.title || metadata.name || existing.title } });
      try { localStorage.removeItem(draftKey(selectedPath)); } catch { /* unavailable storage */ }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kunne ikke lagre endringen. Utkastet er beholdt."); }
    finally { setSavingNew(false); }
  };

  const change = async (entry: Entry, update: string | ((current: string) => string)) => {
    const openDocument = useAppStore.getState().fileDocuments[entry.path];
    if (openDocument && openDocument.content !== openDocument.baseContent) {
      setError("Lagre åpne endringer i dokumentet før du endrer kortet.");
      return false;
    }
    const previous = pendingWrites.current.get(entry.path) ?? Promise.resolve();
    let succeeded = true;
    const next = previous.catch(() => undefined).then(async () => {
      const current = await api.readMarkdown(entry.path);
      if (typeof update === "string" && current !== entry.markdown) throw new Error("Dokumentet ble endret utenfor denne visningen.");
      const markdown = typeof update === "function" ? update(current) : update;
      if (!await api.saveMarkdown(entry.path, markdown)) throw new Error("Save failed");
      const metadata = pluginMetadata(markdown);
      entryCache.set(entry.path, { mtime: fileMtimeMs[entry.path], entry: { ...entry, markdown, metadata, title: metadata.title || metadata.name || entry.title } });
      setEntries((items) => items.map((item) => item.path === entry.path
        ? { ...item, markdown, metadata, title: metadata.title || metadata.name || item.title } : item));
      setError("");
    }).catch((cause) => { succeeded = false; setError(cause instanceof Error && (cause.message === "Dokumentet ble endret utenfor denne visningen." || cause.message.startsWith("Huskelappen er endret")) ? cause.message : "Kunne ikke lagre endringen."); });
    pendingWrites.current.set(entry.path, next);
    await next;
    if (pendingWrites.current.get(entry.path) === next) pendingWrites.current.delete(entry.path);
    return succeeded;
  };

  const selected = entries.find((entry) => entry.path === selectedPath);
  // The indicator and the saved order use this exact same insertion point.
  // Looking at card centres also gives the gap between cards a usable target.
  const noteDropAt = (column: HTMLElement, y: number, source: string) => {
    const cards = [...column.querySelectorAll<HTMLElement>("[data-note-drop-path]")].map((card) => {
      const rect = card.getBoundingClientRect();
      return { path: card.dataset.noteDropPath!, midpoint: rect.top + rect.height / 2 };
    });
    return noteDropPlacement(cards, y, source);
  };
  const moveNote = async (targetPath: string, sourcePath = draggedPath, edge: "before" | "after" = "before") => {
    if (!sourcePath || sourcePath === targetPath) return;
    const sourceColumn = visibleColumns.findIndex((column) => column.some((item) => item.path === sourcePath));
    const targetColumn = visibleColumns.findIndex((column) => column.some((item) => item.path === targetPath));
    if (sourceColumn < 0 || targetColumn < 0) return;
    const columns = moveNoteColumns(visibleColumns.map((column) => column.map((item) => item.path)), sourcePath, targetPath, edge);
    if (noteColumns > 1) noteColumnAssignments.current.set(sourcePath, targetColumn);
    setQuickSort("manual");
    const placements = new Map(columns.flatMap((column, col) => column.map((path, index) => [path, { order: String((index + 1) * 1024), column: String(col) }] as const)));
    for (const [path, placement] of placements) notePositions.current.set(path, Number(placement.order));
    setEntries((items) => items.map((item) => {
      const placement = placements.get(item.path);
      return placement ? { ...item, metadata: { ...item.metadata, order: placement.order, ...(noteColumns > 1 ? { "note-column": placement.column } : {}) } } : item;
    }));
    const changed = entries.filter((item) => {
      const placement = placements.get(item.path);
      return placement && (item.metadata.order !== placement.order || (noteColumns > 1 && item.metadata["note-column"] !== placement.column));
    });
    for (let at = 0; at < changed.length; at += 8) {
      await Promise.all(changed.slice(at, at + 8).map((item) => change(item, (markdown) => {
        const placement = placements.get(item.path)!;
        const ordered = setPluginField(markdown, "order", placement.order);
        return noteColumns > 1 ? setPluginField(ordered, "note-column", placement.column) : ordered;
      })));
    }
    setDraggedPath(null);
    setDropTarget(null);
  };
  const editingEntry: Entry | null = creating && draftMarkdown !== null ? {
    path: "", markdown: draftMarkdown, metadata: pluginMetadata(draftMarkdown), title: ""
  } : selected && draftMarkdown !== null ? {
    ...selected, markdown: draftMarkdown, metadata: pluginMetadata(draftMarkdown)
  } : null;

  const selectFilter = (value: string, group: string | null = null) => navigate(() => { setFilter(value); setGroupView(group); setShowStats(false); setSelectedPath(null); setCreating(false); updateDraft(null); setSecondaryOpen(false); });
  const menuEntry = noteMenu ? entries.find((item) => item.path === noteMenu.path) : null;
  const noteCategories = [...new Set(entries.map((item) => item.metadata.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
  const renderEntry = (entry: Entry) => {
    const longPress = getNoteLongPress(entry.path);
    return <article key={entry.path} data-note-drop-path={id === "quick-notes" ? entry.path : undefined} data-scribecat-long-press={id === "quick-notes" ? "true" : undefined} className={`content-plugin-panel__card${dropTarget?.path === entry.path ? ` content-plugin-panel__card--drop-${dropTarget.edge}` : ""}`}
          onPointerDown={(event) => {
            if (id !== "quick-notes" || event.target instanceof Element && event.target.closest("textarea,input,button,a")) return;
            const box = event.currentTarget.getBoundingClientRect();
            const onRim = Math.min(event.clientX - box.left, box.right - event.clientX, event.clientY - box.top, box.bottom - event.clientY) <= 12;
            if (!isPhone && onRim && event.button === 0) { pointerDrag.current = entry.path; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
            else longPress.onPointerDown(event);
          }}
          onPointerMove={(event) => { if (!pointerDrag.current) { longPress.onPointerMove(event); return; } const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-column]"); const target = column ? noteDropAt(column, event.clientY, pointerDrag.current) : null; setDropTarget((old) => old?.path === target?.path && old?.edge === target?.edge ? old : target); }}
          onPointerUp={(event) => { if (!pointerDrag.current) { longPress.onPointerUp(event); return; } const source = pointerDrag.current; pointerDrag.current = null; const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-column]"); const target = column ? noteDropAt(column, event.clientY, source) : null; setDropTarget(null); if (target) void moveNote(target.path, source, target.edge); }}
          onPointerCancel={(event) => { pointerDrag.current = null; setDropTarget(null); longPress.onPointerCancel(event); }}
          onClickCapture={id === "quick-notes" ? longPress.onClickCapture : undefined}
          onContextMenuCapture={(event) => { if (id === "quick-notes" && !(event.target instanceof Element && event.target.closest("textarea,input,a"))) longPress.onContextMenuCapture(event); }}
          onContextMenu={(event) => { if (id !== "quick-notes") return; if (event.target instanceof Element && event.target.closest("textarea,input,a")) return; event.preventDefault(); event.stopPropagation(); setNoteMenu({ path: entry.path, x: event.clientX, y: event.clientY }); }}
          onDragStart={(event) => { if (id !== "quick-notes" || !(event.target instanceof Element && event.target.closest(".content-plugin-panel__note-handle"))) { event.preventDefault(); return; } setDraggedPath(entry.path); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.path); }} onDragEnd={() => { setDraggedPath(null); setDropTarget(null); }}>
          {id !== "quick-notes" && <button className="content-plugin-panel__tile" onClick={() => openEntry(entry)}>
            {entry.metadata.cover && (id === "books" || id === "recipes" || id === "inventory")
              ? <PluginCover id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt={entry.title} />
              : <span className="content-plugin-panel__placeholder" aria-hidden="true">{id === "books" ? <BookOpen /> : id === "recipes" ? <CookingPot /> : id === "inventory" ? <Package /> : <ShoppingBasket />}</span>}
            <strong>{entry.metadata.title || entry.metadata.name || entry.title}</strong>
            {id !== "recipes" && <span>{[entry.metadata.author, id === "books" ? ({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest" } as Record<string, string>)[entry.metadata.status] : "", entry.metadata.category, entry.metadata.location].filter(Boolean).join(" · ")}</span>}
            {(id === "recipes" || id === "books" || id === "inventory") && readingCardSummary(id, entry.markdown) && <p className="content-plugin-panel__tile-description">{readingCardSummary(id, entry.markdown)}</p>}
          </button>}
          {id === "quick-notes" ? <>
            <QuickNoteCard entry={entry} initialEdit={!isPhone && newNotePath === entry.path} onSave={async (text, expected) => {
              const saved = await change(entry, (current) => {
                const currentBody = noteBody(current);
                if (currentBody !== noteBody(expected) && currentBody !== quickNoteSavedBodies.current.get(entry.path)) {
                  throw new Error("Huskelappen er endret utenfor denne visningen. Teksten din er beholdt i skrivefeltet.");
                }
                return updateQuickNoteBody(current, text);
              });
              if (saved) { quickNoteSavedBodies.current.set(entry.path, text); setNewNotePath(null); }
              return saved;
            }} onCategoryChange={(category) => { void change(entry, (markdown) => setPluginField(markdown, "category", category)); }} onOpenActions={(x, y, moving = false) => setNoteMenu({ path: entry.path, x, y, moving })}>
            {(!isPhone || mobileReordering) && <button type="button" draggable={!isPhone} className="content-plugin-panel__note-handle" aria-label="Dra huskelappen for å endre rekkefølge" title="Dra til en annen huskelapp eller kategori" onPointerDown={(event) => { if (!isPhone) return; pointerDrag.current = entry.path; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!pointerDrag.current) return; const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-column]"); const target = column ? noteDropAt(column, event.clientY, pointerDrag.current) : null; setDropTarget((old) => old?.path === target?.path && old?.edge === target?.edge ? old : target); }} onPointerUp={(event) => {
              const source = pointerDrag.current;
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-column], [data-quick-category]");
              pointerDrag.current = null;
              setDropTarget(null);
              if (!source || !target) return;
              if (target.dataset.noteColumn) { const placement = noteDropAt(target, event.clientY, source); if (placement) void moveNote(placement.path, source, placement.edge); }
              else if (target.dataset.quickCategory) { const item = entries.find((row) => row.path === source); if (item) void change(item, (markdown) => setPluginField(markdown, "category", target.dataset.quickCategory!)); }
            }} onPointerCancel={() => { pointerDrag.current = null; setDropTarget(null); }}><GripVertical size={17} /></button>}
            <button aria-label={entry.metadata.pinned === "true" ? "Løsne huskelapp" : "Fest huskelapp"} title={entry.metadata.pinned === "true" ? "Løsne" : "Fest"} aria-pressed={entry.metadata.pinned === "true"} onClick={() => void change(entry, (markdown) => setPluginField(markdown, "pinned", pluginMetadata(markdown).pinned !== "true"))}><Pin size={16} /></button>
            <button aria-label={entry.metadata.archived === "true" ? "Gjenopprett huskelapp" : "Arkiver huskelapp"} title={entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"} onClick={() => void change(entry, (markdown) => setPluginField(markdown, "archived", pluginMetadata(markdown).archived !== "true"))}>{entry.metadata.archived === "true" ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
            <button className="content-plugin-panel__note-delete" aria-label="Slett huskelapp" title="Slett" onClick={() => setDialog({ kind: "delete", path: entry.path, label: "huskelappen" })}><Trash2 size={16} /></button>
            <button type="button" className="content-plugin-panel__note-more" aria-label="Flere valg for huskelapp" title="Flere valg" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setNoteMenu({ path: entry.path, x: rect.right, y: rect.bottom }); }}><MoreHorizontal size={16} /></button>
            </QuickNoteCard>
          </> : null}
        </article>;

  };
  return <main className="content-plugin-panel">
    <PluginTopbar title={manifest.name} icon={id} isPhone={isPhone} sidebarVisible={sidebarVisible} onSidebarVisibilityToggle={onSidebarVisibilityToggle} onOpenSidebar={onOpenSidebar} onClose={onClose} />
    <div className="content-plugin-panel__layout">
      <aside className={`content-plugin-panel__rail${secondaryOpen ? " content-plugin-panel__rail--open" : ""}`} aria-label={`${manifest.name} navigasjon`}>
        <div className="content-plugin-panel__rail-group">
          <Button variant="outline" className="content-plugin-panel__new" onClick={requestAdd}><Plus size={16} /> {id === "books" ? "Ny bok" : id === "recipes" ? "Ny oppskrift" : id === "inventory" ? "Ny gjenstand" : id === "shopping" ? "Ny handleliste" : "Ny huskelapp"}</Button>
          <button className={!editingEntry && !showStats && !filter && !groupView ? "active" : ""} onClick={() => selectFilter("")}>Alle <span>{entries.length}</span></button>
          {id !== "quick-notes" && id !== "shopping" && <button className={showStats ? "active" : ""} onClick={() => navigate(() => { setShowStats(true); setSelectedPath(null); setCreating(false); updateDraft(null); setSecondaryOpen(false); })}><ChartNoAxesCombined size={16} /> Statistikk</button>}
        </div>
        {id === "shopping" && <div className="content-plugin-panel__rail-group"><strong>Handlelister</strong>{entries.map((entry) => <button key={entry.path} className={selectedPath === entry.path ? "active" : ""} onClick={() => navigate(() => openEntry(entry))}>{entry.title}</button>)}</div>}
        {fields.length > 0 && <div className="content-plugin-panel__rail-group"><strong>Utforsk</strong>{fields.map((field) => <button key={field} className={groupView === field ? "active" : ""} onClick={() => selectFilter("", field)}>{groupNames[field]}<span>{new Set(entries.map((entry) => entry.metadata[field]).filter(Boolean)).size}</span></button>)}</div>}
        {id === "quick-notes" && [...new Set(entries.map((entry) => entry.metadata.category).filter(Boolean))].sort().map((category) => <button key={category} data-quick-category={category} className={filter === JSON.stringify(["category", category]) ? "active" : ""} onClick={() => selectFilter(JSON.stringify(["category", category]))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const path = draggedPath || event.dataTransfer.getData("text/plain"); const entry = entries.find((item) => item.path === path); if (entry) void change(entry, (markdown) => setPluginField(markdown, "category", category)); setDraggedPath(null); }}>{category}</button>)}
        {id === "quick-notes" && options.length > 0 && <div className="content-plugin-panel__rail-group"><strong>Vis</strong>{options.slice(0, 2).map(([field, value, label]) => {
          const key = JSON.stringify([field, value]);
          return <button key={key} className={filter === key ? "active" : ""} onClick={() => selectFilter(key)}>{label}<span>{entries.filter((entry) => entry.metadata[field] === value).length}</span></button>;
        })}</div>}
        {!fields.length && id !== "shopping" && options.length > 0 && <div className="content-plugin-panel__rail-group"><strong>Utforsk</strong>{options.map(([field, value, label]) => {
          const key = JSON.stringify([field, value]);
          return <button key={key} className={filter === key ? "active" : ""} onClick={() => selectFilter(key)}>{label}<span>{entries.filter((entry) => entry.metadata[field] === value).length}</span></button>;
        })}</div>}
      </aside>
    <div className="content-plugin-panel__body">
      {isPhone && id === "quick-notes" && <button type="button" className="content-plugin-panel__quick-add" onClick={requestAdd} aria-label="Ny huskelapp" title="Ny huskelapp"><Plus /></button>}
      {error ? <p role="alert">{error}</p> : null}
      {scanRemaining > 0 && <p className="content-plugin-panel__loading" role="status">Laster {scanRemaining} oppføringer …</p>}
      {editingEntry && id !== "quick-notes" ? <ContentPluginDetail id={id} entry={editingEntry} vaultPath={folderPath} publicView={publicView}
        isNew={creating} dirty={draftMarkdown !== savedMarkdown} saving={savingNew} onSave={() => void saveDraft()}
        onBack={back} onCancelEdit={cancelEdit} onChange={async (next) => { updateDraft(next); }} onDelete={() => selected && setDialog({ kind: "delete", path: selected.path, label: selected.title })} /> : <>
      {showStats ? <PluginStatistics id={id} entries={entries} onBack={() => setShowStats(false)} onOpen={(path) => { const entry = entries.find((item) => item.path === path); if (entry) openEntry(entry); }} /> : <>
      <div className="content-plugin-panel__overview"><div><span className="content-plugin-panel__eyebrow">SAMLING</span><h2>{selectedFilter?.[1] || (groupView ? groupNames[groupView] : manifest.name)}</h2><p>{scanRemaining > 0 ? `Laster … ${visible.length} vist` : `${visible.length} ${visible.length === 1 ? "oppføring" : "oppføringer"}`}</p></div></div>
      <div className={`content-plugin-panel__controls${id === "quick-notes" ? " content-plugin-panel__controls--quick-notes" : ""}`}><div className="content-plugin-panel__search"><Search size={16} aria-hidden="true" /><input type="text" inputMode="search" aria-label={`Søk i ${manifest.name.toLocaleLowerCase()}`} value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Tøm søk" onClick={() => setQuery("")}><span aria-hidden="true">×</span></button>}</div>
      {!groupView && options.length && id !== "shopping" ? <label className="content-plugin-panel__select"><span>Vis</span><select aria-label="Filtrer oppføringer" value={filter} onChange={(event) => { setGroupView(null); setFilter(event.target.value); }}><option value="">Alle</option>{options.map(([field, value, label]) => <option value={JSON.stringify([field, value])} key={`${field}:${value}`}>{label}</option>)}</select></label> : null}
      {id === "quick-notes" && <label className="content-plugin-panel__select"><span>Sorter</span><select aria-label="Sorter huskelapper" value={quickSort} onChange={(event) => { quickSortChosen.current = true; setQuickSort(event.target.value as typeof quickSort); }}><option value="pinned">Festede først</option><option value="newest">Nyeste først</option><option value="oldest">Eldste først</option><option value="title">Alfabetisk</option><option value="manual">Egen rekkefølge</option></select></label>}
      {selectedFilter && fields.includes(selectedFilter[0]) && <button className="content-plugin-panel__delete-filter" onClick={() => setDialog({ kind: "category", field: selectedFilter[0], label: selectedFilter[1] })}>Slett {groupLabels[selectedFilter[0]].toLocaleLowerCase()}</button>}</div>
      {id === "quick-notes" && isPhone && mobileReordering && <div className="content-plugin-panel__reorder-banner" role="status"><GripVertical size={17} /><span>Dra i håndtaket for å flytte huskelapper.</span><button type="button" onClick={() => { pointerDrag.current = null; setDropTarget(null); setMobileReordering(false); }}>Ferdig</button></div>}
      {id === "quick-notes" && <datalist id="quick-note-categories">{[...new Set(entries.map((entry) => entry.metadata.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no")).map((name) => <option key={name} value={name} />)}</datalist>}
      {groupView && !filter ? <div className="content-plugin-panel__grid content-plugin-panel__groups">{[...new Set(entries.map((entry) => entry.metadata[groupView]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no")).map((value) => {
        const members = entries.filter((entry) => entry.metadata[groupView] === value);
        return <button className="content-plugin-panel__group-card" key={value} onClick={() => selectFilter(JSON.stringify([groupView, value]), groupView)}><span className={`content-plugin-panel__mosaic${id === "quick-notes" ? " content-plugin-panel__mosaic--notes" : ""}`}>{id === "quick-notes" ? members.slice(0, 4).map((entry) => <span key={entry.path}>{noteBody(entry.markdown) || "Huskelapp"}</span>) : members.filter((entry) => entry.metadata.cover).slice(0, 4).map((entry) => <PluginCover key={entry.path} id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt="" />)}</span><strong>{value}</strong><small>{members.length} {members.length === 1 ? "oppføring" : "oppføringer"}</small></button>;
      })}</div> : <div ref={noteGridRef} className={`content-plugin-panel__grid content-plugin-panel__grid--${id}`} style={id === "quick-notes" ? { gridTemplateColumns: `repeat(${noteColumns}, minmax(0, 1fr))` } : undefined}>{id === "quick-notes" ? visibleColumns.map((column, index) => <div className={`content-plugin-panel__note-column${dropTarget && column.some((entry) => entry.path === dropTarget.path) ? " content-plugin-panel__note-column--target" : ""}`} data-note-column={index} key={index} onDragOver={(event) => { const source = draggedPath || event.dataTransfer.getData("text/plain"); if (!source) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; const placement = noteDropAt(event.currentTarget, event.clientY, source); setDropTarget((old) => old?.path === placement?.path && old?.edge === placement?.edge ? old : placement); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }} onDrop={(event) => { const source = draggedPath || event.dataTransfer.getData("text/plain"); if (!source) return; event.preventDefault(); const placement = noteDropAt(event.currentTarget, event.clientY, source); if (placement) void moveNote(placement.path, source, placement.edge); setDropTarget(null); }}>{column.map(renderEntry)}</div>) : visible.map(renderEntry)}</div>}
      {visible.length === 0 && scanRemaining === 0 ? <p>Ingen oppføringer her ennå.</p> : null}
      </>}
      </>}
    </div></div>
    {noteMenu && menuEntry && <ContextMenuSurface x={noteMenu.x} y={noteMenu.y} className="quick-note-context-menu" title="Huskelapp" onClick={(event) => event.stopPropagation()}>
      {noteMenu.moving ? <>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => setNoteMenu({ ...noteMenu, moving: false })}><ArrowLeft aria-hidden="true" /> Tilbake</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { void change(menuEntry, (markdown) => setPluginField(markdown, "category", "")); setNoteMenu(null); }}>Uten kategori</button>
        {noteCategories.map((category) => <button key={category} type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { void change(menuEntry, (markdown) => setPluginField(markdown, "category", category)); setNoteMenu(null); }}>{category}</button>)}
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { setDialog({ kind: "move-note", path: menuEntry.path, label: menuEntry.title }); setNoteMenu(null); }}><Plus aria-hidden="true" /> Ny kategori …</button>
      </> : <>
        {isPhone && <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { setMobileReordering(true); setQuickSort("manual"); setNoteMenu(null); }}><GripVertical aria-hidden="true" /> Dra for å flytte</button>}
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { setNoteMenu({ ...noteMenu, moving: true }); }}><FolderInput aria-hidden="true" /> Flytt til kategori</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { const first = visibleColumns.find((column) => column.some((item) => item.path === menuEntry.path))?.[0]; setNoteMenu(null); if (first) void moveNote(first.path, menuEntry.path, "before"); }}>Flytt øverst</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { const column = visibleColumns.find((items) => items.some((item) => item.path === menuEntry.path)); const last = column?.[column.length - 1]; setNoteMenu(null); if (last) void moveNote(last.path, menuEntry.path, "after"); }}>Flytt nederst</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { void change(menuEntry, (markdown) => setPluginField(markdown, "pinned", pluginMetadata(markdown).pinned !== "true")); setNoteMenu(null); }}><Pin aria-hidden="true" /> {menuEntry.metadata.pinned === "true" ? "Løsne" : "Fest"}</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => { void change(menuEntry, (markdown) => setPluginField(markdown, "archived", pluginMetadata(markdown).archived !== "true")); setNoteMenu(null); }}><Archive aria-hidden="true" /> {menuEntry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"}</button>
        <button type="button" role="menuitem" className="file-tree-context-menu__item file-tree-context-menu__item--danger" onClick={() => { setDialog({ kind: "delete", path: menuEntry.path, label: "huskelappen" }); setNoteMenu(null); }}><Trash2 aria-hidden="true" /> Slett</button>
      </>}
    </ContextMenuSurface>}
    {dialog && <PluginDialog key={`${dialog.kind}-${dialog.path ?? dialog.label ?? ""}`} title={dialog.kind === "move-note" ? "Flytt huskelapp til ny kategori" : dialog.kind === "discard" ? "Forkaste endringer som ikke er lagret?" : dialog.kind === "category" ? `Slette ${groupLabels[dialog.field ?? "category"]?.toLocaleLowerCase() ?? "verdien"} «${dialog.label}»?` : `Flytte «${dialog.label}» til papirkurven?`}
      label={dialog.kind === "move-note" ? "Kategorinavn" : undefined}
      confirmLabel={dialog.kind === "move-note" ? "Flytt" : dialog.kind === "discard" ? "Forkast" : "Slett"} destructive={dialog.kind !== "move-note"}
      onCancel={() => { pendingNavigation.current = null; setDialog(null); }} onConfirm={(value) => {
        const action = dialog;
        setDialog(null);
        if (action.kind === "move-note" && action.path) { const entry = entries.find((item) => item.path === action.path); if (entry) void change(entry, (markdown) => setPluginField(markdown, "category", value)); return; }
        if (action.kind === "discard") { const next = pendingNavigation.current; pendingNavigation.current = null; discard(); next?.(); return; }
        if (action.kind === "delete" && action.path) {
          if (pendingWrites.current.has(action.path)) { setError("Vent til endringen er lagret før du sletter."); return; }
          void (async () => {
            const entryFolder = await dirname(action.path!);
            const ownFolder = entryFolder.split(/[\\/]/).pop() === action.path!.split(/[\\/]/).pop()?.replace(/\.md$/i, "");
            return ownFolder ? deleteFolder(entryFolder) : deleteFile(action.path!);
        })().then((ok) => { if (ok) { quickNoteSavedBodies.current.delete(action.path!); setEntries((items) => items.filter((item) => item.path !== action.path)); discard(); } else setError("Kunne ikke slette oppføringen."); });
        }
        if (action.kind === "category" && action.label && action.field && fields.includes(action.field)) {
          setFilter("");
          for (const entry of entries) {
            if (entry.metadata[action.field] === action.label) void change(entry, (markdown) => setPluginField(markdown, action.field!, ""));
          }
        }
      }} />}
  </main>;
}
