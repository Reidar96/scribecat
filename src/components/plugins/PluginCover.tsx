import { useEffect, useState } from "react";

import { createPluginApi } from "@/plugins/api";
import type { PluginId } from "@/plugins/registry";
import { dirname, join } from "@/platform/paths";

export function PluginCover({ id, vaultPath, documentPath, reference, alt }: {
  id: PluginId; vaultPath: string; documentPath: string; reference: string; alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!/^\.?(?:\/|[^:/\\])/.test(reference) || !/\.(?:png|jpe?g|webp|gif)$/i.test(reference)) return;
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const path = await join(await dirname(documentPath), reference.replace(/^\.\//, ""));
        const bytes = await createPluginApi(id, vaultPath, () => undefined).readAttachment(path);
        const type = /\.png$/i.test(reference) ? "image/png" : /\.webp$/i.test(reference) ? "image/webp" : /\.gif$/i.test(reference) ? "image/gif" : "image/jpeg";
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch { if (active) setUrl(null); }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, vaultPath, documentPath, reference]);
  return url ? <img className="content-plugin-panel__cover" src={url} alt={alt} /> : null;
}
