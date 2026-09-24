import { useEffect, useState } from "react";

import { clearLastOpenedFolderPath, getLastOpenedFolderPath } from "@/lib/fileSystem";
import { platform } from "@/platform";

export function useStartupFolder(
  openFolderAtPath: (folderPath: string) => Promise<boolean>
): boolean {
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadStartupFolder = async () => {
      const startupFolderPath = await platform.vault.getStartupFolderPath();
      const targetFolderPath =
        startupFolderPath ?? (platform.features.localFolders ? getLastOpenedFolderPath() : null);

      if (!isActive) {
        return;
      }

      if (!targetFolderPath) {
        setResolved(true);
        return;
      }

      const didOpenFolder = await openFolderAtPath(targetFolderPath);

      if (!didOpenFolder && !startupFolderPath) {
        clearLastOpenedFolderPath();
      }

      if (isActive) {
        setResolved(true);
      }
    };

    void loadStartupFolder();

    return () => {
      isActive = false;
    };
  }, [openFolderAtPath]);

  return resolved;
}
