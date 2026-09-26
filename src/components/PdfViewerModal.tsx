import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Loader2,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { readFile } from "@/platform/vaultFs";

type PdfTextItemLike = {
  str?: string;
  hasEOL?: boolean;
};

type PdfPageLike = {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }): { promise: Promise<void>; cancel?: () => void };
};

type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
};

export type PdfPreviewRequest = {
  absolutePath: string;
  label: string;
};

type PdfViewerSurfaceProps = PdfPreviewRequest & {
  onClose: () => void;
  onOpenInSplit?: () => void;
  mode?: "modal" | "split";
};

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function textFromItems(items: unknown[]): string {
  let text = "";

  for (const value of items) {
    if (!value || typeof value !== "object" || !("str" in value)) {
      continue;
    }

    const item = value as PdfTextItemLike;
    const part = typeof item.str === "string" ? item.str : "";

    if (!part) continue;

    text += part;
    text += item.hasEOL ? "\n" : " ";
  }

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function PdfViewerSurface({
  absolutePath,
  label,
  onClose,
  onOpenInSplit,
  mode = "modal"
}: PdfViewerSurfaceProps) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PdfDocumentLike | null>(null);
  const renderCancelRef = useRef<(() => void) | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

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
    const stage = stageRef.current;

    if (!stage) return;

    const update = () => setViewportVersion((version) => version + 1);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);

    observer?.observe(stage);
    window.addEventListener("resize", update);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    const stage = stageRef.current;

    if (!document || !canvas || !stage || pageNumber < 1 || pageNumber > document.numPages) {
      return;
    }

    let active = true;
    renderCancelRef.current?.();

    void document.getPage(pageNumber).then(async (page) => {
      if (!active) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const stageWidth = stage.clientWidth || window.innerWidth;
      const stageHeight = stage.clientHeight || window.innerHeight;
      const availableWidth = Math.max(240, stageWidth - 32);
      const availableHeight = Math.max(260, stageHeight - 32);
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height
      );
      const viewport = page.getViewport({ scale: Math.max(0.3, Math.min(fitScale, 2.4)) });
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
    if (mode !== "modal") return;

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
  }, [mode, onClose, pageCount]);

  const commitPageInput = () => {
    const requested = Number.parseInt(pageInput, 10);

    if (!Number.isFinite(requested) || pageCount === 0) {
      setPageInput(String(pageNumber));
      return;
    }

    setPageNumber(Math.max(1, Math.min(pageCount, requested)));
  };

  const copyCurrentPage = async () => {
    const document = documentRef.current;
    if (!document || pageCount === 0) return;

    try {
      setCopying(true);
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textFromItems(textContent.items);

      if (!text) {
        return;
      }

      await copyText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className={`pdf-preview pdf-preview--${mode}`}>
      <div className="pdf-preview__toolbar">
        <strong className="pdf-preview__name" title={label}>
          {label}
        </strong>

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

          <label className="pdf-preview__page-input">
            <span className="sr-only">{t("pdfViewer.page")}</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              value={pageInput}
              disabled={loading || pageCount === 0}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageInput();
                  event.currentTarget.blur();
                }
              }}
            />
            <span>{pageCount > 0 ? `/ ${pageCount}` : "…"}</span>
          </label>

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

        <div className="pdf-preview__actions">
          <button
            type="button"
            disabled={loading || copying || pageCount === 0}
            aria-label={copied ? t("pdfViewer.copied") : t("pdfViewer.copyPage")}
            title={copied ? t("pdfViewer.copied") : t("pdfViewer.copyPage")}
            onClick={() => void copyCurrentPage()}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>

          {onOpenInSplit ? (
            <button
              type="button"
              aria-label={t("pdfViewer.openInSplit")}
              title={t("pdfViewer.openInSplit")}
              onClick={onOpenInSplit}
            >
              <Columns2 aria-hidden="true" />
            </button>
          ) : null}

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
      </div>

      <div ref={stageRef} className="pdf-preview__stage">
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
    </div>
  );
}

type PdfViewerModalProps = PdfPreviewRequest & {
  onClose: () => void;
  onOpenInSplit?: () => void;
};

export function PdfViewerModal({
  absolutePath,
  label,
  onClose,
  onOpenInSplit
}: PdfViewerModalProps) {
  const { t } = useTranslation();

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
      <PdfViewerSurface
        absolutePath={absolutePath}
        label={label}
        onClose={onClose}
        onOpenInSplit={onOpenInSplit}
      />
    </div>,
    document.body
  );
}
