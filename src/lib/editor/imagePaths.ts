/**
 * Normalizes a Markdown image src for comparison.
 *
 * Markdown uses forward slashes and percent-encoding, while the same path may
 * also appear with backslashes, a "./" prefix or decoded spaces.
 */
export function normalizeImageSrc(src: string): string {
  let value = src.trim().replace(/\\/g, "/");

  try {
    value = decodeURI(value);
  } catch {
    // Malformed percent escape: compare the raw form instead.
  }

  while (value.startsWith("./")) {
    value = value.slice(2);
  }

  return value;
}
