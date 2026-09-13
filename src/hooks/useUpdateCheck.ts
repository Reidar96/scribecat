import { useEffect, useState } from "react";

import { isWindowsPlatform } from "@/lib/platform";
import { platform } from "@/platform";
import type { AppUpdate } from "@/platform/types";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";

export function useUpdateCheck() {
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);

  useEffect(() => {
    const updater = platform.updater;

    if (!updater || !checkForUpdatesEnabled || !isWindowsPlatform()) {
      return;
    }

    let isActive = true;

    const checkForUpdates = async () => {
      try {
        const update = await updater.check();

        if (isActive && update) {
          setAvailableUpdate(update);
        }
      } catch {
        // Update-Check darf den App-Start nicht blockieren.
      }
    };

    void checkForUpdates();

    return () => {
      isActive = false;
    };
  }, [checkForUpdatesEnabled]);

  const dismissUpdate = () => setAvailableUpdate(null);

  return { availableUpdate, dismissUpdate };
}
