import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { settingsPanelId, settingsTabId } from "@/components/settings/SettingsNav";
import { SETTINGS_TAB_LABEL_KEY, type SettingsTab } from "@/components/settings/settingsTabs";

/**
 * One entry's panel: the heading that says which entry is open, then its
 * settings. The heading repeats the navigation label on purpose — the
 * column is what the user clicked, the heading is what they are looking at
 * — and it is the reference point every section heading below it (an h5)
 * sits under.
 */
export function SettingsPage({ tab, children }: { tab: SettingsTab; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section id={settingsPanelId(tab)} role="tabpanel" aria-labelledby={settingsTabId(tab)} className="settings-page">
      <h4 className="settings-page__title">{t(SETTINGS_TAB_LABEL_KEY[tab])}</h4>
      {children}
    </section>
  );
}
