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
    <div className="plugin-settings__groups">
      <section><h4>App</h4>
      {checkbox("Aktivert", preference.enabled, (enabled) => update(selected, { enabled }))}
      {checkbox("Fest i sidemenyen", isPinned, (value) => pin(selected, value))}</section>
      {plugin.defaultFolder && selected !== "journal" && selected !== "tasks" ? <section><h4>Innhold</h4>
        <SettingRow label="Mappe" hint="Relativ sti i den åpne mappen.">
          <input type="text" disabled={!ready} value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)}
            onBlur={() => { const folder = validPluginFolder(folderDraft); if (folder) update(selected, { folder }); else setFolderDraft(preference.folder ?? ""); }} />
        </SettingRow>
        {checkbox("Vis i filoversikten", preference.showInFiles, (showInFiles) => update(selected, { showInFiles }))}</section> : null}
      {plugin.defaultFolder ? <section><h4>Synlighet</h4>
      {plugin.defaultFolder ? checkbox("Ta med i søk", preference.includeInSearch, (includeInSearch) => update(selected, { includeInSearch })) : null}
      {plugin.defaultFolder ? checkbox("Ta med i graf", preference.includeInGraph, (includeInGraph) => update(selected, { includeInGraph })) : null}
      {plugin.defaultFolder ? checkbox("Vis i flytt-dialogen", preference.includeInMove, (includeInMove) => update(selected, { includeInMove })) : null}</section> : null}
      {plugin.capabilities.includes("publicView") ? <section><h4>Deling</h4>
        {checkbox("Offentlig visning", preference.publicView, (publicView) => update(selected, { publicView }))}
        <p>{selected === "recipes" ? "Kun oppskrifter merket som publisert vises på /oppskrifter." : selected === "books" ? "Kun bøker merket som publisert vises på /boker. Private notater vises ikke." : selected === "inventory" ? "Kun inventargjenstander merket som publisert vises på /inventar. Private felt som pris og serienummer vises aldri." : "En offentlig handleliste kan endres av alle som kjenner adressen. Del bare når det er ønskelig."}</p>
      </section> : null}
    </div>
    {selected === "journal" || selected === "tasks" ? <VaultSettings pluginId={selected} /> : null}
  </div>;
}
