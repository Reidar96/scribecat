/** Bundled plugin API v1. Content always remains ordinary Markdown in the vault. */
export type PluginCapability =
  | "navigation" | "settings" | "folderPolicy" | "vaultRead"
  | "markdownWrite" | "attachments" | "search" | "publicView";

export type PluginId = "journal" | "tasks" | "graph" | "quick-notes" | "books" | "shopping" | "recipes" | "inventory";

export type PluginManifest = Readonly<{
  id: PluginId;
  name: string;
  nameEn: string;
  version: string;
  icon: string;
  kind: "content" | "view";
  defaultFolder?: string;
  capabilities: readonly PluginCapability[];
  defaultEnabled: boolean;
}>;

export const BUILTIN_PLUGINS: readonly PluginManifest[] = [
  { id: "journal", name: "Dagbok", nameEn: "Journal", version: "1.0.0", icon: "calendar-days", kind: "content", defaultFolder: "Dagbok", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "search"], defaultEnabled: true },
  { id: "tasks", name: "Gjøremål", nameEn: "Tasks", version: "1.0.0", icon: "square-check", kind: "content", defaultFolder: "Gjøremål", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "search"], defaultEnabled: true },
  { id: "graph", name: "Graf", nameEn: "Graph", version: "1.0.0", icon: "network", kind: "view", capabilities: ["navigation", "settings", "vaultRead"], defaultEnabled: true },
  { id: "quick-notes", name: "Quick Notes", nameEn: "Quick Notes", version: "1.0.0", icon: "sticky-note", kind: "content", defaultFolder: "Quick Notes", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "search"], defaultEnabled: true },
  { id: "books", name: "Bøker", nameEn: "Books", version: "1.0.0", icon: "book-open", kind: "content", defaultFolder: "Bøker", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "attachments", "search"], defaultEnabled: true },
  { id: "shopping", name: "Handleliste", nameEn: "Shopping", version: "1.0.0", icon: "shopping-basket", kind: "content", defaultFolder: "Handlelister", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "search", "publicView"], defaultEnabled: true },
  { id: "recipes", name: "Oppskrifter", nameEn: "Recipes", version: "1.0.0", icon: "chef-hat", kind: "content", defaultFolder: "Oppskrifter", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "attachments", "search", "publicView"], defaultEnabled: true },
  { id: "inventory", name: "Inventar", nameEn: "Inventory", version: "1.0.0", icon: "boxes", kind: "content", defaultFolder: "Inventar", capabilities: ["navigation", "settings", "folderPolicy", "vaultRead", "markdownWrite", "attachments", "search"], defaultEnabled: true }
] as const;

export const pluginById = (id: string): PluginManifest | undefined => BUILTIN_PLUGINS.find((plugin) => plugin.id === id);

export type PluginPreferences = {
  enabled: boolean;
  folder?: string;
  showInFiles: boolean;
  includeInSearch: boolean;
  includeInGraph: boolean;
  includeInMove: boolean;
  publicView: boolean;
};

export type PluginConfiguration = {
  version: 1;
  plugins: Partial<Record<PluginId, PluginPreferences>>;
  pinned: PluginId[];
  order: PluginId[];
};

export function defaultPluginPreferences(plugin: PluginManifest): PluginPreferences {
  return {
    enabled: plugin.defaultEnabled,
    folder: plugin.defaultFolder,
    showInFiles: true,
    includeInSearch: true,
    includeInGraph: plugin.id !== "journal" && plugin.id !== "tasks",
    includeInMove: true,
    publicView: false
  };
}

export function validPluginFolder(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.startsWith("/") || raw.includes("\\")) return null;
  const folder = raw.trim().replace(/\/+$/, "");
  if (folder.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment === ".scribecat" || /[\x00-\x1f:*?"<>|]/.test(segment))) return null;
  return folder;
}

export function normalizePluginConfiguration(raw: unknown): PluginConfiguration {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const values = input.plugins && typeof input.plugins === "object" ? input.plugins as Record<string, unknown> : {};
  const plugins: PluginConfiguration["plugins"] = {};
  for (const manifest of BUILTIN_PLUGINS) {
    const value = values[manifest.id] && typeof values[manifest.id] === "object" ? values[manifest.id] as Record<string, unknown> : {};
    const defaults = defaultPluginPreferences(manifest);
    plugins[manifest.id] = {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      folder: validPluginFolder(value.folder) ?? defaults.folder,
      showInFiles: typeof value.showInFiles === "boolean" ? value.showInFiles : true,
      includeInSearch: typeof value.includeInSearch === "boolean" ? value.includeInSearch : true,
      includeInGraph: typeof value.includeInGraph === "boolean" ? value.includeInGraph : defaults.includeInGraph,
      includeInMove: typeof value.includeInMove === "boolean" ? value.includeInMove : true,
      publicView: manifest.capabilities.includes("publicView") && value.publicView === true
    };
  }
  const pinned = Array.isArray(input.pinned) ? input.pinned.filter((id): id is PluginId => typeof id === "string" && !!pluginById(id)) : ["journal", "graph", "tasks"] as PluginId[];
  const requestedOrder = Array.isArray(input.order) ? input.order.filter((id): id is PluginId => typeof id === "string" && !!pluginById(id)) : [];
  const order = [...new Set([...requestedOrder, ...BUILTIN_PLUGINS.map((item) => item.id)])];
  return { version: 1, plugins, pinned: [...new Set(pinned)].filter((id) => plugins[id]?.enabled).slice(0, 3), order };
}

/** Central policy lookup. An owning folder never disappears from the vault itself. */
export function pluginPolicyForPath(config: PluginConfiguration, relativePath: string): PluginPreferences | null {
  const path = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  let owner: PluginPreferences | null = null;
  let longest = -1;
  for (const manifest of BUILTIN_PLUGINS) {
    const preference = config.plugins[manifest.id];
    const folder = preference?.folder?.replace(/^\/+|\/+$/g, "");
    if (!preference?.enabled || !folder) continue;
    if ((path === folder || path.startsWith(`${folder}/`)) && folder.length > longest) {
      owner = preference;
      longest = folder.length;
    }
  }
  return owner;
}
