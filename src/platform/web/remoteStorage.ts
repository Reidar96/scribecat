import i18n from "@/i18n";
import { sortMarkdownRecords } from "@/lib/vaultPaths";
import { PlatformUnavailableError } from "@/platform/errors";
import { ALL_VAULT_CAPABILITIES, type FileInfo, type VaultStorage } from "@/platform/types";

import { joinPosixPath } from "./paths";
import { serverApi } from "./serverApi";

/**
 * The one vault a ScribeDog server serves, seen through the store's
 * absolute-path model. The store works with absolute paths and derives the
 * vault-relative ones from the root (`getRelativeDisplayPath`), so the remote
 * vault gets a virtual root and every path below it maps 1:1 onto the
 * `relativePath` the server API speaks. The server never sees the root.
 */
export const REMOTE_VAULT_ROOT = "/vault";

function toVaultRelative(path: string): string {
  const normalized = joinPosixPath(path);

  if (normalized === REMOTE_VAULT_ROOT) {
    return "";
  }

  if (!normalized.startsWith(`${REMOTE_VAULT_ROOT}/`)) {
    throw new PlatformUnavailableError(i18n.t("platform.pathOutsideVault", { path }));
  }

  return normalized.slice(REMOTE_VAULT_ROOT.length + 1);
}

function toDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

/**
 * `VaultStorage` over the server's file API (server/src/vault/routes.ts):
 * one request per primitive, on paths inside the virtual root. The server
 * mirrors the semantics of Tauri's fs plugin (no implicit parent folders on
 * write, a folder is removed only when empty or with `recursive`), so the
 * shared vault logic behaves the same as on a local folder.
 */
export const remoteVaultStorage: VaultStorage = {
  capabilities: ALL_VAULT_CAPABILITIES,

  async listMarkdownFiles(rootPath) {
    const records = (await serverApi.listFiles()).map((file) => ({
      filePath: joinPosixPath(rootPath, file.relativePath),
      relativePath: file.relativePath,
      mtimeMs: file.mtimeMs
    }));

    return sortMarkdownRecords(records);
  },

  // All async so a path outside the root rejects instead of throwing
  // synchronously into a caller that expects a promise.
  exists: async (path) => serverApi.exists(toVaultRelative(path)),

  async stat(path): Promise<FileInfo> {
    const info = await serverApi.stat(toVaultRelative(path));

    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      size: info.size,
      mtime: toDate(info.mtimeMs),
      birthtime: toDate(info.birthtimeMs)
    };
  },

  readDir: async (path) => serverApi.readDir(toVaultRelative(path)),
  mkdir: async (path, options) => serverApi.mkdir(toVaultRelative(path), options?.recursive === true),
  readTextFile: async (path) => serverApi.readText(toVaultRelative(path)),
  async writeTextFile(path, contents) {
    await serverApi.writeText(toVaultRelative(path), contents);
  },
  readFile: async (path) => serverApi.readBytes(toVaultRelative(path)),
  async writeFile(path, data) {
    await serverApi.writeBytes(toVaultRelative(path), data);
  },
  rename: async (oldPath, newPath) => serverApi.rename(toVaultRelative(oldPath), toVaultRelative(newPath)),
  remove: async (path, options) => serverApi.remove(toVaultRelative(path), options?.recursive === true)
};
