import i18n from "@/i18n";
import { isMarkdownFileName, sortMarkdownRecords } from "@/lib/vaultPaths";
import { PlatformUnavailableError } from "@/platform/errors";
import type { VaultStorage } from "@/platform/types";

import { joinPosixPath } from "./paths";
import { ApiError, serverApi } from "./serverApi";

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

function notYetAvailable(): never {
  throw new PlatformUnavailableError(i18n.t("platform.serverNotYetAvailable"));
}

/**
 * Stage 2a of the server edition: list, read and overwrite notes. Every other
 * operation (creating, renaming, deleting, images, the `.scribedog/` sidecars
 * behind versioning and manual order) reports itself as not available yet.
 * The shared logic on top already treats those as optional: version
 * snapshots, image cleanup and sidecar writes are fire-and-forget, and the
 * sidecar readers fall back to their defaults.
 */
export const remoteVaultStorage: VaultStorage = {
  // Nothing beyond list/read/overwrite exists on the server yet; the UI
  // disables the controls behind these until the corresponding stage lands.
  capabilities: { create: false, rename: false, move: false, delete: false, images: false },
  async listMarkdownFiles(rootPath) {
    const records = (await serverApi.listFiles()).map((file) => ({
      filePath: joinPosixPath(rootPath, file.relativePath),
      relativePath: file.relativePath,
      mtimeMs: file.mtimeMs
    }));

    return sortMarkdownRecords(records);
  },

  async readTextFile(path) {
    const relativePath = toVaultRelative(path);

    if (!isMarkdownFileName(relativePath)) {
      return notYetAvailable();
    }

    return (await serverApi.readNote(relativePath)).content;
  },

  async writeTextFile(path, contents) {
    const relativePath = toVaultRelative(path);

    if (!isMarkdownFileName(relativePath)) {
      return notYetAvailable();
    }

    try {
      await serverApi.saveNote(relativePath, contents);
    } catch (error) {
      // The file API of this stage only overwrites notes that exist; a 404
      // here is "creating notes is not there yet", not a missing file.
      if (error instanceof ApiError && error.status === 404) {
        return notYetAvailable();
      }

      throw error;
    }
  },

  exists: async () => notYetAvailable(),
  stat: async () => notYetAvailable(),
  readDir: async () => notYetAvailable(),
  mkdir: async () => notYetAvailable(),
  readFile: async () => notYetAvailable(),
  writeFile: async () => notYetAvailable(),
  rename: async () => notYetAvailable(),
  remove: async () => notYetAvailable()
};
