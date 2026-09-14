/**
 * The virtual root of a server vault opened from the desktop app.
 *
 * The store thinks in absolute folder paths and keys everything per vault by
 * that path: the last opened note, the recent list, the startup vault. A
 * server vault therefore gets a path too, one that names the server rather
 * than a place on disk: `/@remote/notes.example.com/anna`. Host and base path
 * are the identity, so a server that is removed and added again finds its
 * markers, and two instances behind one host stay apart.
 *
 * No local path ever looks like this: on Windows an absolute path starts with
 * a drive letter or `\\`, and a real `/@remote` folder on Linux or macOS is
 * harmless, because POSIX path arithmetic is the right one there anyway.
 */

export const REMOTE_VAULT_ROOT_PREFIX = "/@remote/";

export function isRemoteVaultPath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(REMOTE_VAULT_ROOT_PREFIX);
}

/** `/@remote/<host[:port]><base path>` for a normalized server URL (see lib/remoteVaults.ts). */
export function remoteVaultRootFor(serverUrl: string): string {
  const url = new URL(serverUrl);
  const basePath = url.pathname.replace(/\/+$/, "");

  return `${REMOTE_VAULT_ROOT_PREFIX}${url.host}${basePath}`;
}
