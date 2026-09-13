import { watch, type FSWatcher } from "node:fs";

import { VAULT_META_DIR_NAME } from "./paths.js";


/** Same idea as the frontend's 150 ms debounce: one event per burst of writes. */
const DEBOUNCE_MS = 200;

export type VaultWatcher = {
  /** Called at most once per burst of changes; returns the unsubscribe. */
  subscribe(handler: () => void): () => void;
  close(): void;
};

/**
 * The server-side counterpart of the desktop app's native folder watcher
 * (`watch_folder` in src-tauri/src/lib.rs): one "something in the vault
 * changed" signal that the frontend answers with a refresh of the file
 * list. Coarse on purpose: which file changed does not matter to the
 * consumer, and a recursive rescan is what the desktop does too.
 *
 * Changes under `.scribedog/` are not reported. The frontend writes there
 * itself on every save (version snapshots, manual order), and the server
 * keeps its own state there; neither is a reason to rescan the notes.
 */
export function createVaultWatcher(vaultRealPath: string, log: { warn(message: string): void }): VaultWatcher {
  const handlers = new Set<() => void>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  const emit = () => {
    timer = null;

    for (const handler of handlers) {
      try {
        handler();
      } catch {
        // A broken subscriber must not take the others down.
      }
    }
  };

  const onChange = (_eventType: string, fileName: string | Buffer | null) => {
    const name = typeof fileName === "string" ? fileName : fileName?.toString() ?? "";
    const firstSegment = name.split(/[\\/]/)[0];

    if (firstSegment === VAULT_META_DIR_NAME) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(emit, DEBOUNCE_MS);
  };

  try {
    // Recursive watching is native on Linux since Node 20 (inotify per
    // directory, managed by libuv) and on macOS/Windows for far longer.
    watcher = watch(vaultRealPath, { recursive: true, persistent: false }, onChange);
    watcher.on("error", (error) => {
      log.warn(`Vault watcher stopped: ${error.message}. Live updates are off until restart.`);
    });
  } catch (error) {
    log.warn(`Vault watcher could not start: ${(error as Error).message}. Live updates are off.`);
  }

  return {
    subscribe(handler) {
      handlers.add(handler);

      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      handlers.clear();
      watcher?.close();
      watcher = null;
    }
  };
}
