import { useEffect } from "react";

import { clearLastOpenedFolderPath, getLastOpenedFolderPath } from "@/lib/fileSystem";
import { platform } from "@/platform";

export function useStartupFolder(
  openFolderAtPath: (folderPath: string) => Promise<boolean>
): void {
  useEffect(() => {
    let isActive = true;

    const loadStartupFolder = async () => {
      const startupFolderPath = await platform.vault.getStartupFolderPath();
      const targetFolderPath =
        startupFolderPath ?? (platform.features.localFolders ? getLastOpenedFolderPath() : null);

      if (!isActive || !targetFolderPath) {
        return;
      }

      const didOpenFolder = await openFolderAtPath(targetFolderPath);

      if (!didOpenFolder && !startupFolderPath) {
        clearLastOpenedFolderPath();
      }
    };

    void loadStartupFolder();

    return () => {
      isActive = false;
    };
  }, [openFolderAtPath]);
}
