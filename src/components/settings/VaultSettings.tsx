import { useMemo } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingRow } from "@/components/settings/SettingRow";
import { VaultScopeHeader } from "@/components/settings/VaultScopeHeader";
import { countFolderNotes } from "@/lib/folderNotes";
import { HEADING_NUMBERING_DEPTH_MAX } from "@/lib/editor/headingNumbers";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

/**
 * Settings stored in the open folder's `.scribecat` rather than with the
 * app: heading numbering and folder notes. Both apply the moment they change
 * (no Save button); without an open folder the controls stay visible but
 * disabled, and the line above them says why.
 */
export function VaultSettings() {
  const { t } = useTranslation();
  const headingNumbering = useEditorSettingsStore((state) => state.headingNumbering);
  const setHeadingNumbering = useEditorSettingsStore((state) => state.setHeadingNumbering);
  const headingNumberingVaultPath = useEditorSettingsStore((state) => state.headingNumberingVaultPath);
  const folderNotesEnabled = useEditorSettingsStore((state) => state.folderNotesEnabled);
  const setFolderNotesEnabled = useEditorSettingsStore((state) => state.setFolderNotesEnabled);
  const journalSettings = useEditorSettingsStore((state) => state.journalSettings);
  const setJournalSettings = useEditorSettingsStore((state) => state.setJournalSettings);
  const folderPath = useAppStore((state) => state.folderPath);
  const filePaths = useAppStore((state) => state.filePaths);
  const emptyFolderPaths = useAppStore((state) => state.emptyFolderPaths);
  // Folder notes written while the feature was on stay on disk after it is
  // switched off; the counter is what tells the user they are still there.
  const hiddenFolderNoteCount = useAppStore((state) => countFolderNotes(state.filePaths));

  // The store loads the folder's values after the folder opens; until then
  // (and without a folder) a change would have nowhere to go.
  const disabled = headingNumberingVaultPath === null;

  const journalFolderOptions = useMemo(() => {
    const options = new Set<string>(["Dagbok", journalSettings.folder]);

    if (!folderPath) {
      return [...options].filter(Boolean);
    }

    const addPrefixes = (relativePath: string, includesLeaf: boolean) => {
      const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
      const limit = includesLeaf ? segments.length : Math.max(0, segments.length - 1);
      for (let length = 1; length <= limit; length += 1) {
        options.add(segments.slice(0, length).join("/"));
      }
    };

    filePaths.forEach((filePath) =>
      addPrefixes(getRelativeDisplayPath(folderPath, filePath), false)
    );
    emptyFolderPaths.forEach((entryPath) =>
      addPrefixes(getRelativeDisplayPath(folderPath, entryPath), true)
    );

    return [...options]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [emptyFolderPaths, filePaths, folderPath, journalSettings.folder]);

  return (
    <>
      <VaultScopeHeader variant="intro" />

      <div className="ai-dialog__grid">
        <SettingRow
          layout="switch"
          label={t("settingsDialog.headingNumbering")}
          hint={t("settingsDialog.headingNumberingShort")}
          info={t("settingsDialog.headingNumberingHint")}
        >
          <input
            type="checkbox"
            checked={headingNumbering.enabled}
            disabled={disabled}
            onChange={(event) => setHeadingNumbering({ enabled: event.target.checked })}
          />
        </SettingRow>

        {headingNumbering.enabled ? (
          <>
            <SettingRow
              label={t("settingsDialog.headingNumberingStart")}
              hint={t("settingsDialog.headingNumberingStartShort")}
            >
              <select
                value={headingNumbering.startLevel}
                disabled={disabled}
                onChange={(event) => setHeadingNumbering({ startLevel: event.target.value === "1" ? 1 : 2 })}
              >
                <option value={1}>{t("settingsDialog.headingNumberingStartLevel", { level: 1 })}</option>
                <option value={2}>{t("settingsDialog.headingNumberingStartLevel", { level: 2 })}</option>
              </select>
            </SettingRow>

            <SettingRow label={t("settingsDialog.headingNumberingDepth")}>
              <select
                value={headingNumbering.maxDepth}
                disabled={disabled}
                onChange={(event) => setHeadingNumbering({ maxDepth: Number.parseInt(event.target.value, 10) })}
              >
                {Array.from(
                  { length: HEADING_NUMBERING_DEPTH_MAX - headingNumbering.startLevel + 1 },
                  (_, offset) => headingNumbering.startLevel + offset
                ).map((level) => (
                  <option key={level} value={level}>
                    {level === HEADING_NUMBERING_DEPTH_MAX
                      ? t("settingsDialog.outlineDepthAll")
                      : t("settingsDialog.outlineDepthUpTo", { level })}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label={t("settingsDialog.headingNumberingScope")}
              hint={t("settingsDialog.headingNumberingScopeShort")}
            >
              <select
                value={headingNumbering.scope}
                disabled={disabled}
                onChange={(event) =>
                  setHeadingNumbering({ scope: event.target.value === "outline" ? "outline" : "everywhere" })
                }
              >
                <option value="everywhere">{t("settingsDialog.headingNumberingScopeEverywhere")}</option>
                <option value="outline">{t("settingsDialog.headingNumberingScopeOutline")}</option>
              </select>
            </SettingRow>

            <SettingRow
              label={t("settingsDialog.headingNumberingMarker")}
              hint={t("settingsDialog.headingNumberingMarkerShort")}
              info={t("settingsDialog.headingNumberingMarkerHint")}
            >
              <select
                value={headingNumbering.marker}
                disabled={disabled}
                onChange={(event) =>
                  setHeadingNumbering({ marker: event.target.value === "always" ? "always" : "activeLine" })
                }
              >
                <option value="activeLine">{t("settingsDialog.headingNumberingMarkerActiveLine")}</option>
                <option value="always">{t("settingsDialog.headingNumberingMarkerAlways")}</option>
              </select>
            </SettingRow>
          </>
        ) : null}

        <SettingRow label={t("settingsDialog.journalFolder")}>
          <>
            <input
              type="text"
              list="journal-folder-options"
              value={journalSettings.folder}
              disabled={disabled}
              onChange={(event) => setJournalSettings({ folder: event.target.value })}
            />
            <datalist id="journal-folder-options">
              {journalFolderOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </>
        </SettingRow>

        <SettingRow label={t("settingsDialog.journalStructure")}>
          <select
            value={journalSettings.structure}
            disabled={disabled}
            onChange={(event) =>
              setJournalSettings({
                structure:
                  event.target.value === "iso" || event.target.value === "year"
                    ? event.target.value
                    : "norwegian"
              })
            }
          >
            <option value="norwegian">
              {t("settingsDialog.journalStructureNorwegian")}
            </option>
            <option value="iso">{t("settingsDialog.journalStructureIso")}</option>
            <option value="year">{t("settingsDialog.journalStructureYear")}</option>
          </select>
        </SettingRow>

        <SettingRow
          layout="switch"
          label={t("settingsDialog.journalHide")}
        >
          <input
            type="checkbox"
            checked={journalSettings.hideFromSidebar}
            disabled={disabled}
            onChange={(event) =>
              setJournalSettings({ hideFromSidebar: event.target.checked })
            }
          />
        </SettingRow>

        <SettingRow
          layout="switch"
          label={t("settingsDialog.folderNotes")}
          hint={t("settingsDialog.folderNotesShort")}
          info={t("settingsDialog.folderNotesHint")}
        >
          <input
            type="checkbox"
            checked={folderNotesEnabled}
            disabled={disabled}
            onChange={(event) => setFolderNotesEnabled(event.target.checked)}
          />
        </SettingRow>

        {!folderNotesEnabled && hiddenFolderNoteCount > 0 ? (
          <div className="ai-dialog__field--full ai-dialog__notice ai-dialog__notice--info" role="note">
            <Info className="ai-dialog__notice-icon" aria-hidden="true" />
            <p>
              {t("settingsDialog.folderNotesHidden", { count: hiddenFolderNoteCount })}{" "}
              <button type="button" className="ai-dialog__link" onClick={() => setFolderNotesEnabled(true)}>
                {t("settingsDialog.folderNotesEnableNow")}
              </button>
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
