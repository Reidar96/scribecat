import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { slugifyHeading } from "@/lib/editor/headingAnchors";

// A same-document fragment survives TipTap's URL sanitizer and cannot launch a
// browser tab. Keep parsing the old scheme for links already stored in notes.
const PREFIX = "#scribecat-note/";
const LEGACY_PREFIX = "scribecat://note/";

/** Clipboard HTML can turn a fragment into an absolute about:blank URL. */
export function normalizeHeadingHref(href: string, currentOrigin?: string): string {
  if (href.startsWith(PREFIX) || href.startsWith(LEGACY_PREFIX)) return href;
  try {
    const parsed = new URL(href);
    if (!parsed.hash.startsWith(PREFIX)) return href;
    if (parsed.href.startsWith("about:blank#") || (currentOrigin && parsed.origin === currentOrigin)) return parsed.hash;
  } catch { /* Relative links are handled by the caller. */ }
  return href;
}

export function headingLinkHref(vaultPath: string, filePath: string, anchor: string): string {
  const relative = getRelativeDisplayPath(vaultPath, filePath).replace(/\\/g, "/");
  return `${PREFIX}${relative.split("/").map(encodeURIComponent).join("/")}${anchor}`;
}

export function parseHeadingLink(href: string): { relativePath: string; anchor: string } | null {
  href = normalizeHeadingHref(href, typeof location === "undefined" ? undefined : location.origin);
  const prefix = href.startsWith(PREFIX) ? PREFIX : href.startsWith(LEGACY_PREFIX) ? LEGACY_PREFIX : null;
  if (!prefix) return null;
  const [rawPath, rawAnchor] = href.slice(prefix.length).split("#");
  if (!rawAnchor || !rawPath) return null;
  try {
    const parts = rawPath.split("/").map(decodeURIComponent);
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("/")) || !/\.md$/i.test(parts[parts.length - 1] ?? "")) return null;
    return { relativePath: parts.join("/"), anchor: `#${decodeURIComponent(rawAnchor)}` };
  } catch { return null; }
}

export function pastedHeadingHref(text: string, html: string): string | null {
  const markdown = /^\[[^\]]+\]\(((?:scribecat:\/\/note\/|#scribecat-note\/)[^\s)]+)\)$/.exec(text.trim());
  if (markdown && parseHeadingLink(markdown[1])) return markdown[1];
  const element = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html, "text/html").body : null;
  const href = element?.querySelector("a[href]")?.getAttribute("href") ?? "";
  return parseHeadingLink(href) ? normalizeHeadingHref(href, typeof location === "undefined" ? undefined : location.origin) : null;
}

/** Match the same duplicate-heading numbering used by the editor outline. */
export function headingExistsInMarkdown(markdown: string, anchor: string): boolean {
  const expected = decodeURIComponent(anchor.replace(/^#/, ""));
  const counts = new Map<string, number>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = slugifyHeading(match[1]);
    const count = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, count);
    if (`${slug}${count > 1 ? `-${count}` : ""}` === expected) return true;
  }
  return false;
}
