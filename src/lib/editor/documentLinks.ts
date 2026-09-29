import { buildFileLinkHref, isFileLinkHref, resolveFileLinkTarget } from "./fileLinks";

/**
 * Reading links back out of Markdown — what the links/backlinks panel is built
 * on. Inline links only: images (`![alt](src)`) are skipped, and reference
 * definitions are not part of what the editor ever writes.
 */

// Matches the destination of an inline link: "](" followed by either an
// angle-bracketed destination or a run of characters up to the first
// unescaped ")" or whitespace (a title).
const MARKDOWN_LINK_PATTERN =
  /(!?)\[(?:\\.|[^[\]\\])*\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s])*)/g;

function unescapeDestination(destination: string): string {
  const withoutBrackets =
    destination.startsWith("<") && destination.endsWith(">")
      ? destination.slice(1, -1)
      : destination;

  return withoutBrackets.replace(/\\(.)/g, "$1");
}

/** Every inline link destination of the document, in document order. */
export function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const [, imageMarker, destination] = match;

    if (imageMarker === "!" || !destination) {
      continue;
    }

    hrefs.push(unescapeDestination(destination));
  }

  return hrefs;
}

/** Update Markdown links when their target (or the source document) moves. */
export function rewriteMovedMarkdownLinks(
  markdown: string,
  oldSourcePath: string,
  newSourcePath: string,
  oldVaultFilePaths: string[],
  moved: { sourcePath: string; targetPath: string }
): string {
  const pattern = /(!?)\[(?:\\.|[^\[\]\\])*\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s])*)/g;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const normalizedRoot = moved.sourcePath.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
  const mapMovedPath = (path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");
    const lower = normalizedPath.toLocaleLowerCase();
    if (lower !== normalizedRoot && !lower.startsWith(`${normalizedRoot}/`)) return null;
    const suffix = normalizedPath.slice(moved.sourcePath.replace(/\\/g, "/").replace(/\/$/, "").length);
    return `${moved.targetPath.replace(/\\/g, "/").replace(/\/$/, "")}${suffix}`;
  };

  for (const match of markdown.matchAll(pattern)) {
    const [whole, imageMarker, rawDestination] = match;
    const matchIndex = match.index;
    if (imageMarker === "!" || !rawDestination || matchIndex === undefined) continue;
    const href = unescapeDestination(rawDestination);
    if (!isFileLinkHref(href)) continue;
    const targetPath = resolveFileLinkTarget(href, oldSourcePath, oldVaultFilePaths);
    if (!targetPath) continue;
    const movedTarget = mapMovedPath(targetPath);
    const movedSource = mapMovedPath(oldSourcePath) ?? newSourcePath;
    if (!movedTarget && movedSource === oldSourcePath) continue;
    const suffix = href.match(/[?#].*$/)?.[0] ?? "";
    const replacement = `${buildFileLinkHref(movedSource, movedTarget ?? targetPath)}${suffix}`;
    const destinationStart = matchIndex + whole.indexOf(rawDestination);
    replacements.push({ start: destinationStart, end: destinationStart + rawDestination.length, value: replacement });
  }

  const embeds = /!\[\[([^\]]+)\]\]/g;
  for (const match of markdown.matchAll(embeds)) {
    const rawDestination = match[1];
    const matchIndex = match.index;
    if (!rawDestination || matchIndex === undefined) continue;
    const targetPath = resolveFileLinkTarget(rawDestination, oldSourcePath, oldVaultFilePaths);
    if (!targetPath) continue;
    const movedTarget = mapMovedPath(targetPath);
    const movedSource = mapMovedPath(oldSourcePath) ?? newSourcePath;
    if (!movedTarget && movedSource === oldSourcePath) continue;
    const suffix = rawDestination.match(/[?#].*$/)?.[0] ?? "";
    const replacement = `${buildFileLinkHref(movedSource, movedTarget ?? targetPath)}${suffix}`;
    const destinationStart = matchIndex + match[0].indexOf(rawDestination);
    replacements.push({ start: destinationStart, end: destinationStart + rawDestination.length, value: replacement });
  }

  if (!replacements.length) return markdown;
  replacements.sort((left, right) => left.start - right.start);
  let output = "";
  let cursor = 0;
  for (const replacement of replacements) {
    output += markdown.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  return output + markdown.slice(cursor);
}

export type OutgoingFileLink = {
  href: string;
  /** `null` when the href points at no note of the opened vault (any more). */
  targetFilePath: string | null;
};

/**
 * The document's links to other notes of the vault, deduplicated by href and
 * without the document's own self-links.
 */
export function collectOutgoingFileLinks(
  markdown: string,
  sourceFilePath: string,
  vaultFilePaths: string[]
): OutgoingFileLink[] {
  const links: OutgoingFileLink[] = [];
  const seenHrefs = new Set<string>();

  for (const href of extractMarkdownLinkHrefs(markdown)) {
    if (!isFileLinkHref(href) || seenHrefs.has(href)) {
      continue;
    }

    seenHrefs.add(href);

    const targetFilePath = resolveFileLinkTarget(href, sourceFilePath, vaultFilePaths);

    if (targetFilePath === sourceFilePath) {
      continue;
    }

    links.push({ href, targetFilePath });
  }

  return links;
}

export type BacklinkSource = {
  filePath: string;
  markdown: string;
};

export type Backlink = {
  filePath: string;
  /** How many links of that note point here. */
  count: number;
};

/** Every note of the vault that links to `targetFilePath`. */
export function collectBacklinks(
  targetFilePath: string,
  sources: BacklinkSource[],
  vaultFilePaths: string[]
): Backlink[] {
  const backlinks: Backlink[] = [];

  for (const source of sources) {
    if (source.filePath === targetFilePath) {
      continue;
    }

    let count = 0;

    for (const href of extractMarkdownLinkHrefs(source.markdown)) {
      if (!isFileLinkHref(href)) {
        continue;
      }

      if (resolveFileLinkTarget(href, source.filePath, vaultFilePaths) === targetFilePath) {
        count += 1;
      }
    }

    if (count > 0) {
      backlinks.push({ filePath: source.filePath, count });
    }
  }

  return backlinks.sort((left, right) =>
    left.filePath.localeCompare(right.filePath, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}
