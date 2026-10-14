import { useEffect, useMemo, useRef, useState } from "react";
import { Home, PanelLeft, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { splitFrontmatter } from "@/lib/documentFrontmatter";
import { createPluginApi } from "@/plugins/api";
import { newPluginDocument, pluginMetadata, safeDocumentName, setPluginField } from "@/plugins/markdown";
import { pluginById, type PluginId } from "@/plugins/registry";
import { join } from "@/platform/paths";
import { exists } from "@/platform/vaultFs";
import { usePluginStore } from "@/store/usePluginStore";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { PluginCover } from "@/components/plugins/PluginCover";
import { ContentPluginDetail } from "@/components/plugins/ContentPluginDetail";
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
  const api = createPluginApi(id, folderPath, onOpenFile);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [newNotePath, setNewNotePath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "new" | "delete" | "category"; path?: string; label?: string } | null>(null);
  const pendingWrites = useRef(new Map<string, Promise<void>>());
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
    })).then((items) => { if (current) setEntries(items.filter((item): item is Entry => item !== null)); });
    return () => { current = false; };
  }, [paths, id]);

  useEffect(() => {
    if (newNotePath) document.querySelector<HTMLTextAreaElement>(`[data-note-path="${CSS.escape(newNotePath)}"]`)?.focus();
  }, [newNotePath, entries]);

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

  const add = async (title: string) => {
    if (!title?.trim()) return;
    const name = safeDocumentName(title);
    const base = await join(folderPath, ...folder.split("/"), `${name}.md`);
    let path = base;
    let number = 2;
    while (filePaths.some((existing) => existing.toLocaleLowerCase() === path.toLocaleLowerCase()) || await exists(path).catch(() => false)) {
      path = await join(folderPath, ...folder.split("/"), `${name} ${number++}.md`);
    }
    try {
      if (await api.saveMarkdown(path, newPluginDocument(id, title))) {
        if (id === "quick-notes") setNewNotePath(path);
        else setSelectedPath(path);
        setError("");
      }
      else setError("Kunne ikke opprette dokumentet.");
    } catch { setError("Kunne ikke opprette dokumentet."); }
  };

  const requestAdd = () => {
    if (id === "quick-notes") void add(`Huskelapp ${new Date().toLocaleString("sv-SE").replace(/[ :]/g, "-")}`);
    else setDialog({ kind: "new" });
  };

  const change = async (entry: Entry, markdown: string) => {
    const openDocument = useAppStore.getState().fileDocuments[entry.path];
    if (openDocument && openDocument.content !== openDocument.baseContent) {
      setError("Lagre åpne endringer i dokumentet før du endrer kortet.");
      return;
    }
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

  return <main className="content-plugin-panel">
    <header className="content-plugin-panel__header">
      {isPhone || !sidebarVisible ? <Button variant="outline" aria-label="Åpne sidemeny" onClick={isPhone ? onOpenSidebar : onSidebarVisibilityToggle}><PanelLeft /></Button> : null}
      <h2>{manifest.name}</h2>
      <Button variant="outline" aria-label="Hjem" title="Hjem" onClick={onClose}><Home size={18} /></Button>
      {!selected && <Button onClick={requestAdd}><Plus size={16} /> Ny</Button>}
    </header>
    <div className="content-plugin-panel__body">
      {selected && id !== "quick-notes" ? <ContentPluginDetail id={id} entry={selected} vaultPath={folderPath} publicView={publicView}
        onBack={() => setSelectedPath(null)} onChange={(next) => change(selected, next)} onDelete={() => setDialog({ kind: "delete", path: selected.path, label: selected.title })} /> : <>
      <label className="content-plugin-panel__search"><Search size={16} /><input type="search" value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} /></label>
      {filters.length ? <div className="content-plugin-panel__filters">
        <button className={!filter ? "active" : ""} onClick={() => setFilter("")}>Alle</button>
        {filters.map((value) => <span key={value} className="content-plugin-panel__filter"><button className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest", true: "Festet", arkiv: "Arkiv", garanti: "Garanti", favoritter: "Favoritter" } as Record<string, string>)[value] ?? value}</button>
          {!(["want-to-read", "reading", "finished", "true", "arkiv", "garanti", "favoritter"].includes(value)) && <button title={`Slett kategorien ${value}`} aria-label={`Slett kategorien ${value}`} onClick={() => setDialog({ kind: "category", label: value })}>×</button>}</span>)}
      </div> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className={`content-plugin-panel__grid content-plugin-panel__grid--${id}`}>{visible.map((entry) => {
        const body = splitFrontmatter(entry.markdown).body;
        return <article key={entry.path} className="content-plugin-panel__card">
          {id !== "quick-notes" && <button className="content-plugin-panel__tile" onClick={() => setSelectedPath(entry.path)}>
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
                if (next.trim() !== current) void change(entry, entry.markdown.slice(0, entry.markdown.length - body.length) + `\n${next.trim()}\n`);
                setNewNotePath(null);
              }} />
            <div><button onClick={() => void change(entry, setPluginField(entry.markdown, "pinned", entry.metadata.pinned !== "true"))}>{entry.metadata.pinned === "true" ? "Løsne" : "Fest"}</button>
            {" · "}<button onClick={() => void change(entry, setPluginField(entry.markdown, "archived", entry.metadata.archived !== "true"))}>{entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"}</button>
            {" · "}<button onClick={() => setDialog({ kind: "delete", path: entry.path, label: "huskelappen" })}>Slett</button></div>
          </> : null}
        </article>;
      })}</div>
      {visible.length === 0 ? <p>Ingen oppføringer her ennå.</p> : null}
      </>}
    </div>
    {dialog && <PluginDialog key={`${dialog.kind}-${dialog.path ?? dialog.label ?? ""}`} title={dialog.kind === "new" ? `Ny ${manifest.name.toLocaleLowerCase()}` : dialog.kind === "category" ? `Slette kategorien «${dialog.label}»?` : `Flytte «${dialog.label}» til papirkurven?`}
      label={dialog.kind === "new" ? "Navn" : undefined} confirmLabel={dialog.kind === "new" ? "Opprett" : "Slett"} destructive={dialog.kind !== "new"}
      onCancel={() => setDialog(null)} onConfirm={(value) => {
        const action = dialog;
        setDialog(null);
        if (action.kind === "new") { void add(value); return; }
        if (action.kind === "delete" && action.path) {
          if (pendingWrites.current.has(action.path)) { setError("Vent til endringen er lagret før du sletter."); return; }
          void deleteFile(action.path).then((ok) => { if (ok) { setEntries((items) => items.filter((item) => item.path !== action.path)); setSelectedPath(null); } else setError("Kunne ikke slette oppføringen."); });
        }
        if (action.kind === "category" && action.label) {
          setFilter("");
          for (const entry of entries) {
            const keys = id === "books" ? ["category", "series", "collection"] : id === "inventory" ? ["category", "location"] : ["category"];
            const matching = keys.filter((key) => entry.metadata[key] === action.label);
            if (matching.length) void change(entry, matching.reduce((markdown, key) => setPluginField(markdown, key, ""), entry.markdown));
          }
        }
      }} />}
  </main>;
}
