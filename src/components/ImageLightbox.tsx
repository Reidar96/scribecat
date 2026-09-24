import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

type ImageLightboxProps = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="media-preview"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("imageView.preview")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="media-preview__close"
        aria-label={t("common.close")}
        title={t("common.close")}
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
      <div className="media-preview__image-wrap">
        <img src={src} alt={alt} className="media-preview__image" />
      </div>
    </div>,
    document.body
  );
}
