import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AccountSettings } from "@/components/web/AccountSettings";
import { RemoteVaultsSettings } from "@/components/remote/RemoteVaultsSettings";
import { LicensesDialog } from "@/components/LicensesDialog";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { InfoPopover } from "@/components/settings/InfoPopover";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { type SettingsTab } from "@/components/settings/settingsTabs";
import { VaultSettings } from "@/components/settings/VaultSettings";
import { ShortcutsSettings } from "@/components/ShortcutsSettings";
import { VersioningSettings } from "@/components/VersioningSettings";
import { getPortableStatus, type PortableMode } from "@/lib/portable";
import {
  APP_FONTS,
  APP_FONT_IDS,
  ensureFontStylesLoaded,
  FONT_SIZE_PT_MAX,
  FONT_SIZE_PT_MIN,
  FONT_SIZE_PT_STEP,
  getFontScale
} from "@/lib/fonts";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { persistLanguage, type SupportedLanguage } from "@/i18n";
import { useUpdateSettingsStore } from "@/store/useUpdateSettingsStore";
import { isWindowsPlatform } from "@/lib/platform";
import { platform } from "@/platform";
import { useAppVersion } from "@/hooks/useAppVersion";

export type { SettingsTab } from "@/components/settings/settingsTabs";

function FontSetting() {
  const { t } = useTranslation();
  const fontId = useEditorSettingsStore((state) => state.fontId);
  const setFontId = useEditorSettingsStore((state) => state.setFontId);
  const fontSizePt = useEditorSettingsStore((state) => state.fontSizePt);
  const setFontSizePt = useEditorSettingsStore((state) => state.setFontSizePt);

  useEffect(() => {
    APP_FONT_IDS.forEach((id) => void ensureFontStylesLoaded(id));
  }, []);

  return (
    <div className="font-setting">
      <div className="font-setting__head">
        <span className="font-setting__label">{t("settingsDialog.font")}</span>
        <InfoPopover text={t("settingsDialog.fontHint")} />
      </div>
      <p className="font-setting__hint">{t("settingsDialog.fontShort")}</p>

      <div className="font-setting__options" role="radiogroup" aria-label={t("settingsDialog.font")}>
        {APP_FONT_IDS.map((id) => {
          const definition = APP_FONTS[id];
          const label = definition.label ?? t("settingsDialog.fontSystem");
          const isSelected = id === fontId;

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="font-setting__option"
              data-selected={isSelected ? "true" : undefined}
              onClick={() => setFontId(id)}
            >
              <span className="font-setting__name">{label}</span>
              <span
                className="font-setting__preview"
                style={{ fontFamily: definition.cssStack }}
                aria-hidden="true"
              >
                {t("settingsDialog.fontPreviewText")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="font-setting__size">
        <label className="font-setting__size-label" htmlFor="settings-font-size">
          {t("settingsDialog.fontSize")}
          <output htmlFor="settings-font-size" className="font-setting__size-value">
            {t("settingsDialog.fontSizeValue", { size: fontSizePt })}
          </output>
        </label>

        <input
          id="settings-font-size"
          type="range"
          min={FONT_SIZE_PT_MIN}
          max={FONT_SIZE_PT_MAX}
          step={FONT_SIZE_PT_STEP}
          value={fontSizePt}
          onChange={(event) => setFontSizePt(Number.parseFloat(event.target.value))}
        />

        <p
          className="font-setting__size-preview"
          style={{
            fontFamily: APP_FONTS[fontId].cssStack,
            fontSize: `calc(1rem * ${getFontScale(fontSizePt)})`
          }}
        >
          {t("settingsDialog.fontSizePreviewText")}
        </p>
      </div>
    </div>
  );
}

type SettingsDialogProps = {
  open: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
};

export function SettingsDialog({
  open,
  initialTab = "application",
  onClose
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("application");
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [portableMode, setPortableMode] = useState<PortableMode>("off");
  const [portableConfigDir, setPortableConfigDir] = useState("");

  const checkForUpdatesEnabled = useUpdateSettingsStore((state) => state.checkForUpdatesEnabled);
  const setCheckForUpdatesEnabled = useUpdateSettingsStore((state) => state.setCheckForUpdatesEnabled);
  const appVersion = useAppVersion();

  const reopenLastNote = useEditorSettingsStore((state) => state.reopenLastNote);
  const setReopenLastNote = useEditorSettingsStore((state) => state.setReopenLastNote);
  const pasteMarkdown = useEditorSettingsStore((state) => state.pasteMarkdown);
  const setPasteMarkdown = useEditorSettingsStore((state) => state.setPasteMarkdown);
  const restoreWorkingSet = useEditorSettingsStore((state) => state.restoreWorkingSet);
  const setRestoreWorkingSet = useEditorSettingsStore((state) => state.setRestoreWorkingSet);
  const autoAdmitWorkingSet = useEditorSettingsStore((state) => state.autoAdmitWorkingSet);
  const setAutoAdmitWorkingSet = useEditorSettingsStore((state) => state.setAutoAdmitWorkingSet);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab(initialTab);
    let active = true;
    void getPortableStatus().then((status) => {
      if (active) {
        setPortableMode(status.mode);
        setPortableConfigDir(status.configDir);
      }
    });

    return () => {
      active = false;
    };
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (licensesOpen) {
          setLicensesOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, licensesOpen, onClose]);

  if (!open) {
    return null;
  }

  const handleLanguageChange = (language: SupportedLanguage) => {
    persistLanguage(language);
    void i18n.changeLanguage(language);
  };

  return (
    <>
      <div className="ai-dialog" role="presentation" onClick={onClose}>
        <div
          className="ai-dialog__panel settings-dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="settings-title">{t("settingsDialog.title")}</h3>

          <div className="settings-body">
            <SettingsNav activeTab={activeTab} onSelect={setActiveTab} />

            <div className="ai-dialog__scroll">
              {activeTab === "application" ? (
                <SettingsPage tab="application">
                  <div className="ai-dialog__grid">
                    <SettingRow label={t("settingsDialog.language")}>
                      <select
                        value={i18n.resolvedLanguage ?? i18n.language}
                        onChange={(event) => handleLanguageChange(event.target.value as SupportedLanguage)}
                      >
                        <option value="en">{t("settingsDialog.languageEnglish")}</option>
                        <option value="de">{t("settingsDialog.languageGerman")}</option>
                        <option value="fr">{t("settingsDialog.languageFrench")}</option>
                        <option value="es">{t("settingsDialog.languageSpanish")}</option>
                        <option value="zh">{t("settingsDialog.languageChinese")}</option>
                        <option value="ja">{t("settingsDialog.languageJapanese")}</option>
                        <option value="pt">{t("settingsDialog.languagePortuguese")}</option>
                        <option value="ru">{t("settingsDialog.languageRussian")}</option>
                        <option value="it">{t("settingsDialog.languageItalian")}</option>
                        <option value="uk">{t("settingsDialog.languageUkrainian")}</option>
                      </select>
                    </SettingRow>

                    <SettingRow
                      layout="switch"
                      label={t("settingsDialog.reopenLastNote")}
                      hint={t("settingsDialog.reopenLastNoteShort")}
                    >
                      <input
                        type="checkbox"
                        checked={reopenLastNote}
                        onChange={(event) => setReopenLastNote(event.target.checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      layout="switch"
                      label={t("settingsDialog.autoAdmitWorkingSet")}
                      hint={t("settingsDialog.autoAdmitWorkingSetShort")}
                      info={t("settingsDialog.autoAdmitWorkingSetHint")}
                    >
                      <input
                        type="checkbox"
                        checked={autoAdmitWorkingSet}
                        onChange={(event) => setAutoAdmitWorkingSet(event.target.checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      layout="switch"
                      label={t("settingsDialog.restoreWorkingSet")}
                      hint={t("settingsDialog.restoreWorkingSetShort")}
                      info={t("settingsDialog.restoreWorkingSetHint")}
                    >
                      <input
                        type="checkbox"
                        checked={restoreWorkingSet}
                        onChange={(event) => setRestoreWorkingSet(event.target.checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      layout="switch"
                      label={t("settingsDialog.pasteMarkdown")}
                      hint={t("settingsDialog.pasteMarkdownShort")}
                    >
                      <input
                        type="checkbox"
                        checked={pasteMarkdown}
                        onChange={(event) => setPasteMarkdown(event.target.checked)}
                      />
                    </SettingRow>

                    {platform.features.updater && isWindowsPlatform() ? (
                      <SettingRow
                        layout="switch"
                        label={t("settingsDialog.checkForUpdates")}
                        hint={t("settingsDialog.checkForUpdatesShort")}
                        info={t("settingsDialog.checkForUpdatesHint")}
                      >
                        <input
                          type="checkbox"
                          checked={checkForUpdatesEnabled}
                          onChange={(event) => setCheckForUpdatesEnabled(event.target.checked)}
                        />
                      </SettingRow>
                    ) : null}
                  </div>

                  {portableMode === "on" ? (
                    <div className="ai-dialog__notice ai-dialog__notice--info" role="note">
                      <Info className="ai-dialog__notice-icon" aria-hidden="true" />
                      <p>{t("settingsDialog.portableMode", { path: portableConfigDir })}</p>
                    </div>
                  ) : null}

                  {portableMode === "readOnly" ? (
                    <div className="ai-dialog__notice" role="note">
                      <AlertTriangle className="ai-dialog__notice-icon" aria-hidden="true" />
                      <p>{t("settingsDialog.portableReadOnly")}</p>
                    </div>
                  ) : null}

                  <p className="ai-dialog__version">
                    {appVersion ? (
                      <>
                        {t("settingsDialog.version", { version: appVersion })}
                        {" · "}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="ai-dialog__link"
                      onClick={() => setLicensesOpen(true)}
                    >
                      {t("settingsDialog.openSourceLicenses")}
                    </button>
                  </p>
                </SettingsPage>
              ) : activeTab === "appearance" ? (
                <SettingsPage tab="appearance"><AppearanceSettings /></SettingsPage>
              ) : activeTab === "fonts" ? (
                <SettingsPage tab="fonts"><FontSetting /></SettingsPage>
              ) : activeTab === "shortcuts" ? (
                <SettingsPage tab="shortcuts"><ShortcutsSettings /></SettingsPage>
              ) : activeTab === "versioning" ? (
                <SettingsPage tab="versioning"><VersioningSettings /></SettingsPage>
              ) : activeTab === "vault" ? (
                <SettingsPage tab="vault"><VaultSettings /></SettingsPage>
              ) : activeTab === "account" ? (
                <SettingsPage tab="account"><AccountSettings /></SettingsPage>
              ) : (
                <SettingsPage tab="server"><RemoteVaultsSettings /></SettingsPage>
              )}
            </div>
          </div>

          <div className="ai-dialog__actions">
            <Button type="button" onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      </div>

      <LicensesDialog open={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </>
  );
}
