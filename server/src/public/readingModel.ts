/** Shared, filesystem-independent reading model for private and public views. */
export type ReadingKind = "books" | "recipes" | "inventory";
export type ReadingField = { key: string; label: string; value: string };
export type ReadingSection = { heading: string; content: string };

const fields: Record<ReadingKind, Array<[string, string]>> = {
  books: [["author", "Forfatter"], ["category", "Kategori"], ["series", "Serie"], ["collection", "Samling"], ["status", "Lesestatus"], ["started", "Startet"], ["finished", "Fullført"], ["rating", "Vurdering"]],
  recipes: [["category", "Kategori"], ["servings", "Porsjoner"]],
  inventory: [["category", "Kategori"], ["location", "Plassering"], ["quantity", "Antall"], ["purchased", "Kjøpt"], ["purchase-price", "Pris"], ["warranty-until", "Garanti til"], ["serial-number", "Serienummer"]]
};
const sections: Record<ReadingKind, string[]> = {
  books: ["Oppsummering", "Utdrag", "Mine tanker"],
  recipes: ["Beskrivelse", "Ingredienser", "Fremgangsmåte", "Notater"],
  inventory: ["Beskrivelse", "Notater"]
};

export function readingFields(kind: ReadingKind, metadata: Record<string, string>): ReadingField[] {
  return fields[kind].flatMap(([key, label]) => {
    const raw = metadata[key];
    if (!raw) return [];
    const value = key === "status" ? ({ "want-to-read": "Vil lese", reading: "Leser", finished: "Lest" } as Record<string, string>)[raw] ?? raw : raw;
    return [{ key, label, value }];
  });
}

export function readingSection(markdown: string, heading: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const headings = [...body.matchAll(/^##\s+(.+)\s*$/gm)];
  const at = headings.findIndex((match) => match[1].trim() === heading);
  return at < 0 ? "" : body.slice(headings[at].index! + headings[at][0].length, headings[at + 1]?.index ?? body.length).trim();
}

export function readingSections(kind: ReadingKind, markdown: string, publicView = false): ReadingSection[] {
  return sections[kind].filter((heading) => !publicView || kind !== "books" || heading !== "Mine tanker")
    .map((heading) => ({ heading, content: readingSection(markdown, heading) || (kind === "books" && heading === "Utdrag" ? readingSection(markdown, "Høydepunkter") : "") }))
    .filter(({ content }) => !!content);
}

/** A compact excerpt for collection cards in both the private and public UI. */
export function readingCardSummary(kind: ReadingKind, markdown: string): string {
  const heading = kind === "books" ? "Oppsummering" : "Beskrivelse";
  return readingSection(markdown, heading).replace(/\s+/g, " ").trim().slice(0, 160);
}
