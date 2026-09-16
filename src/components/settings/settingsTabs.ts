export type SettingsTab =
  | "application"
  | "appearance"
  | "fonts"
  | "shortcuts"
  | "ai"
  | "assistants"
  | "rag"
  | "versioning"
  | "vault";

export type SettingsGroup = "application" | "ai" | "folder";

/**
 * The navigation column, in this order. "application" comes first so the
 * language stays where people look for it; the folder group is last because
 * its entries change meaning with the open folder.
 */
export const SETTINGS_NAV: { group: SettingsGroup; tabs: SettingsTab[] }[] = [
  { group: "application", tabs: ["application", "appearance", "fonts", "shortcuts"] },
  { group: "ai", tabs: ["ai", "assistants", "rag"] },
  { group: "folder", tabs: ["versioning", "vault"] }
];

export const SETTINGS_TAB_ORDER: SettingsTab[] = SETTINGS_NAV.flatMap((group) => group.tabs);

/**
 * Tabs whose settings apply through their own store the moment they change.
 * The Save button belongs to the AI settings draft; on these tabs it would
 * only mislead — on the knowledge base tab it would even look like the button
 * that applies its connection.
 */
export const SELF_SAVING_TABS: SettingsTab[] = ["fonts", "shortcuts", "assistants", "rag", "versioning", "vault"];

export const SETTINGS_TAB_LABEL_KEY: Record<SettingsTab, string> = {
  application: "settingsDialog.tabApplication",
  appearance: "settingsDialog.tabAppearance",
  fonts: "settingsDialog.tabFonts",
  shortcuts: "settingsDialog.tabShortcuts",
  ai: "settingsDialog.tabAi",
  assistants: "settingsDialog.tabAssistants",
  rag: "settingsDialog.tabRag",
  versioning: "settingsDialog.tabVersioning",
  vault: "settingsDialog.tabVault"
};

export const SETTINGS_GROUP_LABEL_KEY: Record<SettingsGroup, string> = {
  application: "settingsDialog.groupApplication",
  ai: "settingsDialog.groupAi",
  folder: "settingsDialog.groupFolder"
};
