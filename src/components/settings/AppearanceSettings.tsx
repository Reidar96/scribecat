import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingRow } from "@/components/settings/SettingRow";
import { isValidHexColor } from "@/lib/color";
import { OUTLINE_DEPTH_MAX, OUTLINE_DEPTH_MIN } from "@/lib/editor/documentOutline";
import { DEFAULT_ACCENT_COLOR, useAccentColorStore } from "@/store/useAccentColorStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { type Theme, useThemeStore } from "@/store/useThemeStore";

/**
 * Theme, paper surface, accent colour and outline depth. All of them apply
 * through their own stores the moment they change.
 */
export function AppearanceSettings() {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const paperSurface = useEditorSettingsStore((state) => state.paperSurface);
  const setPaperSurface = useEditorSettingsStore((state) => state.setPaperSurface);
  const outlineMaxDepth = useEditorSettingsStore((state) => state.outlineMaxDepth);
  const setOutlineMaxDepth = useEditorSettingsStore((state) => state.setOutlineMaxDepth);
  const accentColor = useAccentColorStore((state) => state.accentColor);
  const setAccentColor = useAccentColorStore((state) => state.setAccentColor);
  const resetAccentColor = useAccentColorStore((state) => state.resetAccentColor);
  const [accentColorInput, setAccentColorInput] = useState(accentColor);

  useEffect(() => {
    setAccentColorInput(accentColor);
  }, [accentColor]);

  return (
    <div className="ai-dialog__grid">
      <SettingRow label={t("settingsDialog.theme")}>
        <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
          <option value="system">{t("settingsDialog.themeSystem")}</option>
          <option value="light">{t("settingsDialog.themeLight")}</option>
          <option value="dark">{t("settingsDialog.themeDark")}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t("settingsDialog.accentColor")}
        hint={t("settingsDialog.accentColorShort")}
        info={t("settingsDialog.accentColorHint")}
      >
        {({ id, describedBy }) => (
          <div className="accent-color-setting">
            <input
              id={id}
              type="color"
              className="accent-color-setting__swatch"
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              aria-describedby={describedBy}
            />
            <input
              type="text"
              className="accent-color-setting__hex"
              value={accentColorInput}
              onChange={(event) => {
                const nextValue = event.target.value;
                setAccentColorInput(nextValue);
                if (isValidHexColor(nextValue)) {
                  setAccentColor(nextValue);
                }
              }}
              onBlur={() => setAccentColorInput(accentColor)}
              spellCheck={false}
              maxLength={7}
              aria-label={t("settingsDialog.accentColorHex")}
            />
            <button
              type="button"
              className="ai-dialog__model-refresh"
              onClick={resetAccentColor}
              disabled={accentColor.toLowerCase() === DEFAULT_ACCENT_COLOR}
              aria-label={t("settingsDialog.accentColorReset")}
              title={t("settingsDialog.accentColorReset")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        layout="switch"
        label={t("settingsDialog.paperSurface")}
        hint={t("settingsDialog.paperSurfaceShort")}
        info={t("settingsDialog.paperSurfaceHint")}
      >
        <input type="checkbox" checked={paperSurface} onChange={(event) => setPaperSurface(event.target.checked)} />
      </SettingRow>

      <SettingRow label={t("settingsDialog.outlineDepth")} hint={t("settingsDialog.outlineDepthShort")}>
        <select value={outlineMaxDepth} onChange={(event) => setOutlineMaxDepth(Number.parseInt(event.target.value, 10))}>
          {Array.from({ length: OUTLINE_DEPTH_MAX - OUTLINE_DEPTH_MIN + 1 }, (_, offset) => OUTLINE_DEPTH_MIN + offset).map(
            (level) => (
              <option key={level} value={level}>
                {level === OUTLINE_DEPTH_MAX
                  ? t("settingsDialog.outlineDepthAll")
                  : level === OUTLINE_DEPTH_MIN
                    ? t("settingsDialog.outlineDepthTop")
                    : t("settingsDialog.outlineDepthUpTo", { level })}
              </option>
            )
          )}
        </select>
      </SettingRow>
    </div>
  );
}
