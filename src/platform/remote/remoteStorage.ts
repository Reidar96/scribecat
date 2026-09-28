import i18n from "@/i18n";
import { sortMarkdownRecords } from "@/lib/vaultPaths";
import { PlatformUnavailableError } from "@/platform/errors";
import { ALL_VAULT_CAPABILITIES, type FileInfo, type VaultStorage } from "@/platform/types";
import { cachedFileInfo, getCached, getCachedMarkdownIndex, putCached, setCachedMarkdownIndex } from "./offlineCache";

import { joinPosixPath } from "./paths";
import type { RemoteMarkdownFileRecord, ServerApi } from "./serverApi";

function toDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

function firstRelativeImagePath(markdown: string, markdownPath: string): string | null {
  const match = /!\[[^\]]*\]\(\s*<?([^()< >\s]+)>?/.exec(markdown);
  const raw = match?.[1];
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return null;
  let source = raw.split(/[?#]/, 1)[0];
  try { source = decodeURIComponent(source); } catch { /* retain literal percent escapes */ }
  const parts = raw.startsWith("/") ? [] : markdownPath.split("/").slice(0, -1);
  for (const part of source.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/") || null;
}

/**
 * `VaultStorage` over the server's file API (server/src/vault/routes.ts),
 * seen through the store's absolute-path model. The store works with
 * absolute paths and derives the vault-relative ones from the root
 * (`getRelativeDisplayPath`), so a remote vault gets a virtual root and every
 * path below it maps 1:1 onto the `relativePath` the server API speaks. The
 * server never sees the root.
 *
 * One request per primitive. The server mirrors the semantics of Tauri's fs
 * plugin (no implicit parent folders on write, a folder is removed only when
 * empty or with `recursive`), so the shared vault logic behaves the same as
 * on a local folder.
 */
export function createRemoteVaultStorage(api: ServerApi, root: string): VaultStorage {
  function toVaultRelative(path: string): string {
    // The desktop store may hand over a path with the other separator; the
    // server speaks forward slashes only.
    const normalized = joinPosixPath(path.replace(/\\/g, "/"));

    if (normalized === root) {
      return "";
    }

    if (!normalized.startsWith(`${root}/`)) {
      throw new PlatformUnavailableError(i18n.t("platform.pathOutsideVault", { path }));
    }

    return normalized.slice(root.length + 1);
  }

  return {
    capabilities: ALL_VAULT_CAPABILITIES,

    async listMarkdownFiles(rootPath) {
      let remoteFiles: RemoteMarkdownFileRecord[];
      try {
        remoteFiles = await api.listFiles();
        void setCachedMarkdownIndex(root, remoteFiles).catch(() => undefined);
      } catch (error) {
        const cachedFiles = await getCachedMarkdownIndex(root).catch(() => null);
        if (!cachedFiles) throw error;
        remoteFiles = cachedFiles;
      }

      const records = remoteFiles.map((file) => ({
        filePath: joinPosixPath(rootPath, file.relativePath), relativePath: file.relativePath, mtimeMs: file.mtimeMs
      }));

      // Hydrate the persistent cache after the listing returns. The first
      // open stays responsive while every note and directory is copied for
      // the next offline launch.
      void (async () => {
        const pending = remoteFiles;
        let cursor = 0;
        const hydrateDirectory = async (path: string): Promise<void> => {
          let entries;
          try { entries = await api.readDir(path); } catch { return; }
          if (!Array.isArray(entries)) return;
          const info = await Promise.resolve().then(() => api.stat(path)).catch(() => null);
          await putCached(root, path, { kind: "directory", entries, info }).catch(() => undefined);
          if (info) void putCached(root, `${path}\u0000stat`, { kind: "stat", info }).catch(() => undefined);
          for (const entry of entries) {
            if (entry.isDirectory && !entry.isSymlink && entry.name !== ".scribecat") {
              await hydrateDirectory(path ? `${path}/${entry.name}` : entry.name);
            }
          }
        };
        const directoryHydration = hydrateDirectory("");
        const workers = Array.from({ length: 6 }, async () => {
          while (cursor < pending.length) {
            const file = pending[cursor++];
            const previous = await getCached(root, file.relativePath).catch(() => null);
            if (previous?.kind === "text" && previous.mtimeMs === file.mtimeMs) continue;
            try {
              const markdown = await api.readText(file.relativePath);
              await putCached(root, file.relativePath, { kind: "text", content: markdown, mtimeMs: file.mtimeMs });
              const firstImage = firstRelativeImagePath(markdown, file.relativePath);
              if (firstImage) {
                const cachedImage = await getCached(root, firstImage).catch(() => null);
                if (cachedImage?.kind !== "bytes") {
                  try { await putCached(root, firstImage, { kind: "bytes", bytes: Array.from(await api.readBytes(firstImage)), mtimeMs: null }); }
                  catch { /* image remains available online; text cache is still valid */ }
                }
              }
            }
            catch { /* the online listing is still useful if a file disappears during hydration */ }
          }
        });
        await Promise.all([...workers, directoryHydration]);
      })().catch(() => undefined);

      return sortMarkdownRecords(records);
    },

    // All async so a path outside the root rejects instead of throwing
    // synchronously into a caller that expects a promise.
    async exists(path) {
      const relative = toVaultRelative(path);
      try { return await api.exists(relative); }
      catch {
        const cached = await getCached(root, relative).catch(() => null);
        return cached !== null;
      }
    },

    async stat(path): Promise<FileInfo> {
      const relative = toVaultRelative(path);
      try {
        const info = await api.stat(relative);
        void putCached(root, `${relative}\u0000stat`, { kind: "stat", info }).catch(() => undefined);
        return cachedFileInfo(info);
      } catch (error) {
        const cached = await getCached(root, `${relative}\u0000stat`).catch(() => null);
        if (cached?.kind === "stat") return cachedFileInfo(cached.info);
        const content = await getCached(root, relative).catch(() => null);
        if ((content?.kind === "text" || content?.kind === "bytes") && content.mtimeMs !== null) {
          return { isFile: true, isDirectory: false, isSymlink: false, size: content.kind === "text" ? new TextEncoder().encode(content.content).length : content.bytes.length, mtime: toDate(content.mtimeMs), birthtime: null };
        }
        throw error;
      }
    },

    async readDir(path) {
      const relative = toVaultRelative(path);
      try {
        const entries = await api.readDir(relative);
        const info = await Promise.resolve().then(() => api.stat(relative)).catch(() => null);
        void putCached(root, relative, { kind: "directory", entries, info }).catch(() => undefined);
        if (info) void putCached(root, `${relative}\u0000stat`, { kind: "stat", info }).catch(() => undefined);
        return entries;
      } catch (error) {
        const cached = await getCached(root, relative).catch(() => null);
        if (cached?.kind === "directory") return cached.entries;
        throw error;
      }
    },
    mkdir: async (path, options) => api.mkdir(toVaultRelative(path), options?.recursive === true),
    async readTextFile(path) {
      const relative = toVaultRelative(path);
      try {
        const content = await api.readText(relative);
        const previous = await getCached(root, relative).catch(() => null);
        const knownMtime = previous?.kind === "text" || previous?.kind === "bytes" ? previous.mtimeMs : null;
        void putCached(root, relative, { kind: "text", content, mtimeMs: knownMtime }).catch(() => undefined);
        return content;
      } catch (error) {
        const cached = await getCached(root, relative).catch(() => null);
        if (cached?.kind === "text") return cached.content;
        throw error;
      }
    },
    async writeTextFile(path, contents) {
      const relative = toVaultRelative(path);
      // Offline edits stay in the persistent draft store. Keep this cached
      // server copy intact as the baseline for the later conflict comparison.
      const result = await api.writeText(relative, contents);
      void putCached(root, relative, { kind: "text", content: contents, mtimeMs: result.mtimeMs }).catch(() => undefined);
    },
    async readFile(path) {
      const relative = toVaultRelative(path);
      try {
        const bytes = await api.readBytes(relative);
        const previous = await getCached(root, relative).catch(() => null);
        const knownMtime = previous?.kind === "text" || previous?.kind === "bytes" ? previous.mtimeMs : null;
        void putCached(root, relative, { kind: "bytes", bytes: Array.from(bytes), mtimeMs: knownMtime }).catch(() => undefined);
        return bytes;
      } catch (error) {
        const cached = await getCached(root, relative).catch(() => null);
        if (cached?.kind === "bytes") return new Uint8Array(cached.bytes);
        throw error;
      }
    },
    async writeFile(path, data) {
      const relative = toVaultRelative(path);
      try {
        const result = await api.writeBytes(relative, data);
        void putCached(root, relative, { kind: "bytes", bytes: Array.from(data), mtimeMs: result.mtimeMs }).catch(() => undefined);
      } catch (error) {
        void putCached(root, relative, { kind: "bytes", bytes: Array.from(data), mtimeMs: null }).catch(() => undefined);
        throw error;
      }
    },
    rename: async (oldPath, newPath) => api.rename(toVaultRelative(oldPath), toVaultRelative(newPath)),
    remove: async (path, options) => api.remove(toVaultRelative(path), options?.recursive === true),
    packFolder: async (folderPath) => api.packFolder(toVaultRelative(folderPath))
  };
}
