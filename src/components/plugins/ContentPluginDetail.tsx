import { useState } from "react";
import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PluginCover } from "@/components/plugins/PluginCover";
import { splitFrontmatter } from "@/lib/documentFrontmatter";
import { getRelativeImageMarkdownPath, saveImageToFolder } from "@/lib/fileSystem";
import { moveMarkdownSection, pluginSection, setPluginField, setPluginSection, setPluginTitle } from "@/plugins/markdown";
import type { PluginId } from "@/plugins/registry";
import { platform } from "@/platform";

export type PluginEntry = { path: string; markdown: string; metadata: Record<string, string>; title: string };
type Props = { id: PluginId; entry: PluginEntry; vaultPath: string; publicView: boolean; onBack: () => void; onChange: (markdown: string) => Promise<void>; onOpenMarkdown: () => void };

function Field({ label, value, onSave, type = "text" }: { label: string; value: string; onSave: (value: string) => void; type?: string }) {
  return <label className="plugin-detail__field"><span>{label}</span><input key={`${label}-${value}`} type={type} defaultValue={value}
    onBlur={(event) => { if (event.target.value !== value) onSave(event.target.value); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

function Section({ title, value, onSave, placeholder }: { title: string; value: string; onSave: (value: string) => void; placeholder?: string }) {
  return <section className="plugin-detail__section"><h3>{title}</h3><textarea key={`${title}-${value}`} defaultValue={value} placeholder={placeholder}
    onBlur={(event) => { if (event.target.value.trim() !== value.trim()) onSave(event.target.value); }} /></section>;
}

function ShoppingItems({ entry, onChange }: { entry: PluginEntry; onChange: (markdown: string) => Promise<void> }) {
  const categories = [...splitFrontmatter(entry.markdown).body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  return <div className="plugin-detail__shopping">{categories.map((category, categoryIndex) => {
    const sectionLines = pluginSection(entry.markdown, category).split("\n");
    const items = sectionLines.map((line, lineIndex) => ({ line, lineIndex })).filter(({ line }) => /^- \[[ x]\] /.test(line));
    return <section key={category} className="plugin-detail__section"><div className="plugin-detail__section-heading"><h3>{category}</h3>
      <button disabled={categoryIndex === 0} aria-label={`Flytt ${category} opp`} onClick={() => void onChange(moveMarkdownSection(entry.markdown, category, -1))}>↑</button>
      <button disabled={categoryIndex === categories.length - 1} aria-label={`Flytt ${category} ned`} onClick={() => void onChange(moveMarkdownSection(entry.markdown, category, 1))}>↓</button></div>
      {items.map(({ line, lineIndex }, index) => <label key={`${category}-${index}`} className="plugin-detail__item">
        <input type="checkbox" checked={line.startsWith("- [x]")} onChange={() => {
          const next = sectionLines.map((item, at) => at === lineIndex ? item.replace(/^(- \[)[ x](\])/, `$1${line.startsWith("- [x]") ? " " : "x"}$2`) : item);
          void onChange(setPluginSection(entry.markdown, category, next.join("\n")));
        }} /><span>{line.slice(6)}</span>
        <button aria-label={`Slett ${line.slice(6)}`} onClick={() => void onChange(setPluginSection(entry.markdown, category, sectionLines.filter((_, at) => at !== lineIndex).join("\n")))}><Trash2 size={15} /></button>
      </label>)}
      <form onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("item") as HTMLInputElement;
        if (!input.value.trim()) return;
        void onChange(setPluginSection(entry.markdown, category, [...sectionLines, `- [ ] ${input.value.trim().replace(/[\r\n]/g, " ")}`].join("\n")));
        input.value = "";
      }}><input name="item" aria-label={`Ny vare i ${category}`} placeholder="Legg til vare" /><button type="submit" aria-label="Legg til"><Plus size={17} /></button></form>
    </section>;
  })}<Button variant="outline" onClick={() => {
    const category = window.prompt("Ny kategori");
    if (!category?.trim() || categories.some((item) => item.toLowerCase() === category.trim().toLowerCase())) return;
    void onChange(setPluginSection(entry.markdown, category.trim().replace(/[\r\n]/g, " "), ""));
  }}><Plus size={16} /> Kategori</Button></div>;
}

export function ContentPluginDetail({ id, entry, vaultPath, publicView, onBack, onChange, onOpenMarkdown }: Props) {
  const [servings, setServings] = useState<number | null>(null);
  const field = (key: string, value: string) => void onChange(setPluginField(entry.markdown, key, value));
  const section = (heading: string, value: string) => void onChange(setPluginSection(entry.markdown, heading, value));
  const title = entry.metadata.title || entry.metadata.name || entry.title;
  const cover = entry.metadata.cover;
  const uploadCover = async () => {
    const files = await platform.imagePicker.pickImages({ title: "Velg bilde", filterName: "Bilder", extensions: ["jpg", "jpeg", "png", "webp", "gif"] });
    const picked = files[0];
    if (!picked) return;
    const { data, mimeType } = await picked.read();
    if (!mimeType.startsWith("image/") || data.length > 8 * 1024 * 1024) throw new Error("Bildet må være under 8 MB.");
    const relative = await saveImageToFolder(vaultPath, entry.path, picked.fileName, mimeType, data);
    field("cover", await getRelativeImageMarkdownPath(vaultPath, entry.path, relative));
  };
  const metadataField = (label: string, key: string, type?: string) => <Field label={label} value={entry.metadata[key] ?? ""} type={type} onSave={(value) => field(key, value)} />;
  const contentSection = (heading: string, placeholder?: string) => <Section title={heading} value={pluginSection(entry.markdown, heading)} placeholder={placeholder} onSave={(value) => section(heading, value)} />;
  const published = entry.metadata.published === "true";

  return <div className="plugin-detail"><div className="plugin-detail__actions"><Button variant="ghost" onClick={onBack}><ArrowLeft size={17} /> Tilbake</Button><button className="plugin-detail__markdown" onClick={onOpenMarkdown}>Åpne Markdown</button></div>
    {id === "shopping" ? <><h2>{title}</h2><label className="plugin-detail__field"><span>Offentlig handleliste</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => {
      if (!published && !window.confirm("Alle som kjenner adressen kan legge til og krysse av varer. Publisere listen?")) return;
      void onChange(setPluginField(entry.markdown, "published", !published));
    }} /></label>{published && publicView && <p>Adresse: /handleliste/{entry.metadata.slug}</p>}<ShoppingItems entry={entry} onChange={onChange} /></> : <>
      <div className="plugin-detail__hero"><div className="plugin-detail__image">{cover ? <PluginCover id={id} vaultPath={vaultPath} documentPath={entry.path} reference={cover} alt={title} /> : <span aria-hidden="true">{id === "books" ? "📖" : id === "recipes" ? "🍽" : "📦"}</span>}
        <button onClick={() => void uploadCover()}><ImagePlus size={16} /> {cover ? "Bytt bilde" : "Legg til bilde"}</button></div>
        <div className="plugin-detail__hero-fields"><h2>{title}</h2><Field label={id === "inventory" ? "Navn" : "Tittel"} value={title}
          onSave={(value) => void onChange(setPluginTitle(entry.markdown, id === "inventory" ? "name" : "title", value))} />
          {id === "books" && <>{metadataField("Forfatter", "author")}
            <label className="plugin-detail__field"><span>Lesestatus</span><select value={entry.metadata.status || "want-to-read"} onChange={(event) => field("status", event.target.value)}><option value="want-to-read">Vil lese</option><option value="reading">Leser</option><option value="finished">Lest</option></select></label>
            {metadataField("Kategori", "category")}{metadataField("Serie", "series")}{metadataField("Samling", "collection")}{metadataField("Startet", "started", "date")}{metadataField("Fullført", "finished", "date")}{metadataField("Vurdering (1–5)", "rating", "number")}</>}
          {id === "recipes" && <>{metadataField("Kategori", "category")}{metadataField("Porsjoner", "servings", "number")}
            <button onClick={() => void onChange(setPluginField(entry.markdown, "favorite", entry.metadata.favorite !== "true"))}>{entry.metadata.favorite === "true" ? "★ Favoritt" : "☆ Favoritt"}</button>
            <label className="plugin-detail__field"><span>Offentlig</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => {
              if (!published && !window.confirm(`Publisere «${title}» offentlig?`)) return;
              void onChange(setPluginField(entry.markdown, "published", !published));
            }} /></label></>}
          {id === "inventory" && <>{metadataField("Kategori", "category")}{metadataField("Plassering", "location")}{metadataField("Antall", "quantity", "number")}{metadataField("Kjøpt", "purchased", "date")}{metadataField("Pris", "purchase-price")}{metadataField("Garanti til", "warranty-until", "date")}{metadataField("Serienummer", "serial-number")}</>}
        </div></div>
      {id === "books" && <>{contentSection("Oppsummering", "Hva handler boken om?")}{contentSection("Høydepunkter", "Sitater og høydepunkter")}{contentSection("Mine tanker")}</>}
      {id === "recipes" && <><label className="plugin-detail__field"><span>Skaler visning til porsjoner</span><input type="number" min="1" max="100" value={servings ?? Number(entry.metadata.servings || 4)} onChange={(event) => setServings(Number(event.target.value))} /></label>
        {(["Ingredienser", "Fremgangsmåte"] as const).map((heading) => <section key={heading} className="plugin-detail__section"><h3>{heading}</h3>
          <textarea key={`${heading}-${entry.markdown}`} defaultValue={pluginSection(entry.markdown, heading)} onBlur={(event) => section(heading, event.target.value)} />
          {heading === "Ingredienser" ? <ul>{pluginSection(entry.markdown, heading).split("\n").filter((line) => /^- /.test(line)).map((line, index) => {
            const scale = (servings ?? Number(entry.metadata.servings || 4)) / (Number(entry.metadata.servings) || 4);
            return <li key={index}><label><input type="checkbox" /> {line.slice(2).replace(/^(\d+(?:[.,]\d+)?)/, (quantity) => String(Math.round(Number(quantity.replace(",", ".")) * scale * 100) / 100))}</label></li>;
          })}</ul> : <ol>{pluginSection(entry.markdown, heading).split("\n").filter((line) => /^\d+\. /.test(line)).map((line, index) => <li key={index}><label><input type="checkbox" /> {line.replace(/^\d+\. /, "")}</label></li>)}</ol>}
        </section>)}{contentSection("Notater")}</>}
      {id === "inventory" && <>{contentSection("Notater")}{contentSection("Vedlikehold", "Dato og hva som ble gjort")}</>}
    </>}
  </div>;
}
