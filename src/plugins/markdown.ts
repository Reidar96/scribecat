import { splitFrontmatter } from "@/lib/documentFrontmatter";
import type { PluginId } from "@/plugins/registry";

export function pluginMetadata(markdown: string): Record<string, string> {
  const { frontmatter } = splitFrontmatter(markdown);
  const result: Record<string, string> = {};
  for (const line of frontmatter?.split(/\r?\n/) ?? []) {
    const match = /^([a-z][\w-]*)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const value = match[2].trim();
      result[match[1].toLowerCase()] = value.startsWith('"') && value.endsWith('"')
        ? (() => { try { return String(JSON.parse(value)); } catch { return value.slice(1, -1); } })()
        : value.replace(/^'|'$/g, "");
    }
  }
  return result;
}

export function pluginSlug(value: string): string {
  return safeDocumentName(value).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "oppskrift";
}

export function newPluginDocument(id: PluginId, title: string): string {
  const safeTitle = title.replace(/[\r\n]/g, " ").trim();
  const quoted = JSON.stringify(safeTitle);
  const date = new Date().toISOString();
  const common = `scribecat-plugin: ${id}\n`;
  switch (id) {
    case "quick-notes": return `---\n${common}type: quick-note\ncreated: ${date}\npinned: false\n---\n\n`;
    case "books": return `---\n${common}type: book\ntitle: ${quoted}\nauthor: ""\nstatus: want-to-read\nrating: ""\n---\n\n# ${safeTitle}\n\n## Oppsummering\n\n## Høydepunkter\n\n## Mine tanker\n\n`;
    case "shopping": return `---\n${common}type: shopping-list\ntitle: ${quoted}\nslug: ${pluginSlug(safeTitle)}\ndate: ${date.slice(0, 10)}\npublished: false\n---\n\n# ${safeTitle}\n\n## Annet\n\n`;
    case "recipes": return `---\n${common}type: recipe\ntitle: ${quoted}\nslug: ${pluginSlug(safeTitle)}\nservings: 4\nfavorite: false\npublished: false\n---\n\n# ${safeTitle}\n\n## Ingredienser\n\n- \n\n## Fremgangsmåte\n\n1. \n\n## Notater\n\n`;
    case "inventory": return `---\n${common}type: item\nname: ${quoted}\ncategory: ""\nlocation: ""\nquantity: 1\n---\n\n# ${safeTitle}\n\n## Notater\n\n## Vedlikehold\n\n`;
    default: throw new Error(`No Markdown template for ${id}`);
  }
}

export function safeDocumentName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+|\.+$/g, "").slice(0, 90) || "Nytt notat";
}

export function setPluginField(markdown: string, key: string, value: string | boolean): string {
  if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error("Invalid field");
  const { frontmatter, body } = splitFrontmatter(markdown);
  const line = `${key}: ${typeof value === "boolean" ? String(value) : JSON.stringify(value)}`;
  const current = frontmatter ?? "";
  const matcher = new RegExp(`^${key}:.*$`, "m");
  const updated = matcher.test(current) ? current.replace(matcher, line) : `${current.trim()}\n${line}`.trim();
  return `---\n${updated}\n---\n${body}`;
}

export function setPluginTitle(markdown: string, key: "title" | "name", title: string): string {
  const safe = title.trim().replace(/[\r\n]/g, " ");
  const updated = setPluginField(markdown, key, safe);
  const { frontmatter, body } = splitFrontmatter(updated);
  return `---\n${frontmatter}\n---\n${body.replace(/^# [^\n]*$/m, `# ${safe}`)}`;
}

export function pluginSection(markdown: string, heading: string): string {
  const { body } = splitFrontmatter(markdown);
  const headings = [...body.matchAll(/^##\s+(.+)\s*$/gm)];
  const at = headings.findIndex((match) => match[1].trim() === heading);
  if (at < 0) return "";
  return body.slice(headings[at].index! + headings[at][0].length, headings[at + 1]?.index ?? body.length).trim();
}

export function setPluginSection(markdown: string, heading: string, content: string): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const headings = [...body.matchAll(/^##\s+(.+)\s*$/gm)];
  const at = headings.findIndex((match) => match[1].trim() === heading);
  const section = `## ${heading}\n\n${content.trim()}\n\n`;
  const updated = at < 0 ? `${body.trimEnd()}\n\n${section}`
    : body.slice(0, headings[at].index) + section + body.slice(headings[at + 1]?.index ?? body.length);
  return `${frontmatter ? `---\n${frontmatter}\n---\n` : ""}${updated}`;
}

export function moveMarkdownSection(markdown: string, heading: string, direction: -1 | 1): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const matches = [...body.matchAll(/^##\s+(.+)$/gm)];
  const sections = matches.map((match, index) => ({
    title: match[1], text: body.slice(match.index, matches[index + 1]?.index ?? body.length)
  }));
  const from = sections.findIndex((section) => section.title === heading);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sections.length) return markdown;
  [sections[from], sections[to]] = [sections[to], sections[from]];
  return `${frontmatter ? `---\n${frontmatter}\n---\n` : ""}${body.slice(0, matches[0].index)}${sections.map((section) => section.text).join("")}`;
}
