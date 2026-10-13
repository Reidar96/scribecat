import { create } from "zustand";

import { readJournalSettings, readPluginConfiguration, readTaskSettings, writePluginConfiguration } from "@/lib/vaultMeta";
import {
  normalizePluginConfiguration,
  pluginById,
  type PluginConfiguration,
  type PluginId,
  type PluginPreferences
} from "@/plugins/registry";

type PluginState = {
  vaultPath: string | null;
  ready: boolean;
  config: PluginConfiguration;
  error: string | null;
  load: (vaultPath: string | null) => Promise<void>;
  update: (id: PluginId, patch: Partial<PluginPreferences>) => void;
  pin: (id: PluginId, pinned: boolean) => void;
  reorder: (from: PluginId, to: PluginId) => void;
};

let generation = 0;
let pendingWrite: Promise<void> = Promise.resolve();

export const usePluginStore = create<PluginState>((set, get) => ({
  vaultPath: null,
  ready: false,
  config: normalizePluginConfiguration(null),
  error: null,
  load: async (vaultPath) => {
    const current = ++generation;
    set({ vaultPath, ready: !vaultPath, config: normalizePluginConfiguration(null), error: null });
    if (!vaultPath) return;
    const [config, journal, tasks] = await Promise.all([
      readPluginConfiguration(vaultPath), readJournalSettings(vaultPath), readTaskSettings(vaultPath)
    ]);
    config.plugins.journal = { ...config.plugins.journal!, folder: journal.folder, showInFiles: !journal.hideFromSidebar };
    config.plugins.tasks = { ...config.plugins.tasks!, folder: tasks.folder, showInFiles: !tasks.hideFromSidebar };
    if (current === generation) set({ config, ready: true });
  },
  update: (id, patch) => {
    const manifest = pluginById(id);
    if (!manifest || !get().ready) return;
    const current = get().config;
    const previous = current.plugins[id]!;
    const config = normalizePluginConfiguration({
      ...current,
      plugins: { ...current.plugins, [id]: { ...previous, ...patch } },
      pinned: patch.enabled === false ? current.pinned.filter((item) => item !== id) : current.pinned
    });
    set({ config, error: null });
    persist(get, set, config);
  },
  pin: (id, pinned) => {
    if (!get().ready || !get().config.plugins[id]?.enabled) return;
    const current = get().config;
    const config = normalizePluginConfiguration({ ...current, pinned: pinned
      ? [...current.pinned.filter((item) => item !== id), id].slice(-3)
      : current.pinned.filter((item) => item !== id) });
    set({ config, error: null });
    persist(get, set, config);
  },
  reorder: (from, to) => {
    if (!get().ready || from === to) return;
    const order = [...get().config.order];
    const fromIndex = order.indexOf(from), toIndex = order.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    order.splice(fromIndex, 1);
    order.splice(toIndex, 0, from);
    const config = normalizePluginConfiguration({ ...get().config, order });
    set({ config, error: null });
    persist(get, set, config);
  }
}));

function persist(
  get: () => PluginState,
  set: (partial: Partial<PluginState>) => void,
  config: PluginConfiguration
): void {
  const vaultPath = get().vaultPath;
  const current = generation;
  if (!vaultPath) return;
  pendingWrite = pendingWrite.catch(() => undefined).then(() => writePluginConfiguration(vaultPath, config));
  void pendingWrite.catch(() => {
    if (current === generation) set({ error: "Plugin settings could not be saved." });
  });
}
