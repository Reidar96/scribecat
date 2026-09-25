import { useState } from "react";
import { Copy, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  canCopyImageToClipboard,
  copyImageToClipboard,
  downloadImage
} from "@/lib/imageActions";

type ImageContextMenuItemsProps = {
  src: string | null;
  fileName: string;
  onClose: () => void;
  onDelete?: () => void;
};

export function ImageContextMenuItems({
  src,
  fileName,
  onClose,
  onDelete
}: ImageContextMenuItemsProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyAvailable = Boolean(src) && canCopyImageToClipboard();

  const copy = async () => {
    if (!src || busy) return;
    setBusy("copy");
    setError(null);

    if (await copyImageToClipboard(src)) {
      onClose();
      return;
    }

    setBusy(null);
    setError(t("imageView.copyFailed"));
  };

  const download = async () => {
    if (!src || busy) return;
    setBusy("download");
    setError(null);

    if (await downloadImage(src, fileName)) {
      onClose();
      return;
    }

    setBusy(null);
    setError(t("imageView.downloadFailed"));
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!copyAvailable || busy !== null}
        title={copyAvailable ? undefined : t("imageView.copyUnavailable")}
        onClick={() => void copy()}
      >
        <Copy aria-hidden="true" />
        {t("imageView.copy")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!src || busy !== null}
        onClick={() => void download()}
      >
        <Download aria-hidden="true" />
        {t("imageView.download")}
      </button>
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          className="file-tree-context-menu__item file-tree-context-menu__item--danger"
          disabled={busy !== null}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          {t("imageView.delete")}
        </button>
      ) : null}
      {error ? (
        <div className="file-tree-context-menu__error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
