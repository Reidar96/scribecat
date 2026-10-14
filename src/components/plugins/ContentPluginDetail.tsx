import { useEffect, useState } from "react";
import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PluginCover } from "@/components/plugins/PluginCover";
import { splitFrontmatter } from "@/lib/documentFrontmatter";
import { getRelativeImageMarkdownPath, saveImageToFolder } from "@/lib/fileSystem";
import { moveMarkdownSection, pluginSection, removeMarkdownSection, setPluginField, setPluginSection, setPluginTitle } from "@/plugins/markdown";
import { ingredientMarkdown, parseIngredients, parseSteps, scaledAmount, stepsMarkdown, type Ingredient } from "@/plugins/recipe";
import { PluginDialog } from "@/components/plugins/PluginDialog";
import type { PluginId } from "@/plugins/registry";
import { platform } from "@/platform";

export type PluginEntry = { path: string; markdown: string; metadata: Record<string, string>; title: string };
type Props = { id: PluginId; entry: PluginEntry; vaultPath: string; publicView: boolean; onBack: () => void; onChange: (markdown: string) => Promise<void>; onDelete: () => void };

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
  const [dialog, setDialog] = useState<{ kind: "new" | "delete"; category?: string } | null>(null);
  const categories = [...splitFrontmatter(entry.markdown).body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  return <div className="plugin-detail__shopping">{categories.map((category, categoryIndex) => {
    const sectionLines = pluginSection(entry.markdown, category).split("\n");
    const items = sectionLines.map((line, lineIndex) => ({ line, lineIndex })).filter(({ line }) => /^- \[[ x]\] /.test(line));
    return <section key={category} className="plugin-detail__section"><div className="plugin-detail__section-heading"><h3>{category}</h3>
      <button disabled={categoryIndex === 0} aria-label={`Flytt ${category} opp`} onClick={() => void onChange(moveMarkdownSection(entry.markdown, category, -1))}>↑</button>
      <button disabled={categoryIndex === categories.length - 1} aria-label={`Flytt ${category} ned`} onClick={() => void onChange(moveMarkdownSection(entry.markdown, category, 1))}>↓</button>
      <button className="plugin-detail__remove" aria-label={`Slett kategorien ${category}`} onClick={() => setDialog({ kind: "delete", category })}><Trash2 size={15} /></button></div>
      {items.map(({ line, lineIndex }, index) => <label key={`${category}-${index}`} className="plugin-detail__item">
        <input type="checkbox" checked={line.startsWith("- [x]")} onChange={() => {
          const next = sectionLines.map((item, at) => at === lineIndex ? item.replace(/^(- \[)[ x](\])/, `$1${line.startsWith("- [x]") ? " " : "x"}$2`) : item);
          void onChange(setPluginSection(entry.markdown, category, next.join("\n")));
      }} /><input aria-label={`Vare ${line.slice(6)}`} key={line} defaultValue={line.slice(6)} onBlur={(event) => {
        const value = event.currentTarget.value.trim().replace(/[\r\n]/g, " ");
        if (value && value !== line.slice(6)) void onChange(setPluginSection(entry.markdown, category, sectionLines.map((row, at) => at === lineIndex ? `${line.slice(0, 6)}${value}` : row).join("\n")));
      }} />
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
  })}<Button variant="outline" onClick={() => setDialog({ kind: "new" })}><Plus size={16} /> Kategori</Button>
    {dialog && <PluginDialog title={dialog.kind === "new" ? "Ny kategori" : `Slette kategorien «${dialog.category}» og varene i den?`}
      label={dialog.kind === "new" ? "Navn" : undefined} confirmLabel={dialog.kind === "new" ? "Opprett" : "Slett"} destructive={dialog.kind === "delete"}
      onCancel={() => setDialog(null)} onConfirm={(value) => {
        if (dialog.kind === "new" && !categories.some((item) => item.toLowerCase() === value.toLowerCase())) void onChange(setPluginSection(entry.markdown, value, ""));
        if (dialog.kind === "delete" && dialog.category) void onChange(removeMarkdownSection(entry.markdown, dialog.category));
        setDialog(null);
      }} />}</div>;
}

function RecipeEditor({ entry, servings, onChange }: { entry: PluginEntry; servings: number; onChange: (markdown: string) => Promise<void> }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => parseIngredients(pluginSection(entry.markdown, "Ingredienser")));
  const [steps, setSteps] = useState<string[]>(() => parseSteps(pluginSection(entry.markdown, "Fremgangsmåte")));
  const [draft, setDraft] = useState<Ingredient>({ amount: "", unit: "", name: "" });
  const [stepDraft, setStepDraft] = useState("");
  const [addingIngredient, setAddingIngredient] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const [amountEdits, setAmountEdits] = useState<Record<number, string>>({});
  useEffect(() => {
    setIngredients(parseIngredients(pluginSection(entry.markdown, "Ingredienser")));
    setSteps(parseSteps(pluginSection(entry.markdown, "Fremgangsmåte")));
  }, [entry.path]);
  const saveIngredients = (next: Ingredient[]) => { setIngredients(next); void onChange(setPluginSection(entry.markdown, "Ingredienser", ingredientMarkdown(next))); };
  const saveSteps = (next: string[]) => { setSteps(next); void onChange(setPluginSection(entry.markdown, "Fremgangsmåte", stepsMarkdown(next))); };
  const baseServings = Number(entry.metadata.servings) || 4;
  return <div className="plugin-detail__recipe-grid">
    <section className="plugin-detail__section"><div className="plugin-detail__section-heading"><h3>Ingredienser</h3><button type="button" onClick={() => setAddingIngredient(true)}><Plus size={16} /> Legg til</button></div>
      <ul className="plugin-detail__recipe-list">{ingredients.map((item, index) => <li key={index}><label className="plugin-detail__ingredient"><input type="checkbox" aria-label={`Brukt ${item.name}`} />
        <input aria-label={`Mengde for ${item.name}`} value={amountEdits[index] ?? scaledAmount(item.amount, baseServings, servings)} onChange={(event) => setAmountEdits((edits) => ({ ...edits, [index]: event.target.value }))} onBlur={() => {
          if (amountEdits[index] === undefined) return;
          saveIngredients(ingredients.map((row, at) => at === index ? { ...row, amount: scaledAmount(amountEdits[index], servings, baseServings) } : row));
          setAmountEdits((edits) => { const next = { ...edits }; delete next[index]; return next; });
        }} />
        <input aria-label={`Enhet for ${item.name}`} value={item.unit} onChange={(event) => setIngredients(ingredients.map((row, at) => at === index ? { ...row, unit: event.target.value } : row))} onBlur={() => saveIngredients(ingredients)} />
        <input aria-label="Ingrediens" value={item.name} onChange={(event) => setIngredients(ingredients.map((row, at) => at === index ? { ...row, name: event.target.value } : row))} onBlur={() => saveIngredients(ingredients)} />
        <button type="button" aria-label={`Slett ${item.name}`} onClick={() => saveIngredients(ingredients.filter((_, at) => at !== index))}><Trash2 size={15} /></button></label>
        </li>)}</ul>
      {addingIngredient && <form className="plugin-detail__add-row" onSubmit={(event) => { event.preventDefault(); if (!draft.name.trim()) return; saveIngredients([...ingredients, { ...draft, amount: scaledAmount(draft.amount, servings, baseServings) }]); setDraft({ amount: "", unit: "", name: "" }); setAddingIngredient(false); }}>
        <input aria-label="Mengde" placeholder="Mengde" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
        <input aria-label="Enhet" placeholder="Enhet" value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
        <input aria-label="Ny ingrediens" placeholder="Ingrediens" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <Button type="submit" aria-label="Lagre ingrediens">✓</Button><button type="button" aria-label="Avbryt" onClick={() => setAddingIngredient(false)}>×</button></form>}</section>
    <section className="plugin-detail__section"><div className="plugin-detail__section-heading"><h3>Fremgangsmåte</h3><button type="button" onClick={() => setAddingStep(true)}><Plus size={16} /> Legg til</button></div><ol className="plugin-detail__recipe-list">{steps.map((step, index) => <li key={index} className="plugin-detail__step"><span>Steg {index + 1}</span><label><input type="checkbox" aria-label={`Fullført steg ${index + 1}`} />
      <textarea aria-label={`Steg ${index + 1}`} value={step} onChange={(event) => setSteps(steps.map((row, at) => at === index ? event.target.value : row))} onBlur={() => saveSteps(steps)} /></label>
      <button type="button" aria-label={`Slett steg ${index + 1}`} onClick={() => saveSteps(steps.filter((_, at) => at !== index))}><Trash2 size={15} /></button></li>)}</ol>
      {addingStep && <form className="plugin-detail__add-row" onSubmit={(event) => { event.preventDefault(); if (!stepDraft.trim()) return; saveSteps([...steps, stepDraft]); setStepDraft(""); setAddingStep(false); }}>
        <input aria-label="Nytt steg" placeholder="Beskriv neste steg" value={stepDraft} onChange={(event) => setStepDraft(event.target.value)} />
        <Button type="submit" aria-label="Lagre steg">✓</Button><button type="button" aria-label="Avbryt" onClick={() => setAddingStep(false)}>×</button></form>}</section>
  </div>;
}

function LineItemsEditor({ entry, heading, placeholder, onChange }: { entry: PluginEntry; heading: string; placeholder: string; onChange: (markdown: string) => Promise<void> }) {
  const lines = pluginSection(entry.markdown, heading).split("\n").filter((line) => /^-\s+\S/.test(line)).map((line) => line.replace(/^-\s+/, ""));
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => void onChange(setPluginSection(entry.markdown, heading,
    next.filter((line) => line.trim()).map((line) => `- ${line.trim().replace(/[\r\n]/g, " ")}`).join("\n")));
  return <section className="plugin-detail__section"><h3>{heading}</h3><ul className="plugin-detail__recipe-list">{lines.map((line, index) =>
    <li key={`${index}-${line}`} className="plugin-detail__simple-row"><input aria-label={`${heading} ${index + 1}`} defaultValue={line} onBlur={(event) => {
      const value = event.currentTarget.value.trim();
      if (value && value !== line) save(lines.map((row, at) => at === index ? value : row));
    }} /><button type="button" aria-label={`Slett ${line}`} onClick={() => save(lines.filter((_, at) => at !== index))}><Trash2 size={15} /></button></li>)}</ul>
    <form className="plugin-detail__add-row plugin-detail__add-row--simple" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { save([...lines, draft]); setDraft(""); } }}>
      <input aria-label={`Legg til i ${heading}`} placeholder={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} /><Button type="submit" aria-label={`Legg til i ${heading}`}><Plus size={16} /></Button></form></section>;
}

export function ContentPluginDetail({ id, entry, vaultPath, publicView, onBack, onChange, onDelete }: Props) {
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

  return <div className="plugin-detail"><div className="plugin-detail__actions"><Button variant="ghost" onClick={onBack}><ArrowLeft size={17} /> Tilbake</Button><Button variant="destructive" onClick={onDelete}><Trash2 size={16} /> Slett</Button></div>
    {id === "shopping" ? <><h2>{title}</h2><Field label="Navn" value={title} onSave={(value) => void onChange(setPluginTitle(entry.markdown, "title", value))} />
      <label className="plugin-detail__field"><span>Offentlig handleliste</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => void onChange(setPluginField(entry.markdown, "published", !published))} /></label>
      {published && publicView && <p>Adresse: /handleliste/{entry.metadata.slug}</p>}<ShoppingItems entry={entry} onChange={onChange} /></> : <>
      <div className="plugin-detail__hero"><div className="plugin-detail__image">{cover ? <PluginCover id={id} vaultPath={vaultPath} documentPath={entry.path} reference={cover} alt={title} /> : <span aria-hidden="true">{id === "books" ? "📖" : id === "recipes" ? "🍽" : "📦"}</span>}
        <button onClick={() => void uploadCover()}><ImagePlus size={16} /> {cover ? "Bytt bilde" : "Legg til bilde"}</button></div>
        <div className="plugin-detail__hero-fields"><h2>{title}</h2><Field label={id === "inventory" ? "Navn" : "Tittel"} value={title}
          onSave={(value) => void onChange(setPluginTitle(entry.markdown, id === "inventory" ? "name" : "title", value))} />
          {id === "books" && <>{metadataField("Forfatter", "author")}
            <label className="plugin-detail__field"><span>Lesestatus</span><select value={entry.metadata.status || "want-to-read"} onChange={(event) => field("status", event.target.value)}><option value="want-to-read">Vil lese</option><option value="reading">Leser</option><option value="finished">Lest</option></select></label>
            {metadataField("Kategori", "category")}{metadataField("Serie", "series")}{metadataField("Samling", "collection")}{metadataField("Startet", "started", "date")}{metadataField("Fullført", "finished", "date")}{metadataField("Vurdering (1–5)", "rating", "number")}
            <label className="plugin-detail__field"><span>Offentlig</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => field("published", String(!published))} /></label></>}
          {id === "recipes" && <>{metadataField("Kategori", "category")}{metadataField("Standardporsjoner", "servings", "number")}
            <button onClick={() => void onChange(setPluginField(entry.markdown, "favorite", entry.metadata.favorite !== "true"))}>{entry.metadata.favorite === "true" ? "★ Favoritt" : "☆ Favoritt"}</button>
            <label className="plugin-detail__field"><span>Offentlig</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => {
              void onChange(setPluginField(entry.markdown, "published", !published));
            }} /></label></>}
          {id === "inventory" && <>{metadataField("Kategori", "category")}{metadataField("Plassering", "location")}{metadataField("Antall", "quantity", "number")}{metadataField("Kjøpt", "purchased", "date")}{metadataField("Pris", "purchase-price")}{metadataField("Garanti til", "warranty-until", "date")}{metadataField("Serienummer", "serial-number")}
            <label className="plugin-detail__field"><span>Offentlig</span><input type="checkbox" checked={published} disabled={!publicView && !published} onChange={() => void onChange(setPluginField(entry.markdown, "published", !published))} /></label></>}
        </div></div>
      {id === "books" && <>{contentSection("Oppsummering", "Hva handler boken om?")}<LineItemsEditor entry={entry} heading="Høydepunkter" placeholder="Legg til sitat eller høydepunkt" onChange={onChange} />{contentSection("Mine tanker")}</>}
      {id === "recipes" && <>{contentSection("Beskrivelse", "Beskriv retten …")}
        <label className="plugin-detail__field plugin-detail__servings"><span>Vis for antall porsjoner</span><input type="number" min="1" max="100" value={servings ?? Number(entry.metadata.servings || 4)} onChange={(event) => setServings(Number(event.target.value))} /></label>
        <RecipeEditor key={entry.path} entry={entry} servings={servings ?? Number(entry.metadata.servings || 4)} onChange={onChange} />{contentSection("Notater")}</>}
      {id === "inventory" && <>{contentSection("Beskrivelse", "Kort beskrivelse for den offentlige visningen")}{contentSection("Notater")}<LineItemsEditor entry={entry} heading="Vedlikehold" placeholder="Dato og hva som ble gjort" onChange={onChange} /></>}
    </>}
  </div>;
}
