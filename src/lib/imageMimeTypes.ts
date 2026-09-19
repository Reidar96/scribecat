/**
 * Image type from a file name. Pure on purpose: the platform layer needs it
 * for the desktop image picker, and `fileSystem.ts` (which re-exports it)
 * imports the platform, so it cannot live there without a cycle.
 */
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp"
};

export function guessImageMimeType(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}
