import { useEffect, useState } from "react";

import { SettingRow } from "@/components/settings/SettingRow";
import { VaultSettings } from "@/components/settings/VaultSettings";
import { BUILTIN_PLUGINS, validPluginFolder, type PluginId } from "@/plugins/registry";
import { usePluginStore } from "@/store/usePluginStore";

export function PluginSettings() {
  const [selected, setSelected] = useState<PluginId>("journal");
  const { config, ready, error, update, pin } = usePluginStore();
  const plugin = BUILTIN_PLUGINS.find((item) => item.id === selected)!;
  const preference = config.plugins[selected]!;
  const [folderDraft, setFolderDraft] = useState(preference.folder ?? "");
  useEffect(() => setFolderDraft(preference.folder ?? ""), [selected, preference.folder]);
  const isPinned = config.pinned.includes(selected);
  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => void) =>
    <SettingRow key={label} layout="switch" label={label}>
      <input type="checkbox" disabled={!ready} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </SettingRow>;

  return <div className="plugin-settings">
    <p>Installerte apper. Innholdet lagres som vanlige Markdown-filer i denne mappen.</p>
    <div className="plugin-settings__list" aria-label="Plugins">
      {BUILTIN_PLUGINS.map((item) => <button type="button" key={item.id}
        className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}>{item.name}</button>)}
    </div>
    <h3>{plugin.name}</h3>
    {error ? <p role="alert">{error}</p> : null}
    <div className="ai-dialog__grid">
      {checkbox("Aktivert", preference.enabled, (enabled) => update(selected, { enabled }))}
      {checkbox("Fest som app", isPinned, (value) => pin(selected, value))}
      {plugin.defaultFolder && selected !== "journal" && selected !== "tasks" ?
        <SettingRow label="Mappe" hint="Relativ sti i den åpne mappen.">
          <input type="text" disabled={!ready} value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)}
            onBlur={() => { const folder = validPluginFolder(folderDraft); if (folder) update(selected, { folder }); else setFolderDraft(preference.folder ?? ""); }} />
        </SettingRow> : null}
      {plugin.defaultFolder && selected !== "journal" && selected !== "tasks" ?
        checkbox("Vis i filoversikten", preference.showInFiles, (showInFiles) => update(selected, { showInFiles })) : null}
      {plugin.defaultFolder ? checkbox("Ta med i søk", preference.includeInSearch, (includeInSearch) => update(selected, { includeInSearch })) : null}
      {plugin.defaultFolder ? checkbox("Ta med i graf", preference.includeInGraph, (includeInGraph) => update(selected, { includeInGraph })) : null}
      {plugin.defaultFolder ? checkbox("Vis i flytt-dialogen", preference.includeInMove, (includeInMove) => update(selected, { includeInMove })) : null}
      {selected === "recipes" ? checkbox("Offentlig visning", preference.publicView, (publicView) => update(selected, { publicView })) : null}
    </div>
    {selected === "journal" || selected === "tasks" ? <VaultSettings pluginId={selected} /> : null}
    {selected === "recipes" && preference.publicView ? <p>Kun oppskrifter med <code>published: true</code> kan vises offentlig. Kontroller alltid innholdet før publisering.</p> : null}
  </div>;
}
