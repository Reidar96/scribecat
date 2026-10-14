import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, ChartNoAxesCombined, Trash2, BookOpen, CookingPot, Package, ShoppingBasket, Pin, ArchiveRestore, Archive } from "lucide-react";

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

type Entry = { path: string; markdown: string; metadata: Record<string, string>; title: string };
const entryCache = new Map<string, { mtime: number; entry: Entry }>();
function noteBody(markdown: string) { return splitFrontmatter(markdown).body.replace(/^#\s+[^\n]*\n*/, "").trim(); }
function QuickNoteCard({ entry, initialEdit, onSave, onDelete }: { entry: Entry; initialEdit: boolean; onSave: (markdown: string, expected: string) => Promise<boolean>; onDelete: () => void }) {
  const draftKey = `scribecat:quick-note-draft:${entry.path}`;
  const restored = useRef<{ value: string } | null>(null);
  if (restored.current === null) {
    try { restored.current = { value: localStorage.getItem(draftKey) ?? "" }; } catch { restored.current = { value: "" }; }
  }
  const [draft, setDraft] = useState(() => restored.current!.value || noteBody(entry.markdown));
  const [saving, setSaving] = useState(false);
  const baseline = useRef(entry.markdown);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const saved = noteBody(entry.markdown);
  useEffect(() => { if (draft === saved) { baseline.current = entry.markdown; setDraft(saved); } }, [saved, entry.markdown]);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.max(field.scrollHeight, 128)}px`;
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
      const body = splitFrontmatter(expected).body;
      const markdown = expected.slice(0, expected.length - body.length) + `\n${draft}\n`;
      setSaving(true);
      void onSaveRef.current(markdown, expected).then((ok) => {
        if (ok) baseline.current = markdown;
      }).finally(() => setSaving(false));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, saved]);
  return <div className="content-plugin-panel__note">
    <textarea ref={textarea} data-note-path={entry.path} aria-label="Huskelapp" value={draft} placeholder="Skriv noe …" onChange={(event) => setDraft(event.target.value)} autoFocus={initialEdit} />
    <div className="content-plugin-panel__note-actions"><span className="content-plugin-panel__note-status" role="status">{saving ? "Lagrer …" : draft !== saved ? "Lagrer automatisk" : "Lagret"}</span><button aria-label="Slett huskelapp" title="Slett" onClick={onDelete}><Trash2 size={15} /></button></div>
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
  const [groupView, setGroupView] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const updateDraft = (markdown: string | null) => { draftRef.current = markdown; setDraftMarkdown(markdown); };
  const [savedMarkdown, setSavedMarkdown] = useState<string | null>(null);
  const [newNotePath, setNewNotePath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [scanRemaining, setScanRemaining] = useState(0);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "delete" | "category" | "discard"; path?: string; label?: string; field?: string } | null>(null);
  const pendingWrites = useRef(new Map<string, Promise<void>>());
  const pendingNavigation = useRef<(() => void) | null>(null);
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
    setScanRemaining(missing.length);
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
        if (current) setScanRemaining(Math.max(0, missing.length - at - batch.length));
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

  const selectFilter = (value: string, group: string | null = null) => navigate(() => { setFilter(value); setGroupView(group); setShowStats(false); setSelectedPath(null); setCreating(false); updateDraft(null); setSecondaryOpen(false); });
  return <main className="content-plugin-panel">
    <PluginTopbar title={manifest.name} icon={id} isPhone={isPhone} sidebarVisible={sidebarVisible} onSidebarVisibilityToggle={onSidebarVisibilityToggle} onOpenSidebar={onOpenSidebar} onClose={onClose} />
    <div className="content-plugin-panel__layout">
      <aside className={`content-plugin-panel__rail${secondaryOpen ? " content-plugin-panel__rail--open" : ""}`} aria-label={`${manifest.name} navigasjon`}>
        <div className="content-plugin-panel__rail-group">
          <Button variant="outline" className="content-plugin-panel__new" onClick={requestAdd}><Plus size={16} /> {id === "books" ? "Ny bok" : id === "recipes" ? "Ny oppskrift" : id === "inventory" ? "Ny gjenstand" : id === "shopping" ? "Ny handleliste" : "Ny huskelapp"}</Button>
          <button className={!editingEntry && !showStats && !filter && !groupView ? "active" : ""} onClick={() => selectFilter("")}>Alle <span>{entries.length}</span></button>
          {id !== "quick-notes" && <button className={showStats ? "active" : ""} onClick={() => navigate(() => { setShowStats(true); setSelectedPath(null); setCreating(false); updateDraft(null); setSecondaryOpen(false); })}><ChartNoAxesCombined size={16} /> Statistikk</button>}
        </div>
        {id === "shopping" && <div className="content-plugin-panel__rail-group"><strong>Handlelister</strong>{entries.map((entry) => <button key={entry.path} className={selectedPath === entry.path ? "active" : ""} onClick={() => navigate(() => openEntry(entry))}>{entry.title}</button>)}</div>}
        {fields.length > 0 && <div className="content-plugin-panel__rail-group"><strong>Utforsk</strong>{fields.map((field) => <button key={field} className={groupView === field ? "active" : ""} onClick={() => selectFilter("", field)}>{groupNames[field]}<span>{new Set(entries.map((entry) => entry.metadata[field]).filter(Boolean)).size}</span></button>)}</div>}
        {!fields.length && id !== "shopping" && options.length > 0 && <div className="content-plugin-panel__rail-group"><strong>Utforsk</strong>{options.map(([field, value, label]) => {
          const key = JSON.stringify([field, value]);
          return <button key={key} className={filter === key ? "active" : ""} onClick={() => selectFilter(key)}>{label}<span>{entries.filter((entry) => entry.metadata[field] === value).length}</span></button>;
        })}</div>}
      </aside>
    <div className="content-plugin-panel__body">
      {isPhone && id === "quick-notes" && !editingEntry && <button type="button" className="content-plugin-panel__quick-add" onClick={requestAdd} aria-label="Ny huskelapp" title="Ny huskelapp"><Plus /></button>}
      {error ? <p role="alert">{error}</p> : null}
      {scanRemaining > 0 && <p className="content-plugin-panel__loading" role="status">Laster {scanRemaining} oppføringer …</p>}
      {editingEntry && id !== "quick-notes" ? <ContentPluginDetail id={id} entry={editingEntry} vaultPath={folderPath} publicView={publicView}
        isNew={creating} dirty={draftMarkdown !== savedMarkdown} saving={savingNew} onSave={() => void saveDraft()}
        onBack={back} onCancelEdit={cancelEdit} onChange={async (next) => { updateDraft(next); }} onDelete={() => selected && setDialog({ kind: "delete", path: selected.path, label: selected.title })} /> : <>
      {showStats ? <PluginStatistics id={id} entries={entries} onBack={() => setShowStats(false)} onOpen={(path) => { const entry = entries.find((item) => item.path === path); if (entry) openEntry(entry); }} /> : <>
      <div className="content-plugin-panel__overview"><div><span className="content-plugin-panel__eyebrow">SAMLING</span><h2>{selectedFilter?.[1] || (groupView ? groupNames[groupView] : manifest.name)}</h2><p>{scanRemaining > 0 ? `Laster … ${visible.length} vist` : `${visible.length} ${visible.length === 1 ? "oppføring" : "oppføringer"}`}</p></div></div>
      <div className="content-plugin-panel__controls"><label className="content-plugin-panel__search"><Search size={16} /><input type="search" value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} /></label>
      {!groupView && options.length && id !== "shopping" ? <label className="content-plugin-panel__select"><span>Vis</span><select aria-label="Filtrer oppføringer" value={filter} onChange={(event) => { setGroupView(null); setFilter(event.target.value); }}><option value="">Alle</option>{options.map(([field, value, label]) => <option value={JSON.stringify([field, value])} key={`${field}:${value}`}>{label}</option>)}</select></label> : null}
      {selectedFilter && fields.includes(selectedFilter[0]) && <button className="content-plugin-panel__delete-filter" onClick={() => setDialog({ kind: "category", field: selectedFilter[0], label: selectedFilter[1] })}>Slett {groupLabels[selectedFilter[0]].toLocaleLowerCase()}</button>}</div>
      {groupView && !filter ? <div className="content-plugin-panel__grid content-plugin-panel__groups">{[...new Set(entries.map((entry) => entry.metadata[groupView]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no")).map((value) => {
        const members = entries.filter((entry) => entry.metadata[groupView] === value);
        return <button className="content-plugin-panel__group-card" key={value} onClick={() => selectFilter(JSON.stringify([groupView, value]), groupView)}><span className="content-plugin-panel__mosaic">{members.filter((entry) => entry.metadata.cover).slice(0, 4).map((entry) => <PluginCover key={entry.path} id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt="" />)}</span><strong>{value}</strong><small>{members.length} {members.length === 1 ? "oppføring" : "oppføringer"}</small></button>;
      })}</div> : <div className={`content-plugin-panel__grid content-plugin-panel__grid--${id}`}>{visible.map((entry) => {
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
            <div className="content-plugin-panel__note-controls"><button aria-label={entry.metadata.pinned === "true" ? "Løsne huskelapp" : "Fest huskelapp"} title={entry.metadata.pinned === "true" ? "Løsne" : "Fest"} aria-pressed={entry.metadata.pinned === "true"} onClick={() => void change(entry, (markdown) => setPluginField(markdown, "pinned", pluginMetadata(markdown).pinned !== "true"))}><Pin size={16} /></button>
            <button aria-label={entry.metadata.archived === "true" ? "Gjenopprett huskelapp" : "Arkiver huskelapp"} title={entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"} onClick={() => void change(entry, (markdown) => setPluginField(markdown, "archived", pluginMetadata(markdown).archived !== "true"))}>{entry.metadata.archived === "true" ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
            </div>
          </> : null}
        </article>;
      })}</div>}
      {visible.length === 0 && scanRemaining === 0 ? <p>Ingen oppføringer her ennå.</p> : null}
      </>}
      </>}
    </div></div>
    {dialog && <PluginDialog key={`${dialog.kind}-${dialog.path ?? dialog.label ?? ""}`} title={dialog.kind === "discard" ? "Forkaste endringer som ikke er lagret?" : dialog.kind === "category" ? `Slette ${groupLabels[dialog.field ?? "category"]?.toLocaleLowerCase() ?? "verdien"} «${dialog.label}»?` : `Flytte «${dialog.label}» til papirkurven?`}
      confirmLabel={dialog.kind === "discard" ? "Forkast" : "Slett"} destructive
      onCancel={() => { pendingNavigation.current = null; setDialog(null); }} onConfirm={() => {
        const action = dialog;
        setDialog(null);
        if (action.kind === "discard") { const next = pendingNavigation.current; pendingNavigation.current = null; discard(); next?.(); return; }
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
