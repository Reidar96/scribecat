import { useEffect, useState } from "react";

import { platform } from "@/platform";

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    platform.app
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return version;
}
