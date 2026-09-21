import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { removeIconPath, renameIconPath, type VaultIconMap } from "@/lib/vaultIcons";
import { writeVaultIcons } from "@/lib/vaultMeta";

/**
 * Writes the icon sidecar only when the map actually changed. The functions
 * in lib/vaultIcons.ts return the map they were given when a call was a
 * no-op, so a reference comparison is enough — the same contract
 * persistManualOrderIfChanged relies on.
 *
 * Fire and forget, like the manual order: an icon that fails to persist is
 * not worth interrupting a rename or a move for, and the next change writes
 * the whole map again anyway.
 */
export function persistVaultIconsIfChanged(
  vaultFolderPath: string,
  previous: VaultIconMap,
  next: VaultIconMap
): void {
  if (next !== previous) {
    void writeVaultIcons(vaultFolderPath, next).catch(() => undefined);
  }
}

/**
 * Carries an entry's icon (and, for a folder, the icons of everything below
 * it) to the path it was renamed or moved to, and persists the result. The
 * paths arrive absolute, as the store's actions have them; the sidecar is
 * keyed vault-relative so it travels with the folder.
 *
 * Every action that changes a path calls this. An icon that stayed behind
 * would attach itself to whatever file is created under the old name next,
 * which is worse than losing it.
 */
export function moveVaultIcons(
  vaultFolderPath: string,
  icons: VaultIconMap,
  fromPath: string,
  toPath: string
): VaultIconMap {
  const next = renameIconPath(
    icons,
    getRelativeDisplayPath(vaultFolderPath, fromPath),
    getRelativeDisplayPath(vaultFolderPath, toPath)
  );

  persistVaultIconsIfChanged(vaultFolderPath, icons, next);

  return next;
}

/** The same for a deletion: the entry's icon and its subtree's go with it. */
export function dropVaultIcons(
  vaultFolderPath: string,
  icons: VaultIconMap,
  removedPath: string
): VaultIconMap {
  const next = removeIconPath(icons, getRelativeDisplayPath(vaultFolderPath, removedPath));

  persistVaultIconsIfChanged(vaultFolderPath, icons, next);

  return next;
}
