import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { ImageContextMenuItems } from "@/components/ImageContextMenuItems";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";

type ImageLightboxProps = {
  src: string;
  alt: string;
  fileName?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  positionLabel?: string;
};

export function ImageLightbox({
  src,
  alt,
  fileName = "image",
  onClose,
  onPrevious,
  onNext,
  positionLabel
}: ImageLightboxProps) {
  const { t } = useTranslation();
  const { contextMenu, setContextMenu } = useContextMenuState<{ x: number; y: number }>();
  const { getLongPressProps } = useLongPressContextMenu<null>((_target, x, y) =>
    setContextMenu({ x, y })
  );
  const longPressProps = getLongPressProps(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

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
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartRef.current;
        const touch = event.changedTouches[0];
        touchStartRef.current = null;
        if (!start || !touch) return;

        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) {
          return;
        }

        if (deltaX > 0) {
          onPrevious?.();
        } else {
          onNext?.();
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
        <img
          src={src}
          alt={alt}
          className="media-preview__image"
          data-scribecat-long-press={longPressProps["data-scribecat-long-press"]}
          onPointerDown={longPressProps.onPointerDown}
          onPointerMove={longPressProps.onPointerMove}
          onPointerUp={longPressProps.onPointerUp}
          onPointerCancel={longPressProps.onPointerCancel}
          onClickCapture={longPressProps.onClickCapture}
          onContextMenuCapture={longPressProps.onContextMenuCapture}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        />
        {positionLabel ? (
          <span className="media-preview__position">{positionLabel}</span>
        ) : null}
      </div>

      {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={alt || t("imageView.preview")}
          onClick={(event) => event.stopPropagation()}
        >
          <ImageContextMenuItems
            src={src}
            fileName={fileName}
            onClose={() => setContextMenu(null)}
          />
        </ContextMenuSurface>
      ) : null}

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
