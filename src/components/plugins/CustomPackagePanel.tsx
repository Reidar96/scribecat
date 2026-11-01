import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type PackageManifest } from "@/plugins/packages";
import { join } from "@/platform/paths";
import { exists, readDir, readTextFile, remove, writeTextFile } from "@/platform/vaultFs";

type RecordItem = { path: string; name: string; values: Record<string, string> };
function decode(markdown: string, fields: PackageManifest["fields"]): Record<string, string> {
  const sections = new Map<string, string[]>();
  const known = new Set(fields.map((field) => field.key));
  let current = "";
  for (const line of markdown.split("\n")) {
    const heading = /^## ([a-z][a-z0-9-]*)$/.exec(line)?.[1];
    if (heading && known.has(heading)) { current = heading; sections.set(current, []); }
    else if (current) sections.get(current)!.push(line);
  }
  return Object.fromEntries(fields.map((field) => [field.key, sections.get(field.key)?.join("\n").trim() ?? ""]));
}
function encode(name: string, values: Record<string, string>, fields: PackageManifest["fields"]) {
  return `# ${name.replace(/[\r\n]/g, " ")}\n\n` + fields.map((field) => `## ${field.key}\n\n${(values[field.key] ?? "").trim()}\n`).join("\n");
}
export function CustomPackagePanel({ manifest, vault, onBack }: { manifest: PackageManifest; vault: string; onBack: () => void }) {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    const folder = await join(vault, manifest.folder);
    const files = (await readDir(folder)).filter((entry) => entry.isFile && entry.name.endsWith(".md"));
    const rows = await Promise.all(files.map(async (file) => {
      const path = await join(folder, file.name);
      const markdown = await readTextFile(path);
      return { path, name: /^# (.*)$/m.exec(markdown)?.[1] || file.name.slice(0, -3), values: decode(markdown, manifest.fields) };
    }));
    setItems(rows.sort((a, b) => a.name.localeCompare(b.name, "no")));
    setLoading(false);
  };
  useEffect(() => { void refresh().catch(() => { setError("Kunne ikke lese appens mappe."); setLoading(false); }); }, [vault, manifest.id]);
  const select = (item: RecordItem | null) => { setSelected(item); setName(item?.name ?? ""); setValues(item?.values ?? {}); setError(""); };
  const save = async () => {
    if (!name.trim()) { setError("Skriv inn et navn."); return; }
    const folder = await join(vault, manifest.folder);
    let path = selected?.path;
    if (!path) {
      const stem = name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 80);
      path = await join(folder, `${stem}.md`);
      let suffix = 2;
      while (await exists(path)) path = await join(folder, `${stem} ${suffix++}.md`);
    }
    try { await writeTextFile(path, encode(name.trim(), values, manifest.fields)); await refresh(); select(null); }
    catch { setError("Kunne ikke lagre. Utkastet er beholdt."); }
  };
  return <div className="custom-package">
    <div className="custom-package__header"><Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Apper</Button><h2>{manifest.name}</h2><Button onClick={() => select({ path: "", name: "", values: {} })}><Plus size={16} /> Ny</Button></div>
    {manifest.description && <p>{manifest.description}</p>}
    {error && <p role="alert">{error}</p>}
    {selected ? <section className="plugin-detail__section"><label className="plugin-detail__field">Navn<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
      {manifest.fields.map((field) => <label className="plugin-detail__field" key={field.key}>{field.label}{field.multiline ? <textarea value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} /> : <input value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}
      <div className="custom-package__actions"><Button onClick={() => void save()}><Save size={16} /> Lagre</Button><Button variant="outline" onClick={() => select(null)}>Avbryt</Button>
      {selected.path && <Button variant="destructive" onClick={() => { void remove(selected.path).then(refresh).then(() => select(null)).catch(() => setError("Kunne ikke slette.")); }}><Trash2 size={16} /> Slett</Button>}</div>
    </section> : loading ? <p>Laster …</p> : <div className="content-plugin-panel__grid">{items.map((item) => <button className="content-plugin-panel__card" key={item.path} onClick={() => select(item)}><strong>{item.name}</strong>{manifest.fields.map((field) => item.values[field.key] && <small key={field.key}>{field.label}: {item.values[field.key]}</small>)}</button>)}</div>}
  </div>;
}
