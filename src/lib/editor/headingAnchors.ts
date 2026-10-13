import type { OutlineHeading } from "@/lib/editor/documentOutline";

/** A stable, URL-safe fragment for a heading, shared by copy and navigation. */
export function slugifyHeading(title: string): string {
  const slug = title.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function headingAnchor(headings: OutlineHeading[], pos: number): string | null {
  const index = headings.findIndex((heading) => heading.pos === pos);
  if (index === -1) return null;
  const slug = slugifyHeading(headings[index].title);
  const duplicate = headings.slice(0, index).filter((heading) => slugifyHeading(heading.title) === slug).length;
  return `#${slug}${duplicate ? `-${duplicate + 1}` : ""}`;
}

export function headingMatchesAnchor(elements: Element[], anchor: string): Element | null {
  const expected = decodeURIComponent(anchor.replace(/^#/, ""));
  const counts = new Map<string, number>();
  for (const element of elements) {
    const slug = slugifyHeading(element.textContent ?? "");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    if (`${slug}${count ? `-${count + 1}` : ""}` === expected) return element;
  }
  return null;
}
