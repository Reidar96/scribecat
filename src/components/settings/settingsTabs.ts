import { platform } from "@/platform";
import type { PlatformFeatures } from "@/platform/types";

export type SettingsTab =
  | "application"
  | "appearance"
  | "fonts"
  | "shortcuts"
  | "versioning"
  | "vault"
  | "account"
  | "server";

export type SettingsGroup = "application" | "folder";

export const SETTINGS_NAV: { group: SettingsGroup; tabs: SettingsTab[] }[] = [
  { group: "application", tabs: ["application", "appearance", "fonts", "shortcuts", "account", "server"] },
  { group: "folder", tabs: ["versioning", "vault"] }
];

const SETTINGS_TAB_FEATURE: Partial<Record<SettingsTab, keyof PlatformFeatures>> = {
  account: "session",
  server: "remoteVaults"
};

export function isSettingsTabAvailable(tab: SettingsTab): boolean {
  const feature = SETTINGS_TAB_FEATURE[tab];
  return feature === undefined || platform.features[feature];
}

export const SETTINGS_NAV_VISIBLE: { group: SettingsGroup; tabs: SettingsTab[] }[] = SETTINGS_NAV.map(
  ({ group, tabs }) => ({ group, tabs: tabs.filter(isSettingsTabAvailable) })
).filter(({ tabs }) => tabs.length > 0);

export const SETTINGS_TAB_ORDER: SettingsTab[] = SETTINGS_NAV_VISIBLE.flatMap((group) => group.tabs);

export const SELF_SAVING_TABS: SettingsTab[] = [
  "fonts",
  "shortcuts",
  "versioning",
  "vault",
  "account",
  "server"
];

export const SETTINGS_TAB_LABEL_KEY: Record<SettingsTab, string> = {
  application: "settingsDialog.tabApplication",
  appearance: "settingsDialog.tabAppearance",
  fonts: "settingsDialog.tabFonts",
  shortcuts: "settingsDialog.tabShortcuts",
  versioning: "settingsDialog.tabVersioning",
  vault: "settingsDialog.tabVault",
  account: "settingsDialog.tabAccount",
  server: "settingsDialog.tabServer"
};

export const SETTINGS_GROUP_LABEL_KEY: Record<SettingsGroup, string> = {
  application: "settingsDialog.groupApplication",
  folder: "settingsDialog.groupFolder"
};
