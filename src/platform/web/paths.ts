import type { PathApi } from "@/platform/types";

/**
 * POSIX path arithmetic for the browser, matching what Tauri's path API does
 * for the store's purposes: `join` normalizes the result ("." and ".."
 * segments are resolved), `dirname` of a top-level path is "/". Vault paths
 * on the web are always forward-slash and absolute (see remoteStorage.ts).
 */

export function normalizePosixPath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const parts: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!isAbsolute) {
        parts.push("..");
      }

      continue;
    }

    parts.push(segment);
  }

  return (isAbsolute ? "/" : "") + parts.join("/");
}

export function joinPosixPath(...parts: string[]): string {
  return normalizePosixPath(parts.filter((part) => part.length > 0).join("/"));
}

export function posixDirname(path: string): string {
  const normalized = normalizePosixPath(path);
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash < 0) {
    return ".";
  }

  return lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
}

export const posixPaths: PathApi = {
  join: async (...parts) => joinPosixPath(...parts),
  dirname: async (path) => posixDirname(path),
  normalize: async (path) => normalizePosixPath(path)
};
