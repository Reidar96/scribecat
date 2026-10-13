import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { splitFrontmatter } from "@/lib/documentFrontmatter";
import { createPluginApi } from "@/plugins/api";
import { moveMarkdownSection, newPluginDocument, pluginMetadata, safeDocumentName, setPluginField } from "@/plugins/markdown";
import { pluginById, type PluginId } from "@/plugins/registry";
import { join } from "@/platform/paths";
import { exists } from "@/platform/vaultFs";
import { usePluginStore } from "@/store/usePluginStore";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { PluginCover } from "@/components/plugins/PluginCover";
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
  const publicView = usePluginStore((state) => state.config.plugins.recipes?.publicView ?? false);
  const deleteFile = useAppStore((state) => state.deleteFilePath);
  const api = createPluginApi(id, folderPath, onOpenFile);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [servingOverrides, setServingOverrides] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const pendingWrites = useRef(new Set<string>());
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

  const visible = entries.filter((entry) => {
    if (id === "quick-notes" && filter !== "arkiv" && entry.metadata.archived === "true") return false;
    if (id === "inventory" && filter === "garanti" && (!entry.metadata["warranty-until"] || entry.metadata["warranty-until"] < new Date().toISOString().slice(0, 10))) return false;
    if (id === "recipes" && filter === "favoritter" && entry.metadata.favorite !== "true") return false;
    if (filter && !(id === "inventory" && filter === "garanti") && !(id === "recipes" && filter === "favoritter") && (id === "books" ? entry.metadata.status : id === "quick-notes" ? filter === "arkiv" ? entry.metadata.archived === "true" ? "arkiv" : "" : entry.metadata.pinned : entry.metadata.category) !== filter) return false;
    return `${entry.title} ${entry.markdown}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  const filters = id === "books" ? ["reading", "finished", "want-to-read"]
    : id === "quick-notes" ? ["true", "arkiv"]
    : id === "inventory" ? ["garanti", ...new Set(entries.map((entry) => entry.metadata.category).filter(Boolean))]
    : id === "recipes" ? ["favoritter", ...new Set(entries.map((entry) => entry.metadata.category).filter(Boolean))]
    : [];

  const add = async () => {
    const title = window.prompt(`Ny ${manifest.name.toLocaleLowerCase()}: navn`);
    if (!title?.trim()) return;
    const name = safeDocumentName(title);
    const base = await join(folderPath, ...folder.split("/"), `${name}.md`);
    let path = base;
    let number = 2;
    while (filePaths.some((existing) => existing.toLocaleLowerCase() === path.toLocaleLowerCase()) || await exists(path).catch(() => false)) {
      path = await join(folderPath, ...folder.split("/"), `${name} ${number++}.md`);
    }
    try {
      if (await api.saveMarkdown(path, newPluginDocument(id, title))) { api.openMarkdown(path); setError(""); }
      else setError("Kunne ikke opprette dokumentet.");
    } catch { setError("Kunne ikke opprette dokumentet."); }
  };

  const change = async (entry: Entry, markdown: string) => {
    if (pendingWrites.current.has(entry.path)) return;
    const openDocument = useAppStore.getState().fileDocuments[entry.path];
    if (openDocument && openDocument.content !== openDocument.baseContent) {
      setError("Lagre åpne endringer i dokumentet før du endrer kortet.");
      return;
    }
    pendingWrites.current.add(entry.path);
    try {
      if (await api.saveMarkdown(entry.path, markdown)) {
        setEntries((items) => items.map((item) => item.path === entry.path
          ? { ...item, markdown, metadata: pluginMetadata(markdown) } : item));
        setError("");
      } else setError("Kunne ikke lagre endringen.");
    } catch { setError("Kunne ikke lagre endringen."); }
    finally { pendingWrites.current.delete(entry.path); }
  };

  return <main className="content-plugin-panel">
    <header className="content-plugin-panel__header">
      {isPhone || !sidebarVisible ? <Button variant="outline" aria-label="Åpne sidemeny" onClick={isPhone ? onOpenSidebar : onSidebarVisibilityToggle}><PanelLeft /></Button> : null}
      <h2>{manifest.name}</h2>
      <Button variant="outline" onClick={onClose}>Filer</Button>
      <Button onClick={() => void add()}><Plus size={16} /> Ny</Button>
    </header>
    <div className="content-plugin-panel__body">
      <label className="content-plugin-panel__search"><Search size={16} /><input type="search" value={query} placeholder={`Søk i ${manifest.name.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} /></label>
      {filters.length ? <div className="content-plugin-panel__filters">
        <button className={!filter ? "active" : ""} onClick={() => setFilter("")}>Alle</button>
        {filters.map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "true" ? "Festet" : value === "arkiv" ? "Arkiv" : value === "garanti" ? "Garanti" : value === "favoritter" ? "Favoritter" : value}</button>)}
      </div> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="content-plugin-panel__grid">{visible.map((entry) => {
        const body = splitFrontmatter(entry.markdown).body;
        return <article key={entry.path} className="content-plugin-panel__card">
          {entry.metadata.cover && (id === "books" || id === "recipes" || id === "inventory") ?
            <PluginCover id={id} vaultPath={folderPath} documentPath={entry.path} reference={entry.metadata.cover} alt={entry.title} /> : null}
          <button className="content-plugin-panel__title" onClick={() => api.openMarkdown(entry.path)}>{entry.title}</button>
          <p>{[entry.metadata.author, entry.metadata.status, entry.metadata.location, entry.metadata.category].filter(Boolean).join(" · ")}</p>
          {id === "quick-notes" ? <>
            <textarea aria-label={`Innhold i ${entry.title}`} key={entry.markdown} defaultValue={body.replace(/^#\s+[^\n]*\n*/, "").trim()}
              onBlur={(event) => {
                const next = event.currentTarget.value;
                const current = body.replace(/^#\s+[^\n]*\n*/, "").trim();
                if (next.trim() !== current) void change(entry, entry.markdown.slice(0, entry.markdown.length - body.length) + `# ${entry.title}\n\n${next}\n`);
              }} />
            <div><button onClick={() => void change(entry, setPluginField(entry.markdown, "pinned", entry.metadata.pinned !== "true"))}>{entry.metadata.pinned === "true" ? "Løsne" : "Fest"}</button>
            {" · "}<button onClick={() => void change(entry, setPluginField(entry.markdown, "archived", entry.metadata.archived !== "true"))}>{entry.metadata.archived === "true" ? "Gjenopprett" : "Arkiver"}</button>
            {" · "}<button onClick={() => {
              if (pendingWrites.current.has(entry.path)) return;
              if (!window.confirm(`Slette «${entry.title}» til papirkurven?`)) return;
              void deleteFile(entry.path).then((ok) => { if (ok) setEntries((items) => items.filter((item) => item.path !== entry.path)); });
            }}>Slett</button></div>
          </> : id === "shopping" ? <div className="content-plugin-panel__items">
            {[...body.matchAll(/^##\s+(.+)$/gm)].map((match) => <div key={match[1]} className="content-plugin-panel__category">
              <strong>{match[1]}</strong>
              <button aria-label={`Flytt ${match[1]} opp`} onClick={() => void change(entry, moveMarkdownSection(entry.markdown, match[1], -1))}>↑</button>
              <button aria-label={`Flytt ${match[1]} ned`} onClick={() => void change(entry, moveMarkdownSection(entry.markdown, match[1], 1))}>↓</button>
            </div>)}
            {body.split("\n").map((line, index) => {
            const match = /^- \[([ x])\] (.*)$/.exec(line);
            return match ? <label key={index}><input type="checkbox" checked={match[1] === "x"} onChange={() => {
              const lines = body.split("\n");
              lines[index] = `- [${match[1] === "x" ? " " : "x"}] ${match[2]}`;
              void change(entry, entry.markdown.slice(0, entry.markdown.length - body.length) + lines.join("\n"));
            }} /> {match[2]}</label> : null;
          })}<button onClick={() => {
            const item = window.prompt("Ny vare");
            if (!item?.trim()) return;
            const categories = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]);
            const category = categories.length > 1 ? window.prompt(`Kategori: ${categories.join(", ")}`, categories[0]) : categories[0] ?? "Annet";
            if (category === null) return;
            const heading = `## ${category.trim() || "Annet"}`;
            const nextBody = body.includes(heading) ? body.replace(heading, `${heading}\n\n- [ ] ${item.trim()}`) : `${body.trimEnd()}\n\n${heading}\n\n- [ ] ${item.trim()}\n`;
            void change(entry, entry.markdown.slice(0, entry.markdown.length - body.length) + nextBody);
          }}>+ Legg til vare</button></div> : id === "books" ? <>
            <label>Status <select value={entry.metadata.status || "want-to-read"} onChange={(event) => void change(entry, setPluginField(entry.markdown, "status", event.target.value))}>
              <option value="want-to-read">Vil lese</option><option value="reading">Leser</option><option value="finished">Lest</option>
            </select></label>
            {entry.metadata.rating ? <p>Vurdering: {entry.metadata.rating}/5</p> : null}
            {entry.metadata.finished ? <p>Fullført: {entry.metadata.finished}</p> : null}
            <p>{body.replace(/^#\s+[^\n]*\n/, "").replace(/[#*\[\]]/g, "").trim().slice(0, 200)}</p>
          </> : id === "recipes" ? <>
            <button onClick={() => void change(entry, setPluginField(entry.markdown, "favorite", entry.metadata.favorite !== "true"))}>{entry.metadata.favorite === "true" ? "★ Favoritt" : "☆ Legg til favoritter"}</button>
            <label>Porsjoner <input type="number" min="1" max="100" value={servingOverrides[entry.path] ?? Number(entry.metadata.servings || 4)} onChange={(event) => setServingOverrides((old) => ({ ...old, [entry.path]: Number(event.target.value) }))} /></label>
            <div className="content-plugin-panel__items">{(body.split(/^## Ingredienser\s*$/m)[1] ?? "").split(/^## /m)[0].split("\n").filter((line) => /^- /.test(line)).map((line, index) => {
              const scale = (servingOverrides[entry.path] ?? Number(entry.metadata.servings || 4)) / (Number(entry.metadata.servings) || 4);
              return <p key={index}>{line.replace(/^(\-\s+)(\d+(?:[.,]\d+)?)/, (_match, prefix: string, quantity: string) => `${prefix}${Math.round(Number(quantity.replace(",", ".")) * scale * 100) / 100}`)}</p>;
            })}</div>
            <button disabled={!publicView && entry.metadata.published !== "true"} onClick={() => {
              const publish = entry.metadata.published !== "true";
              if (publish && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.metadata.slug ?? "") || !window.confirm(`Publisere «${entry.title}» offentlig?`))) return;
              void change(entry, setPluginField(entry.markdown, "published", publish));
            }}>{entry.metadata.published === "true" ? "Avpubliser" : publicView ? "Publiser oppskrift" : "Aktiver offentlig visning i innstillinger"}</button>
          </> : <p>{body.replace(/^#\s+[^\n]*\n/, "").replace(/[#*\[\]]/g, "").trim().slice(0, 200)}</p>}
          <button className="content-plugin-panel__open" onClick={() => api.openMarkdown(entry.path)}>Åpne som dokument</button>
        </article>;
      })}</div>
      {visible.length === 0 ? <p>Ingen dokumenter her ennå.</p> : null}
    </div>
  </main>;
}
