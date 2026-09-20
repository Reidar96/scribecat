import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

type SaveConflictDialogProps = {
  open: boolean;
  fileLabel: string | null;
  isSaving: boolean;
  onOverwrite: () => void;
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
export function SaveConflictDialog({ open, fileLabel, isSaving, onOverwrite, onCancel }: SaveConflictDialogProps) {
  const { t } = useTranslation();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const cancelButtonRef = useRef<HTMLElement>(null);

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
        className="unsaved-dialog__panel"
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
          <Button
            type="button"
            variant={versioningEnabled ? "default" : "destructive"}
            onClick={onOverwrite}
            disabled={isSaving}
          >
            {isSaving ? t("common.saving") : t("saveConflictDialog.overwrite")}
          </Button>
        </div>
      </div>
    </div>
  );
}
