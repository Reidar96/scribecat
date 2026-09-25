import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { downloadImage } from "@/lib/imageActions";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!src || busy) return;
    setBusy(true);
    setError(null);

    if (await downloadImage(src, fileName)) {
      onClose();
      return;
    }

    setBusy(false);
    setError(t("imageView.downloadFailed"));
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="file-tree-context-menu__item"
        disabled={!src || busy}
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
          disabled={busy}
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
