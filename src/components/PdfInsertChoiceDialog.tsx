import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export type PdfInsertMode = "pages" | "preview";

type PdfInsertChoiceDialogProps = {
  open: boolean;
  fileCount: number;
  firstFileName: string;
  mediaKind?: "pdf" | "pptx";
  onChoose: (mode: PdfInsertMode) => void;
  onCancel: () => void;
};

export function PdfInsertChoiceDialog({
  open,
  fileCount,
  firstFileName,
  mediaKind = "pdf",
  onChoose,
  onCancel
}: PdfInsertChoiceDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="unsaved-dialog" role="presentation" onClick={onCancel}>
      <div
        className="unsaved-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-insert-choice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">
          {mediaKind === "pptx" ? t("pptxInsertChoice.eyebrow") : t("pdfInsertChoice.eyebrow")}
        </p>
        <h3 id="pdf-insert-choice-title">
          {mediaKind === "pptx" ? t("pptxInsertChoice.title") : t("pdfInsertChoice.title")}
        </h3>
        <p className="unsaved-dialog__description">
          {mediaKind === "pptx"
            ? fileCount > 1
              ? t("pptxInsertChoice.descriptionMany", { count: fileCount })
              : t("pptxInsertChoice.descriptionOne", { name: firstFileName })
            : fileCount > 1
              ? t("pdfInsertChoice.descriptionMany", { count: fileCount })
              : t("pdfInsertChoice.descriptionOne", { name: firstFileName })}
        </p>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="outline" onClick={() => onChoose("pages")}>
            {mediaKind === "pptx"
              ? t("pptxInsertChoice.pages")
              : t("pdfInsertChoice.pages")}
          </Button>
          <Button type="button" onClick={() => onChoose("preview")}>
            {mediaKind === "pptx"
              ? t("pptxInsertChoice.preview")
              : t("pdfInsertChoice.preview")}
          </Button>
        </div>
      </div>
    </div>
  );
}
