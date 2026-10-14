import { useState } from "react";
import type { PluginId } from "@/plugins/registry";

type Entry = { path: string; title: string; metadata: Record<string, string> };
const groups: Record<string, [string, string][]> = {
  books: [["category", "Kategorier"], ["author", "Forfattere"], ["series", "Serier"], ["collection", "Samlinger"]],
  recipes: [["category", "Kategorier"]],
  inventory: [["category", "Kategorier"], ["location", "Plasseringer"]],
};
function price(raw: string): number {
  const text = raw.replace(/[^\d,.\-]/g, "").replace(/\s/g, "");
  const comma = text.lastIndexOf(","), dot = text.lastIndexOf(".");
  const decimal = comma > dot ? "," : ".";
  const normalized = text.replace(new RegExp(`[^\\d\\-${decimal === "." ? "\\." : ","}]`, "g"), "").replace(decimal, ".");
  return Number(normalized) || 0;
}

export function PluginStatistics({ id, entries, onOpen, onBack }: { id: PluginId; entries: Entry[]; onOpen: (path: string) => void; onBack: () => void }) {
  const [group, setGroup] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const definitions = groups[id] ?? [];
  const unique = (key: string) => [...new Set(entries.map((entry) => entry.metadata[key]?.trim()).filter(Boolean))] as string[];
  const monthly = Object.entries(entries.filter((entry) => entry.metadata.status === "finished" && entry.metadata.finished).reduce<Record<string, number>>((result, entry) => {
    const month = entry.metadata.finished.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) result[month] = (result[month] ?? 0) + 1;
    return result;
  }, {})).sort(([a], [b]) => b.localeCompare(a));
  const total = entries.reduce((sum, entry) => sum + price(entry.metadata["purchase-price"] || "") * (Number(entry.metadata.quantity) || 1), 0);
  const facts = id === "books" ? [["Bøker", entries.length], ["Lest", entries.filter((entry) => entry.metadata.status === "finished").length], ["Forfattere", unique("author").length], ["Kategorier", unique("category").length]]
    : id === "inventory" ? [["Gjenstander", entries.length], ["Samlet pris", `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(total)} kr`], ["Kategorier", unique("category").length], ["Plasseringer", unique("location").length]]
    : [["Oppskrifter", entries.length], ["Favoritter", entries.filter((entry) => entry.metadata.favorite === "true").length], ["Kategorier", unique("category").length], ["Publisert", entries.filter((entry) => entry.metadata.published === "true").length]];
  return <div className="plugin-statistics">
    <div className="plugin-statistics__nav"><button onClick={() => { if (group) { setGroup(null); setValue(null); } else onBack(); }}>Oversikt</button>{group && <><span>/</span><button onClick={() => setValue(null)}>{definitions.find(([key]) => key === group)?.[1]}</button></>}{value && <><span>/</span><span>{value}</span></>}</div>
    {!group ? <><h2>Statistikk</h2><div className="plugin-statistics__facts">{facts.map(([label, fact]) => <div key={label}><span>{label}</span><strong>{fact}</strong></div>)}</div>
      {id === "books" && <section className="plugin-detail__section"><h3>Fullført per måned</h3>{monthly.length ? monthly.map(([month, count]) => <p key={month}>{month}: {count} {count === 1 ? "bok" : "bøker"}</p>) : <p>Ingen fullførte bøker med dato ennå.</p>}</section>}
      <div className="plugin-statistics__groups">{definitions.filter(([key]) => unique(key).length).map(([key, label]) => <button key={key} onClick={() => setGroup(key)}>{label} <span>{unique(key).length} →</span></button>)}</div></>
      : !value ? <><h2>{definitions.find(([key]) => key === group)?.[1]}</h2><div className="plugin-statistics__groups">{unique(group).sort((a, b) => a.localeCompare(b, "no")).map((item) => <button key={item} onClick={() => setValue(item)}>{item} <span>{entries.filter((entry) => entry.metadata[group] === item).length} →</span></button>)}</div></>
        : <><h2>{value}</h2><div className="plugin-statistics__groups">{entries.filter((entry) => entry.metadata[group] === value).map((entry) => <button key={entry.path} onClick={() => onOpen(entry.path)}>{entry.title} <span>→</span></button>)}</div></>}
  </div>;
}
