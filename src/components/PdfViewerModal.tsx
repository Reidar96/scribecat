import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readFile } from "@/platform/vaultFs";

type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
      transform?: number[];
    }): { promise: Promise<void>; cancel?: () => void };
  }>;
  destroy?: () => Promise<void>;
};

type PdfViewerModalProps = {
  absolutePath: string;
  label: string;
  onClose: () => void;
};

export function PdfViewerModal({ absolutePath, label, onClose }: PdfViewerModalProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PdfDocumentLike | null>(null);
  const renderCancelRef = useRef<(() => void) | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let loadedDocument: PdfDocumentLike | null = null;

    const load = async () => {
      try {
        setLoading(true);
        setError(false);

        const [data, pdfjs, worker] = await Promise.all([
          readFile(absolutePath),
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ]);

        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const document = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocumentLike;
        loadedDocument = document;

        if (!active) {
          await document.destroy?.();
          return;
        }

        documentRef.current = document;
        setPageCount(document.numPages);
        setPageNumber(1);
      } catch {
        if (active) {
          setError(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      renderCancelRef.current?.();
      documentRef.current = null;
      void loadedDocument?.destroy?.();
    };
  }, [absolutePath]);

  useEffect(() => {
    const onResize = () => setViewportVersion((version) => version + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;

    if (!document || !canvas || pageNumber < 1 || pageNumber > document.numPages) {
      return;
    }

    let active = true;
    renderCancelRef.current?.();

    void document.getPage(pageNumber).then(async (page) => {
      if (!active) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, Math.min(window.innerWidth - 64, 1180));
      const availableHeight = Math.max(320, window.innerHeight - 150);
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height
      );
      const viewport = page.getViewport({ scale: Math.max(0.35, fitScale) });
      const context = canvas.getContext("2d");

      if (!context) {
        setError(true);
        return;
      }

      const outputScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const task = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      });

      renderCancelRef.current = () => task.cancel?.();
      setRendering(true);

      try {
        await task.promise;
      } catch (renderError) {
        const name =
          renderError && typeof renderError === "object" && "name" in renderError
            ? String((renderError as { name?: unknown }).name)
            : "";

        if (active && name !== "RenderingCancelledException") {
          setError(true);
        }
      } finally {
        if (active) {
          setRendering(false);
        }
      }
    });

    return () => {
      active = false;
      renderCancelRef.current?.();
    };
  }, [pageNumber, pageCount, viewportVersion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        setPageNumber((page) => Math.max(1, page - 1));
      } else if (event.key === "ArrowRight") {
        setPageNumber((page) => Math.min(pageCount || 1, page + 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pageCount]);

  return createPortal(
    <div
      className="media-preview media-preview--pdf"
      role="dialog"
      aria-modal="true"
      aria-label={t("pdfViewer.title", { name: label })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="pdf-preview__toolbar">
        <strong className="pdf-preview__name">{label}</strong>
        <div className="pdf-preview__pager">
          <button
            type="button"
            disabled={loading || pageNumber <= 1}
            aria-label={t("pdfViewer.previous")}
            title={t("pdfViewer.previous")}
            onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>
            {pageCount > 0
              ? t("pdfViewer.pageCount", { page: pageNumber, count: pageCount })
              : t("pdfViewer.loading")}
          </span>
          <button
            type="button"
            disabled={loading || pageCount === 0 || pageNumber >= pageCount}
            aria-label={t("pdfViewer.next")}
            title={t("pdfViewer.next")}
            onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="pdf-preview__close"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="pdf-preview__stage">
        {loading ? (
          <div className="pdf-preview__message">
            <Loader2 className="pdf-preview__spinner" aria-hidden="true" />
            <span>{t("pdfViewer.loading")}</span>
          </div>
        ) : error ? (
          <div className="pdf-preview__message" role="alert">
            {t("pdfViewer.error")}
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="pdf-preview__canvas" />
            {rendering ? (
              <div className="pdf-preview__rendering" aria-hidden="true">
                <Loader2 className="pdf-preview__spinner" />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
