import { useEffect } from "react";

import { platform } from "@/platform";
import { useAppStore } from "@/store/useAppStore";

export function useFolderWatcher(refreshFolderFiles: () => Promise<boolean>): void {
  useEffect(() => {
    let isMounted = true;
    let debounceHandle: number | undefined;
    let unlisten: (() => void) | null = null;

    const registerListener = async () => {
      const cleanup = await platform.vault.onFolderFilesChanged((changedFolderPath) => {
        const currentFolderPath = useAppStore.getState().folderPath;

        if (!currentFolderPath || changedFolderPath !== currentFolderPath) {
          return;
        }

        if (debounceHandle !== undefined) {
          window.clearTimeout(debounceHandle);
        }

        debounceHandle = window.setTimeout(() => {
          if (isMounted) {
            void refreshFolderFiles();
          }
        }, 150);
      });

      unlisten = cleanup;
    };

    void registerListener();

    return () => {
      isMounted = false;

      if (debounceHandle !== undefined) {
        window.clearTimeout(debounceHandle);
      }

      unlisten?.();
    };
  }, [refreshFolderFiles]);
}
