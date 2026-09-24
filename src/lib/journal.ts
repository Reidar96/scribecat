import { composeFrontmatter, splitFrontmatter } from "@/lib/documentFrontmatter";

export type JournalStructure = "norwegian" | "iso" | "year";
export type JournalDate = { year: number; month: number; day: number };

export type JournalSettings = {
  folder: string;
  structure: JournalStructure;
  hideFromSidebar: boolean;
};

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = {
  folder: "Dagbok",
  structure: "norwegian",
  hideFromSidebar: false
};

const IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*<?([^()<>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;
const GALLERY_HEADING = /^##\s+(?:Bilder|Images)\s*$/im;
const LEADING_TITLE = /^#\s+(.+)\r?\n(?:\r?\n)?/;

export type JournalImage = {
  alt: string;
  src: string;
};

function cleanFolder(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

export function normalizeJournalSettings(value: unknown): JournalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_JOURNAL_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  const structure: JournalStructure =
    record.structure === "iso" || record.structure === "year" || record.structure === "norwegian"
      ? record.structure
      : DEFAULT_JOURNAL_SETTINGS.structure;

  return {
    folder:
      typeof record.folder === "string" && cleanFolder(record.folder)
        ? cleanFolder(record.folder)
        : DEFAULT_JOURNAL_SETTINGS.folder,
    structure,
    hideFromSidebar: record.hideFromSidebar === true
  };
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function journalDateKey(date: JournalDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function isValidJournalDate(date: JournalDate): boolean {
  if (
    !Number.isInteger(date.year) ||
    !Number.isInteger(date.month) ||
    !Number.isInteger(date.day) ||
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1
  ) {
    return false;
  }

  return date.day <= new Date(date.year, date.month, 0).getDate();
}

export function journalRelativePath(
  date: JournalDate,
  settings: JournalSettings
): string {
  const folder = cleanFolder(settings.folder);
  const year = String(date.year);
  const month = pad2(date.month);
  const day = pad2(date.day);

  if (settings.structure === "iso") {
    return [folder, year, month, `${year}-${month}-${day}.md`].filter(Boolean).join("/");
  }

  if (settings.structure === "year") {
    return [folder, year, `${year}-${month}-${day}.md`].filter(Boolean).join("/");
  }

  return [folder, year, `${month}-${year}`, `${day}-${month}-${year}.md`]
    .filter(Boolean)
    .join("/");
}

function parseIntPart(value: string): number {
  return Number.parseInt(value, 10);
}

export function journalDateFromRelativePath(
  relativePath: string,
  settings: JournalSettings
): JournalDate | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const folder = cleanFolder(settings.folder);
  const prefix = folder ? folder + "/" : "";

  if (!normalized.startsWith(prefix)) {
    return null;
  }

  const tail = normalized.slice(prefix.length);
  let match: RegExpExecArray | null = null;
  let date: JournalDate | null = null;

  if (settings.structure === "iso") {
    match = /^(\d{4})\/(\d{2})\/(\d{4})-(\d{2})-(\d{2})\.md$/i.exec(tail);
    if (match && match[1] === match[3] && match[2] === match[4]) {
      date = {
        year: parseIntPart(match[1]),
        month: parseIntPart(match[2]),
        day: parseIntPart(match[5])
      };
    }
  } else if (settings.structure === "year") {
    match = /^(\d{4})\/(\d{4})-(\d{2})-(\d{2})\.md$/i.exec(tail);
    if (match && match[1] === match[2]) {
      date = {
        year: parseIntPart(match[1]),
        month: parseIntPart(match[3]),
        day: parseIntPart(match[4])
      };
    }
  } else {
    match = /^(\d{4})\/(\d{2})-(\d{4})\/(\d{2})-(\d{2})-(\d{4})\.md$/i.exec(tail);
    if (match && match[1] === match[3] && match[1] === match[6] && match[2] === match[5]) {
      date = {
        year: parseIntPart(match[1]),
        month: parseIntPart(match[2]),
        day: parseIntPart(match[4])
      };
    }
  }

  return date && isValidJournalDate(date) ? date : null;
}

export function isJournalRelativePath(relativePath: string, settings: JournalSettings): boolean {
  const folder = cleanFolder(settings.folder);
  if (!folder) return false;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === folder || normalized.startsWith(folder + "/");
}

export function createJournalMarkdown(title: string): string {
  return `# ${title}\n\n\n## Bilder\n`;
}

function imagesIn(markdown: string): JournalImage[] {
  return Array.from(markdown.matchAll(IMAGE_PATTERN), (match) => ({
    alt: match[1] ?? "",
    src: match[2] ?? ""
  }));
}

function stripImageOnlyLines(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => {
      const withoutImages = line.replace(IMAGE_PATTERN, "").replace(/\|/g, "").trim();
      if (withoutImages) return true;
      return !/!\[[^\]]*\]\(/.test(line);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLeadingTitle(body: string): { title: string | null; body: string } {
  const match = LEADING_TITLE.exec(body);

  if (!match) {
    return { title: null, body };
  }

  return {
    title: match[1].trim() || null,
    body: body.slice(match[0].length)
  };
}

export function parseJournalMarkdown(markdown: string): {
  title: string | null;
  textMarkdown: string;
  images: JournalImage[];
} {
  const { body: fullBody } = splitFrontmatter(markdown);
  const { title, body } = splitLeadingTitle(fullBody);
  const heading = GALLERY_HEADING.exec(body);

  if (heading) {
    const before = body.slice(0, heading.index).trimEnd();
    const afterStart = heading.index + heading[0].length;
    const after = body.slice(afterStart);
    const nextHeading = /^##\s+.+$/m.exec(after);
    const gallery = nextHeading ? after.slice(0, nextHeading.index) : after;
    const remainder = nextHeading ? after.slice(nextHeading.index).trimStart() : "";
    return {
      title,
      textMarkdown: [before, remainder].filter(Boolean).join("\n\n").trim(),
      images: imagesIn(gallery)
    };
  }

  const images = imagesIn(body);
  return {
    title,
    textMarkdown: stripImageOnlyLines(body),
    images
  };
}

export function composeJournalMarkdown(
  originalMarkdown: string,
  textMarkdown: string,
  images: JournalImage[]
): string {
  const { frontmatter, body: originalBody } = splitFrontmatter(originalMarkdown);
  const { title } = splitLeadingTitle(originalBody);
  const text = textMarkdown.trim();
  const gallery =
    images.length > 0
      ? `## Bilder\n\n${images
          .map((image) => `![${image.alt.replace(/\]/g, "\\]")}](${image.src})`)
          .join("\n\n")}`
      : "## Bilder";
  const body = [title ? `# ${title}` : "", text, gallery]
    .filter(Boolean)
    .join("\n\n") + "\n";

  return composeFrontmatter(frontmatter, body);
}
