import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type ImageLightboxProps = {
  src: string;
  alt: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  positionLabel?: string;
};

export function ImageLightbox({
  src,
  alt,
  onClose,
  onPrevious,
  onNext,
  positionLabel
}: ImageLightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrevious]);

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
      {onPrevious ? (
        <button
          type="button"
          className="media-preview__nav media-preview__nav--previous"
          aria-label={t("imageView.previous")}
          title={t("imageView.previous")}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      ) : null}

      <div className="media-preview__image-wrap">
        <img src={src} alt={alt} className="media-preview__image" />
        {positionLabel ? (
          <span className="media-preview__position">{positionLabel}</span>
        ) : null}
      </div>

      {onNext ? (
        <button
          type="button"
          className="media-preview__nav media-preview__nav--next"
          aria-label={t("imageView.next")}
          title={t("imageView.next")}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}
    </div>,
    document.body
  );
}
