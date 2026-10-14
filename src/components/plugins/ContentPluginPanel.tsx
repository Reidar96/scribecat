import { useEffect, useMemo, useRef, useState } from "react";
import { Home, PanelLeft, Plus, Search, ChartNoAxesCombined } from "lucide-react";

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
  const api = createPluginApi(id, folderPath, onOpenFile);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState<string | null>(null);
  const [savedMarkdown, setSavedMarkdown] = useState<string | null>(null);
  const [newNotePath, setNewNotePath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "delete" | "category" | "discard"; path?: string; label?: string } | null>(null);
  const pendingWrites = useRef(new Map<string, Promise<void>>());
  const latestMarkdown = useRef(new Map<string, string>());
  const paths = useMemo(() => filePaths.filter((path) => {
    const relative = path.replace(/\\/g, "/");
    const root = folderPath.replace(/\\/g, "/").replace(/\/$/, "");
    return relative.startsWith(`${root}/${folder}/`);
  }), [filePaths, folderPath, folder]);

  useEffect(() => {
    let current = true;
    void Promise.all(paths.map(async (path) => {
      try {
        const markdown = await api.readMarkdown(path);
        const metadata = pluginMetadata(markdown);
        if (metadata["scribecat-plugin"] && metadata["scribecat-plugin"] !== id) return null;
        const title = metadata.title || metadata.name || /^#\s+(.+)$/m.exec(splitFrontmatter(markdown).body)?.[1]
          || path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || "";
        return { path, markdown, metadata, title };
      } catch { return null; }
    })).then((items) => { if (current) { const next = items.filter((item): item is Entry => item !== null); setEntries(next); for (const item of next) latestMarkdown.current.set(item.path, item.markdown); } });
    return () => { current = false; };
  }, [paths, id]);

  useEffect(() => {
    if (newNotePath) document.querySelector<HTMLTextAreaElement>(`[data-note-path="${CSS.escape(newNotePath)}"]`)?.focus();
  }, [newNotePath, entries]);
  const draftKey = (path: string | null) => `scribecat:plugin-draft:${folderPath}:${id}:${path ?? "new"}`;
  const openEntry = (entry: Entry) => {
    let savedDraft: string | null = null;
    try { savedDraft = localStorage.getItem(draftKey(entry.path)); } catch { /* unavailable storage */ }
    setCreating(false);
    setSelectedPath(entry.path);
    setDraftMarkdown(savedDraft ?? entry.markdown);
    setSavedMarkdown(entry.markdown);
    setShowStats(false);
  };
  useEffect(() => {
    if (draftMarkdown === null || (!creating && !selectedPath)) return;
    try { localStorage.setItem(draftKey(creating ? null : selectedPath), draftMarkdown); } catch { /* unavailable storage */ }
  }, [draftMarkdown, creating, selectedPath, folderPath, id]);

  const visible = entries.filter((entry) => {
    if (id === "quick-notes" && filter !== "arkiv" && entry.metadata.archived === "true") return false;
    if (id === "inventory" && filter === "garanti" && (!entry.metadata["warranty-until"] || entry.metadata["warranty-until"] < new Date().toISOString().slice(0, 10))) return false;
    if (id === "recipes" && filter === "favoritter" && entry.metadata.favorite !== "true") return false;
    if (filter && !(id === "inventory" && filter === "garanti") && !(id === "recipes" && filter === "favoritter") &&
      (id === "books" ? [entry.metadata.status, entry.metadata.category, entry.metadata.series, entry.metadata.collection].includes(filter)
        : id === "quick-notes" ? filter === "arkiv" ? entry.metadata.archived === "true" : entry.metadata.pinned === filter
        : id === "inventory" ? [entry.metadata.category, entry.metadata.location].includes(filter) : entry.metadata.category === filter) !== true) return false;
    return `${entry.title} ${entry.markdown}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  const filters = id === "books" ? ["want-to-read", "reading", "finished", ...new Set(entries.flatMap((entry) => [entry.metadata.category, entry.metadata.series, entry.metadata.collection]).filter(Boolean))]
    : id === "quick-notes" ? ["true", "arkiv"]
    : id === "inventory" ? ["garanti", ...new Set(entries.flatMap((entry) => [entry.metadata.category, entry.metadata.location]).filter(Boolean))]
    : id === "recipes" ? ["favoritter", ...new Set(entries.map((entry) => entry.metadata.category).filter(Boolean))]
    : [];

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
        setDraftMarkdown(uniqueMarkdown);
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
      setDraftMarkdown(savedDraft ?? newPluginDocument(id, ""));
      setSavedMarkdown(null);
      setShowStats(false);
    }
  };

  const discard = () => {
    try { localStorage.removeItem(draftKey(creating ? null : selectedPath)); } catch { /* unavailable storage */ }
    setCreating(false); setSelectedPath(null); setDraftMarkdown(null); setSavedMarkdown(null); setDialog(null);
  };
  const back = () => {
    if (draftMarkdown !== null && draftMarkdown !== savedMarkdown && (savedMarkdown !== null || pluginMetadata(draftMarkdown).title || pluginMetadata(draftMarkdown).name)) {
      setDialog({ kind: "discard" });
    } else discard();
  };
  const saveDraft = async () => {
    if (draftMarkdown === null || savingNew) return;
    const metadata = pluginMetadata(draftMarkdown);
    if (creating) {
      const title = (metadata.title || metadata.name || "").trim();
      if (!title) { setError("Gi oppføringen et navn før du lagrer."); return; }
      await add(title, setPluginField(draftMarkdown, "slug", pluginSlug(title)));
      return;
    }
    if (!selectedPath) return;
    const existing = entries.find((entry) => entry.path === selectedPath);
    if (!existing) return;
    setSavingNew(true);
    try {
      const current = await api.readMarkdown(selectedPath);
      if (current !== savedMarkdown) throw new Error("Dokumentet ble endret utenfor denne visningen. Utkastet er beholdt.");
      if (!await api.saveMarkdown(selectedPath, draftMarkdown)) throw new Error("Lagring mislyktes");
      setEntries((items) => items.map((item) => item.path === selectedPath ? {
        ...item, markdown: draftMarkdown, metadata, title: metadata.title || metadata.name || item.title
      } : item));
      setSavedMarkdown(draftMarkdown);
      try { localStorage.removeItem(draftKey(selectedPath)); } catch { /* unavailable storage */ }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kunne ikke lagre endringen. Utkastet er beholdt."); }
    finally { setSavingNew(false); }
  };

  const change = async (entry: Entry, update: string | ((current: string) => string)) => {
    const openDocument = useAppStore.getState().fileDocuments[entry.path];
    if (openDocument && openDocument.content !== openDocument.baseContent) {
      setError("Lagre åpne endringer i dokumentet før du endrer kortet.");
      return;
    }
    const markdown = typeof update === "function" ? update(latestMarkdown.current.get(entry.path) ?? entry.markdown) : update;
    latestMarkdown.current.set(entry.path, markdown);
    const previous = pendingWrites.current.get(entry.path) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (!await api.saveMarkdown(entry.path, markdown)) throw new Error("Save failed");
      setError("");
    }).catch(() => setError("Kunne ikke lagre endringen."));
    pendingWrites.current.set(entry.path, next);
    const metadata = pluginMetadata(markdown);
    setEntries((items) => items.map((item) => item.path === entry.path
      ? { ...item, markdown, metadata, title: metadata.title || metadata.name || item.title } : item));
    await next;
    if (pendingWrites.current.get(entry.path) === next) pendingWrites.current.delete(entry.path);
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
        onBack={back} onChange={async (next) => { setDraftMarkdown(next); }} onDelete={() => selected && setDialog({ kind: "delete", path: selected.path, label: selected.title })} /> : <>
      {showStats ? <PluginStatistics id={id} entries={entries} onOpen={(path) => { const entry = entries.find((item) => item.path === path); if (entry) openEntry(entry); }} /> : <>
      <label className="content-plugin-panel__search"><Search size={16} /><input type="search" value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} /></label>
      {filters.length ? <div className="content-plugin-panel__filters">
        <button className={!filter ? "active" : ""} onClick={() => setFilter("")}>Alle</button>
        {filters.map((value) => <span key={value} className="content-plugin-panel__filter"><button className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest", true: "Festet", arkiv: "Arkiv", garanti: "Garanti", favoritter: "Favoritter" } as Record<string, string>)[value] ?? value}</button>
          {!(["want-to-read", "reading", "finished", "true", "arkiv", "garanti", "favoritter"].includes(value)) && <button title={`Slett kategorien ${value}`} aria-label={`Slett kategorien ${value}`} onClick={() => setDialog({ kind: "category", label: value })}>×</button>}</span>)}
      </div> : null}
      <div className={`content-plugin-panel__grid content-plugin-panel__grid--${id}`}>{visible.map((entry) => {
        const body = splitFrontmatter(entry.markdown).body;
        return <article key={entry.path} className="content-plugin-panel__card">
          {id !== "quick-notes" && <button className="content-plugin-panel__tile" onClick={() => openEntry(entry)}>
            {entry.metadata.cover && (id === "books" || id === "recipes" || id === "inventory")
              ? <PluginCover id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt={entry.title} />
              : <span className="content-plugin-panel__placeholder" aria-hidden="true">{id === "books" ? "📖" : id === "recipes" ? "🍽" : id === "inventory" ? "📦" : "🛒"}</span>}
            <strong>{entry.metadata.title || entry.metadata.name || entry.title}</strong>
            <span>{[entry.metadata.author, id === "books" ? ({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest" } as Record<string, string>)[entry.metadata.status] : "", entry.metadata.category, entry.metadata.location].filter(Boolean).join(" · ")}</span>
          </button>}
          {id === "quick-notes" ? <>
            <textarea data-note-path={entry.path} aria-label="Huskelapp" key={entry.path} defaultValue={body.replace(/^#\s+[^\n]*\n*/, "").trim()} placeholder="Skriv noe …"
              onBlur={(event) => {
                const next = event.currentTarget.value;
                const current = body.replace(/^#\s+[^\n]*\n*/, "").trim();
                if (next.trim() !== current) void change(entry, (markdown) => {
                  const currentBody = splitFrontmatter(markdown).body;
                  return markdown.slice(0, markdown.length - currentBody.length) + `\n${next.trim()}\n`;
                });
                setNewNotePath(null);
              }} />
            <div><button onClick={() => void change(entry, (markdown) => setPluginField(markdown, "pinned", pluginMetadata(markdown).pinned !== "true"))}>{entry.metadata.pinned === "true" ? "Løsne" : "Fest"}</button>
            {" · "}<button onClick={() => void change(entry, (markdown) => setPluginField(markdown, "archived", pluginMetadata(markdown).archived !== "true"))}>{entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"}</button>
            {" · "}<button onClick={() => setDialog({ kind: "delete", path: entry.path, label: "huskelappen" })}>Slett</button></div>
          </> : null}
        </article>;
      })}</div>
      {visible.length === 0 ? <p>Ingen oppføringer her ennå.</p> : null}
      </>}
      </>}
    </div>
    {dialog && <PluginDialog key={`${dialog.kind}-${dialog.path ?? dialog.label ?? ""}`} title={dialog.kind === "discard" ? "Forkaste endringer som ikke er lagret?" : dialog.kind === "category" ? `Slette kategorien «${dialog.label}»?` : `Flytte «${dialog.label}» til papirkurven?`}
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
        if (action.kind === "category" && action.label) {
          setFilter("");
          for (const entry of entries) {
            const keys = id === "books" ? ["category", "series", "collection"] : id === "inventory" ? ["category", "location"] : ["category"];
            const matching = keys.filter((key) => entry.metadata[key] === action.label);
            if (matching.length) void change(entry, (markdown) => matching.reduce((value, key) => setPluginField(value, key, ""), markdown));
          }
        }
      }} />}
  </main>;
}
