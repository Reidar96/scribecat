import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getFolderBasename } from "@/lib/fileSystem";
import { useAppStore } from "@/store/useAppStore";

/**
 * The line above every group of settings that lives in the open folder's
 * `.scribedog` rather than with the app — the knowledge base and the
 * folder's own page. Same wording in both places: a switch that "resets"
 * when another folder is opened has to read as belonging to the folder,
 * not as a bug. Without an open folder it says what to do instead.
 *
 * Two shapes: the box with its own title, for a page that is about
 * something else (the knowledge base) and only *stores* in the folder; and
 * the bare hint line, for the folder's own page, whose heading already says
 * "open folder" — the box would say it a second time right underneath.
 */
export function VaultScopeHeader({ variant = "box" }: { variant?: "box" | "intro" }) {
  const { t } = useTranslation();
  const folderPath = useAppStore((state) => state.folderPath);
  const name = folderPath === null ? null : getFolderBasename(folderPath);
  const hint =
    name === null ? t("settingsDialog.vaultScopeNoFolderHint") : t("settingsDialog.vaultScopeHint", { name });

  if (variant === "intro") {
    return <p className="settings-intro">{hint}</p>;
  }

  return (
    <header className="settings-scope">
      <h5 className="settings-scope__title">
        <FolderOpen aria-hidden="true" />
        {name === null ? t("settingsDialog.vaultScopeNoFolder") : t("settingsDialog.vaultScopeTitle", { name })}
      </h5>
      <p className="settings-scope__hint">{hint}</p>
    </header>
  );
}
