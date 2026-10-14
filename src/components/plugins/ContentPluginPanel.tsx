import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Home, PanelLeft, Plus, Search, ChartNoAxesCombined, Pencil, Save, X, Trash2, BookOpen, CookingPot, Package, ShoppingBasket } from "lucide-react";

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

type Entry = { path: string; markdown: string; metadata: Record<string, string>; title: string };
const entryCache = new Map<string, { mtime: number; entry: Entry }>();
function noteBody(markdown: string) { return splitFrontmatter(markdown).body.replace(/^#\s+[^\n]*\n*/, "").trim(); }
function QuickNoteCard({ entry, initialEdit, onSave, onDelete }: { entry: Entry; initialEdit: boolean; onSave: (markdown: string, expected: string) => Promise<boolean>; onDelete: () => void }) {
  const draftKey = `scribecat:quick-note-draft:${entry.path}`;
  const restored = useRef<{ value: string } | null>(null);
  if (restored.current === null) {
    try { restored.current = { value: localStorage.getItem(draftKey) ?? "" }; } catch { restored.current = { value: "" }; }
  }
  const [editing, setEditing] = useState(initialEdit || !!restored.current.value);
  const [draft, setDraft] = useState(() => restored.current!.value || noteBody(entry.markdown));
  const [saving, setSaving] = useState(false);
  const baseline = useRef(entry.markdown);
  const saved = noteBody(entry.markdown);
  useEffect(() => { if (initialEdit) setEditing(true); }, [initialEdit]);
  useEffect(() => { if (!editing) setDraft(saved); }, [saved, editing]);
  useEffect(() => {
    try {
      if (editing && draft !== saved) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch { /* Storage can be unavailable in private mode. */ }
  }, [draft, saved, editing, draftKey]);
  const save = async () => {
    setSaving(true);
    try {
      const body = splitFrontmatter(baseline.current).body;
      const markdown = baseline.current.slice(0, baseline.current.length - body.length) + `\n${draft.trim()}\n`;
      if (await onSave(markdown, baseline.current)) { baseline.current = markdown; setEditing(false); }
    } finally { setSaving(false); }
  };
  return <div className="content-plugin-panel__note">
    {editing ? <><textarea data-note-path={entry.path} aria-label="Huskelapp" value={draft} placeholder="Skriv noe …" onChange={(event) => setDraft(event.target.value)} autoFocus={initialEdit} />
      <div className="content-plugin-panel__note-actions"><button disabled={saving} onClick={() => { setDraft(saved); baseline.current = entry.markdown; setEditing(false); }}><X size={14} /> Avbryt</button><button disabled={saving || draft === saved} onClick={() => void save()}><Save size={14} /> Lagre</button></div></>
      : <><button className="content-plugin-panel__note-preview" onClick={() => { baseline.current = entry.markdown; setEditing(true); }}>{saved || "Tom huskelapp"}</button><div className="content-plugin-panel__note-actions"><button aria-label="Rediger huskelapp" onClick={() => { baseline.current = entry.markdown; setEditing(true); }}><Pencil size={15} /></button><button aria-label="Slett huskelapp" onClick={onDelete}><Trash2 size={15} /></button></div></>}
  </div>;
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const updateDraft = (markdown: string | null) => { draftRef.current = markdown; setDraftMarkdown(markdown); };
  const [savedMarkdown, setSavedMarkdown] = useState<string | null>(null);
  const [newNotePath, setNewNotePath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "delete" | "category" | "discard"; path?: string; label?: string; field?: string } | null>(null);
  const pendingWrites = useRef(new Map<string, Promise<void>>());
  const paths = useMemo(() => filePaths.filter((path) => {
    const relative = path.replace(/\\/g, "/");
    const root = folderPath.replace(/\\/g, "/").replace(/\/$/, "");
    return relative.startsWith(`${root}/${folder}/`);
  }), [filePaths, folderPath, folder]);

  useEffect(() => {
    let current = true;
    const ready = paths.map((path) => entryCache.get(path)).filter((cached) => cached && cached.mtime === fileMtimeMs[cached.entry.path]).map((cached) => cached!.entry);
    setEntries(ready);
    const missing = paths.filter((path) => !entryCache.has(path) || entryCache.get(path)!.mtime !== fileMtimeMs[path]);
    void (async () => {
      // Bound vault reads so opening a large collection does not saturate
      // desktop IPC or the remote server. Show cached rows immediately.
      for (let at = 0; at < missing.length && current; at += 8) {
        const batch = await Promise.all(missing.slice(at, at + 8).map(async (path) => {
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
        if (current) setEntries((previous) => {
          const all = new Map(previous.map((entry) => [entry.path, entry]));
          for (const entry of batch) if (entry) all.set(entry.path, entry);
          return paths.flatMap((path) => all.has(path) ? [all.get(path)!] : []);
        });
      }
    })();
    return () => { current = false; };
  }, [paths, id, fileMtimeMs]);

  useEffect(() => {
    if (newNotePath) document.querySelector<HTMLTextAreaElement>(`[data-note-path="${CSS.escape(newNotePath)}"]`)?.focus();
  }, [newNotePath, entries]);
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
  const visible = useMemo(() => entries.filter((entry) => {
    const [field, value] = selectedFilter ?? ["", ""];
    if (id === "quick-notes" && field !== "archived" && entry.metadata.archived === "true") return false;
    if (field === "warranty-until" && (!entry.metadata[field] || entry.metadata[field] < new Date().toISOString().slice(0, 10))) return false;
    if (field && field !== "warranty-until" && entry.metadata[field] !== value) return false;
    return `${entry.title} ${entry.markdown}`.toLocaleLowerCase().includes(deferredQuery.toLocaleLowerCase());
  }), [entries, filter, deferredQuery, id]);
  const options: Array<[string, string, string]> = id === "books" ? [["status", "want-to-read", "Vil lese"], ["status", "reading", "Leser"], ["status", "finished", "Lest"]]
    : id === "quick-notes" ? [["pinned", "true", "Festet"], ["archived", "true", "Arkiv"]]
    : id === "inventory" ? [["warranty-until", "active", "Garanti"]]
    : id === "recipes" ? [["favorite", "true", "Favoritter"]] : [];
  const groupLabels: Record<string, string> = { category: "Kategori", author: "Forfatter", series: "Serie", collection: "Samling", location: "Plassering" };
  const fields = id === "books" ? ["category", "author", "series", "collection"] : id === "inventory" ? ["category", "location"] : id === "recipes" ? ["category"] : [];
  for (const field of fields) for (const value of new Set(entries.map((entry) => entry.metadata[field]).filter(Boolean))) options.push([field, value, `${groupLabels[field]}: ${value}`]);

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
    const uniqueMarkdown = setPluginField(markdown, "slug", pluginSlug(entryFolder.split(/[\\/]/).pop() || title));
    try {
      setSavingNew(true);
      if (await api.saveMarkdown(path, uniqueMarkdown)) {
        if (manifest.capabilities.includes("attachments")) await mkdir(await join(entryFolder, "_attachments"), { recursive: true });
        if (id === "quick-notes") setNewNotePath(path);
        else setSelectedPath(path);
        setCreating(false);
        updateDraft(uniqueMarkdown);
        setSavedMarkdown(uniqueMarkdown);
        try { localStorage.removeItem(draftKey(null)); } catch { /* unavailable storage */ }
        setError("");
        return path;
      }
      else setError("Kunne ikke opprette dokumentet.");
    } catch { setError("Kunne ikke opprette dokumentet."); }
    finally { setSavingNew(false); }
    return null;
  };

  const requestAdd = () => {
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
  };

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
    }).catch((cause) => { succeeded = false; setError(cause instanceof Error && cause.message === "Dokumentet ble endret utenfor denne visningen." ? cause.message : "Kunne ikke lagre endringen."); });
    pendingWrites.current.set(entry.path, next);
    await next;
    if (pendingWrites.current.get(entry.path) === next) pendingWrites.current.delete(entry.path);
    return succeeded;
  };

  const selected = entries.find((entry) => entry.path === selectedPath);
  const editingEntry: Entry | null = creating && draftMarkdown !== null ? {
    path: "", markdown: draftMarkdown, metadata: pluginMetadata(draftMarkdown), title: ""
  } : selected && draftMarkdown !== null ? {
    ...selected, markdown: draftMarkdown, metadata: pluginMetadata(draftMarkdown)
  } : null;

  return <main className="content-plugin-panel">
    <header className="content-plugin-panel__header">
      {isPhone || !sidebarVisible ? <Button variant="outline" aria-label="Åpne sidemeny" onClick={isPhone ? onOpenSidebar : onSidebarVisibilityToggle}><PanelLeft /></Button> : null}
      <h2>{manifest.name}</h2>
      <Button variant="outline" aria-label="Hjem" title="Hjem" onClick={onClose}><Home size={18} /></Button>
      {!editingEntry && id !== "quick-notes" && <Button variant="outline" onClick={() => setShowStats((value) => !value)}><ChartNoAxesCombined size={16} /> Statistikk</Button>}
      {!editingEntry && <Button onClick={requestAdd}><Plus size={16} /> Ny</Button>}
    </header>
    <div className="content-plugin-panel__body">
      {error ? <p role="alert">{error}</p> : null}
      {editingEntry && id !== "quick-notes" ? <ContentPluginDetail id={id} entry={editingEntry} vaultPath={folderPath} publicView={publicView}
        isNew={creating} dirty={draftMarkdown !== savedMarkdown} saving={savingNew} onSave={() => void saveDraft()}
        onBack={back} onCancelEdit={cancelEdit} onChange={async (next) => { updateDraft(next); }} onDelete={() => selected && setDialog({ kind: "delete", path: selected.path, label: selected.title })} /> : <>
      {showStats ? <PluginStatistics id={id} entries={entries} onBack={() => setShowStats(false)} onOpen={(path) => { const entry = entries.find((item) => item.path === path); if (entry) openEntry(entry); }} /> : <>
      <div className="content-plugin-panel__overview"><div><span className="content-plugin-panel__eyebrow">SAMLING</span><h2>{manifest.name}</h2><p>{visible.length} {visible.length === 1 ? "oppføring" : "oppføringer"}</p></div></div>
      <div className="content-plugin-panel__controls"><label className="content-plugin-panel__search"><Search size={16} /><input type="search" value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} /></label>
      {options.length ? <label className="content-plugin-panel__select"><span>Vis</span><select aria-label="Filtrer oppføringer" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Alle</option>{options.map(([field, value, label]) => <option value={JSON.stringify([field, value])} key={`${field}:${value}`}>{label}</option>)}</select></label> : null}
      {selectedFilter && fields.includes(selectedFilter[0]) && <button className="content-plugin-panel__delete-filter" onClick={() => setDialog({ kind: "category", field: selectedFilter[0], label: selectedFilter[1] })}>Slett {groupLabels[selectedFilter[0]].toLocaleLowerCase()}</button>}</div>
      <div className={`content-plugin-panel__grid content-plugin-panel__grid--${id}`}>{visible.map((entry) => {
        return <article key={entry.path} className="content-plugin-panel__card">
          {id !== "quick-notes" && <button className="content-plugin-panel__tile" onClick={() => openEntry(entry)}>
            {entry.metadata.cover && (id === "books" || id === "recipes" || id === "inventory")
              ? <PluginCover id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt={entry.title} />
              : <span className="content-plugin-panel__placeholder" aria-hidden="true">{id === "books" ? <BookOpen /> : id === "recipes" ? <CookingPot /> : id === "inventory" ? <Package /> : <ShoppingBasket />}</span>}
            <strong>{entry.metadata.title || entry.metadata.name || entry.title}</strong>
            <span>{[entry.metadata.author, id === "books" ? ({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest" } as Record<string, string>)[entry.metadata.status] : "", entry.metadata.category, entry.metadata.location].filter(Boolean).join(" · ")}</span>
          </button>}
          {id === "quick-notes" ? <>
            <QuickNoteCard entry={entry} initialEdit={newNotePath === entry.path} onSave={async (markdown, expected) => {
              await pendingWrites.current.get(entry.path)?.catch(() => undefined);
              if (await api.readMarkdown(entry.path).catch(() => "") !== expected) { setError("Huskelappen er endret utenfor denne visningen. Teksten din er beholdt i skrivefeltet."); return false; }
              const saved = await change(entry, markdown); if (saved) setNewNotePath(null); return saved;
            }} onDelete={() => setDialog({ kind: "delete", path: entry.path, label: "huskelappen" })} />
            <div><button onClick={() => void change(entry, (markdown) => setPluginField(markdown, "pinned", pluginMetadata(markdown).pinned !== "true"))}>{entry.metadata.pinned === "true" ? "Løsne" : "Fest"}</button>
            {" · "}<button onClick={() => void change(entry, (markdown) => setPluginField(markdown, "archived", pluginMetadata(markdown).archived !== "true"))}>{entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"}</button>
            </div>
          </> : null}
        </article>;
      })}</div>
      {visible.length === 0 ? <p>Ingen oppføringer her ennå.</p> : null}
      </>}
      </>}
    </div>
    {dialog && <PluginDialog key={`${dialog.kind}-${dialog.path ?? dialog.label ?? ""}`} title={dialog.kind === "discard" ? "Forkaste endringer som ikke er lagret?" : dialog.kind === "category" ? `Slette ${groupLabels[dialog.field ?? "category"]?.toLocaleLowerCase() ?? "verdien"} «${dialog.label}»?` : `Flytte «${dialog.label}» til papirkurven?`}
      confirmLabel={dialog.kind === "discard" ? "Forkast" : "Slett"} destructive
      onCancel={() => setDialog(null)} onConfirm={() => {
        const action = dialog;
        setDialog(null);
        if (action.kind === "discard") { discard(); return; }
        if (action.kind === "delete" && action.path) {
          if (pendingWrites.current.has(action.path)) { setError("Vent til endringen er lagret før du sletter."); return; }
          void (async () => {
            const entryFolder = await dirname(action.path!);
            const ownFolder = entryFolder.split(/[\\/]/).pop() === action.path!.split(/[\\/]/).pop()?.replace(/\.md$/i, "");
            return ownFolder ? deleteFolder(entryFolder) : deleteFile(action.path!);
          })().then((ok) => { if (ok) { setEntries((items) => items.filter((item) => item.path !== action.path)); discard(); } else setError("Kunne ikke slette oppføringen."); });
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
