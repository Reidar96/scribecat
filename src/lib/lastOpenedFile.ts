/**
 * Which note was open in a vault the last time, so the next start lands
 * where the work stopped. Kept per device (localStorage), like the sidebar
 * width, not in the vault: two devices on one server vault may well have
 * different notes open.
 */

const STORAGE_KEY_PREFIX = "scribecat-last-file:";

export function getLastOpenedRelativePath(folderPath: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${folderPath}`);
  } catch {
    return null;
  }
}

export function setLastOpenedRelativePath(folderPath: string, relativePath: string | null): void {
  try {
    if (relativePath === null) {
      window.localStorage.removeItem(`${STORAGE_KEY_PREFIX}${folderPath}`);
    } else {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${folderPath}`, relativePath);
    }
  } catch {
    // Storage may be unavailable (private mode, quota); losing the bookmark
    // is the whole consequence.
  }
}
