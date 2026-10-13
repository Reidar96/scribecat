import { getRelativeDisplayPath } from "@/lib/fileSystem";

const PREFIX = "scribecat://note/";

export function headingLinkHref(vaultPath: string, filePath: string, anchor: string): string {
  const relative = getRelativeDisplayPath(vaultPath, filePath).replace(/\\/g, "/");
  return `${PREFIX}${relative.split("/").map(encodeURIComponent).join("/")}${anchor}`;
}

export function parseHeadingLink(href: string): { relativePath: string; anchor: string } | null {
  if (!href.startsWith(PREFIX)) return null;
  const [rawPath, rawAnchor] = href.slice(PREFIX.length).split("#");
  if (!rawAnchor || !rawPath) return null;
  try {
    const parts = rawPath.split("/").map(decodeURIComponent);
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("/")) || !/\.md$/i.test(parts[parts.length - 1] ?? "")) return null;
    return { relativePath: parts.join("/"), anchor: `#${decodeURIComponent(rawAnchor)}` };
  } catch { return null; }
}

export function pastedHeadingHref(text: string, html: string): string | null {
  const markdown = /^\[[^\]]+\]\((scribecat:\/\/note\/[^\s)]+)\)$/.exec(text.trim());
  if (markdown && parseHeadingLink(markdown[1])) return markdown[1];
  const element = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html, "text/html").body : null;
  const href = element?.querySelector("a[href]")?.getAttribute("href") ?? "";
  return parseHeadingLink(href) ? href : null;
}
