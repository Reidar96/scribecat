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

type PdfTextContentLike = {
  items: unknown[];
  styles?: Record<string, unknown>;
};

type PdfViewportLike = {
  width: number;
  height: number;
  scale: number;
};

type PdfPageLike = {
  getViewport(options: { scale: number }): PdfViewportLike;
  getTextContent(): Promise<PdfTextContentLike>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
    transform?: number[];
  }): { promise: Promise<void>; cancel?: () => void };
};

type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
};

type PdfTextLayerLike = {
  render(): Promise<void>;
  cancel?: () => void;
};

type PdfTextLayerConstructor = new (options: {
  textContentSource: PdfTextContentLike;
  container: HTMLElement;
  viewport: PdfViewportLike;
}) => PdfTextLayerLike;

type PdfJsModuleLike = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: { data: Uint8Array }): {
    promise: Promise<PdfDocumentLike>;
  };
  TextLayer?: PdfTextLayerConstructor;
};

export type PdfPreviewRequest = {
  absolutePath: string;
  label: string;
};

type PdfViewerSurfaceProps = PdfPreviewRequest & {
  onClose?: () => void;
  onOpenInSplit?: () => void;
  mode?: "modal" | "split" | "inline";
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

function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement
  );
}

export function PdfViewerSurface({
  absolutePath,
  label,
  onClose,
  onOpenInSplit,
  mode = "modal"
}: PdfViewerSurfaceProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PdfDocumentLike | null>(null);
  const textLayerConstructorRef = useRef<PdfTextLayerConstructor | null>(null);
  const renderCancelRef = useRef<(() => void) | null>(null);
  const textLayerCancelRef = useRef<(() => void) | null>(null);
  const swipeRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);

  const previousPage = () => {
    setPageNumber((page) => Math.max(1, page - 1));
  };

  const nextPage = () => {
    setPageNumber((page) => Math.min(pageCount || 1, page + 1));
  };

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

        const [data, pdfjsModule, worker] = await Promise.all([
          readFile(absolutePath),
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ]);
        const pdfjs = pdfjsModule as unknown as PdfJsModuleLike;

        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        textLayerConstructorRef.current = pdfjs.TextLayer ?? null;

        const document = await pdfjs.getDocument({ data }).promise;
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
      textLayerCancelRef.current?.();
      documentRef.current = null;
      textLayerConstructorRef.current = null;
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
    const pageElement = pageRef.current;
    const textLayerElement = textLayerRef.current;

    if (
      !document ||
      !canvas ||
      !stage ||
      !pageElement ||
      !textLayerElement ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    ) {
      return;
    }

    let active = true;
    renderCancelRef.current?.();
    textLayerCancelRef.current?.();
    textLayerElement.replaceChildren();

    void document.getPage(pageNumber).then(async (page) => {
      if (!active) return;

      const baseViewport = page.getViewport({ scale: 1 });
      // The inline viewer should follow the actual PDF page ratio. This keeps
      // the window compact when the note column becomes narrower instead of
      // leaving a large fixed-height area below a landscape page.
      stage.style.setProperty(
        "--pdf-page-aspect-ratio",
        `${baseViewport.width} / ${baseViewport.height}`
      );
      const stageWidth = stage.clientWidth || window.innerWidth;
      const stageHeight = stage.clientHeight || window.innerHeight;
      const availableWidth = Math.max(240, stageWidth - 32);
      const availableHeight = Math.max(260, stageHeight - 32);
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height
      );
      const viewport = page.getViewport({
        scale: Math.max(0.3, Math.min(fitScale, 2.4))
      });
      const context = canvas.getContext("2d");

      if (!context) {
        setError(true);
        return;
      }

      pageElement.style.width = `${Math.floor(viewport.width)}px`;
      pageElement.style.height = `${Math.floor(viewport.height)}px`;

      const outputScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
      textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
      // PDF.js v6 uses --total-scale-factor; --scale-factor keeps the same
      // layer compatible with older PDF.js internals should the dependency be
      // temporarily rolled back.
      textLayerElement.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale)
      );
      textLayerElement.style.setProperty("--scale-factor", String(viewport.scale));

      const task = page.render({
        canvasContext: context,
        viewport,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0]
      });

      renderCancelRef.current = () => task.cancel?.();
      setRendering(true);

      try {
        await task.promise;

        if (!active) {
          return;
        }

        const TextLayer = textLayerConstructorRef.current;

        if (TextLayer) {
          try {
            const textContent = await page.getTextContent();

            if (!active) {
              return;
            }

            const textLayer = new TextLayer({
              textContentSource: textContent,
              container: textLayerElement,
              viewport
            });
            textLayerCancelRef.current = () => textLayer.cancel?.();
            await textLayer.render();
          } catch (textLayerError) {
            // The canvas remains useful if a malformed PDF defeats only the
            // selectable text overlay. Keep page navigation/copy available.
            console.warn("PDF text layer could not be rendered:", textLayerError);
          }
        }
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
      textLayerCancelRef.current?.();
    };
  }, [pageNumber, pageCount, viewportVersion]);

  useEffect(() => {
    if (mode !== "modal") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.fullscreenElement === rootRef.current) {
        return;
      }

      if (event.key === "Escape" && fallbackFullscreen) {
        event.preventDefault();
        setFallbackFullscreen(false);
        setIsFullscreen(false);
        return;
      }

      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (isFormControl(event.target)) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousPage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nextPage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose, pageCount, fallbackFullscreen]);

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

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode === "modal" || isFormControl(event.target)) {
      return;
    }

    // When the user has highlighted PDF text, arrow keys belong to the native
    // selection instead of changing pages.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousPage();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nextPage();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Keep ProseMirror from turning a text-selection gesture into selection of
    // the entire image/media node. Do not preventDefault: the browser still
    // needs the native event to select PDF text.
    event.stopPropagation();

    if (event.pointerType === "touch" && event.isPrimary) {
      swipeRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now()
      };
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    const start = swipeRef.current;
    swipeRef.current = null;

    if (
      !start ||
      start.pointerId !== event.pointerId ||
      event.pointerType !== "touch"
    ) {
      return;
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const duration = performance.now() - start.startedAt;

    if (
      duration > 700 ||
      Math.abs(dx) < 56 ||
      Math.abs(dx) < Math.abs(dy) * 1.25
    ) {
      return;
    }

    if (dx > 0) {
      previousPage();
    } else {
      nextPage();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`pdf-preview pdf-preview--${mode}${fallbackFullscreen ? " pdf-preview--fallback-fullscreen" : ""}`}
      tabIndex={0}
      onKeyDown={handleViewerKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        swipeRef.current = null;
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
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
            onClick={previousPage}
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
            onClick={nextPage}
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

          {onClose ? (
            <button
              type="button"
              className="pdf-preview__close"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
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
          <div ref={pageRef} className="pdf-preview__page">
            <canvas ref={canvasRef} className="pdf-preview__canvas" />
            <div
              ref={textLayerRef}
              className="textLayer pdf-preview__text-layer"
              aria-label={t("pdfViewer.selectableText")}
            />
            {rendering ? (
              <div className="pdf-preview__rendering" aria-hidden="true">
                <Loader2 className="pdf-preview__spinner" />
              </div>
            ) : null}
          </div>
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
