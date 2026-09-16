import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  SETTINGS_GROUP_LABEL_KEY,
  SETTINGS_NAV,
  SETTINGS_TAB_LABEL_KEY,
  SETTINGS_TAB_ORDER,
  type SettingsTab
} from "@/components/settings/settingsTabs";
import { getFolderBasename } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

type SettingsNavProps = {
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
};

export function settingsTabId(tab: SettingsTab): string {
  return `settings-tab-${tab}`;
}

export function settingsPanelId(tab: SettingsTab): string {
  return `settings-panel-${tab}`;
}

/**
 * The navigation column: nine entries in three groups. A vertical tablist,
 * so the arrow keys move between the entries and Tab leaves the column for
 * the content — the entry that is active is the only one in the tab order.
 */
export function SettingsNav({ activeTab, onSelect }: SettingsNavProps) {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const buttonRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());

  const moveTo = (tab: SettingsTab) => {
    onSelect(tab);
    buttonRefs.current.get(tab)?.focus();
  };

  // Both axes, since the column becomes a strip in a narrow window.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = SETTINGS_TAB_ORDER.indexOf(activeTab);
    const last = SETTINGS_TAB_ORDER.length - 1;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        moveTo(SETTINGS_TAB_ORDER[index >= last ? 0 : index + 1]);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        moveTo(SETTINGS_TAB_ORDER[index <= 0 ? last : index - 1]);
        break;
      case "Home":
        moveTo(SETTINGS_TAB_ORDER[0]);
        break;
      case "End":
        moveTo(SETTINGS_TAB_ORDER[last]);
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  return (
    <div
      className="settings-nav"
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("settingsDialog.tabsAriaLabel")}
      onKeyDown={handleKeyDown}
    >
      {SETTINGS_NAV.map(({ group, tabs }) => (
        <div key={group} className="settings-nav__group" role="presentation">
          <span className="settings-nav__group-title" aria-hidden="true">
            {t(SETTINGS_GROUP_LABEL_KEY[group])}
          </span>
          {tabs.map((tab) => {
            const isActive = tab === activeTab;
            // The folder entry names the folder it stands for: "open folder"
            // alone leaves the question which one that is.
            const subtitle =
              tab === "vault"
                ? folderPath === null
                  ? t("settingsDialog.vaultNavNoFolder")
                  : getFolderBasename(folderPath)
                : null;

            return (
              <button
                key={tab}
                ref={(element) => {
                  if (element) {
                    buttonRefs.current.set(tab, element);
                  } else {
                    buttonRefs.current.delete(tab);
                  }
                }}
                type="button"
                role="tab"
                id={settingsTabId(tab)}
                aria-selected={isActive}
                aria-controls={settingsPanelId(tab)}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? "settings-nav__item settings-nav__item--active" : "settings-nav__item"}
                onClick={() => onSelect(tab)}
              >
                <span className="settings-nav__item-label">{t(SETTINGS_TAB_LABEL_KEY[tab])}</span>
                {subtitle ? (
                  <span className="settings-nav__item-sub" title={subtitle}>
                    {subtitle}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
