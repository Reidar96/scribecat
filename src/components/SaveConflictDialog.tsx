import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";
import { readMarkdownFile } from "@/lib/fileSystem";
import { buildDiffHunks, diffLines } from "@/lib/textDiff";

type SaveConflictDialogProps = {
  open: boolean;
  fileLabel: string | null;
  filePath: string | null;
  diskMtimeMs?: number | null;
  localContent: string;
  isSaving: boolean;
  onOverwrite: () => void;
  onKeepDisk: () => void;
  onCancel: () => void;
};

/**
 * A save found the file changed on disk since it was read (someone edited it
 * outside the app, a sync client brought another device's version). Two
 * answers, no merge view: overwriting snapshots the disk version first, so
 * with versioning on nothing is lost and the existing version comparison is
 * where the two can be looked at side by side. With versioning off the
 * dialog says so, since then the other version really does go.
 */
export function SaveConflictDialog({ open, fileLabel, filePath, diskMtimeMs, localContent, isSaving, onOverwrite, onKeepDisk, onCancel }: SaveConflictDialogProps) {
  const { t } = useTranslation();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const cancelButtonRef = useRef<HTMLElement>(null);
  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!open || !filePath) return;
    let active = true;
    setDiskContent(null);
    setLoadError(false);
    void readMarkdownFile(filePath).then((content) => { if (active) setDiskContent(content); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [open, filePath, diskMtimeMs]);
  const hunks = useMemo(() => diskContent === null ? [] : buildDiffHunks(diffLines(diskContent, localContent)), [diskContent, localContent]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSaving, onCancel]);

  // Cancel is the safe default here: Enter must not overwrite someone's work.
  useEffect(() => {
    if (open) {
      cancelButtonRef.current?.focus({ focusVisible: true } as FocusOptions);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      onClick={() => {
        if (!isSaving) {
          onCancel();
        }
      }}
    >
      <div
        className="unsaved-dialog__panel ai-dialog__panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        aria-describedby="save-conflict-description"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("saveConflictDialog.eyebrow")}</p>
        <h3 id="save-conflict-title">{t("saveConflictDialog.title")}</h3>
        <p id="save-conflict-description" className="unsaved-dialog__description">
          {fileLabel
            ? t("saveConflictDialog.descriptionWithName", { fileLabel })
            : t("saveConflictDialog.descriptionGeneric")}{" "}
          {versioningEnabled
            ? t("saveConflictDialog.versioningOn")
            : t("saveConflictDialog.versioningOff")}
        </p>

        <div className="version-diff__legend"><span>{t("saveConflictDialog.serverVersion")}</span><span>{t("saveConflictDialog.localVersion")}</span></div>
        <div className="version-diff__body" aria-label={t("saveConflictDialog.differences")}>
          {loadError ? <p className="version-diff__message version-diff__message--error">{t("versionDiff.loadError")}</p>
            : diskContent === null ? <p className="version-diff__message">{t("versionDiff.loading")}</p>
              : hunks.length === 0 ? <p className="version-diff__message">{t("versionDiff.identical")}</p>
                : hunks.flatMap((hunk, hunkIndex) => hunk.ops.map((op, index) => (
                  <div key={`${hunkIndex}-${index}`} className={`version-diff__line version-diff__line--${op.type}`}>
                    <span className="version-diff__gutter">{op.oldIndex === null ? "" : op.oldIndex + 1}</span>
                    <span className="version-diff__gutter">{op.newIndex === null ? "" : op.newIndex + 1}</span>
                    <span className="version-diff__marker">{op.type === "add" ? "+" : op.type === "remove" ? "−" : " "}</span>
                    <span className="version-diff__text">{op.text || " "}</span>
                  </div>
                )))}
        </div>

        <div className="unsaved-dialog__actions">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="outline" onClick={onKeepDisk} disabled={isSaving || diskContent === null}>
            {t("saveConflictDialog.keepServer")}
          </Button>
          <Button
            type="button"
            variant={versioningEnabled ? "default" : "destructive"}
            onClick={onOverwrite}
            disabled={isSaving || diskContent === null}
          >
            {isSaving ? t("common.saving") : t("saveConflictDialog.keepLocal")}
          </Button>
        </div>
      </div>
    </div>
  );
}
