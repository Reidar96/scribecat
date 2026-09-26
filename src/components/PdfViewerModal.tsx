import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  X,
  ZoomIn
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

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const MAX_RENDER_SCALE = 3.5;

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function pointerDistance(
  first: { x: number; y: number },
  second: { x: number; y: number }
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
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
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    pointerType: string;
    x: number;
    y: number;
    startedOnText: boolean;
  } | null>(null);
  const zoomRef = useRef(1);
  const zoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  } | null>(null);
  const [miniMap, setMiniMap] = useState({ left: 0, top: 0, width: 1, height: 1 });
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [miniMapImage, setMiniMapImage] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      // Desktop trackpad pinch is exposed as Ctrl+wheel. Keep the browser
      // from applying its own page zoom and apply it only to this PDF.
      if (!event.ctrlKey) return;

      event.preventDefault();
      event.stopPropagation();

      const page = pageRef.current;
      captureZoomAnchor(event.clientX, event.clientY);
      const factor = Math.exp(-event.deltaY / 240);
      setZoomValue(zoomRef.current * factor);
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === rootRef.current;
      setIsFullscreen(active);
      if (active) setFallbackFullscreen(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (document.fullscreenElement === rootRef.current) {
        void document.exitFullscreen?.();
      }
    };
  }, []);

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
    const stage = stageRef.current;
    if (!stage) return;

    const updateMiniMap = () => {
      const maxX = Math.max(1, stage.scrollWidth - stage.clientWidth);
      const maxY = Math.max(1, stage.scrollHeight - stage.clientHeight);
      setMiniMap({
        left: Math.min(1, stage.scrollLeft / maxX),
        top: Math.min(1, stage.scrollTop / maxY),
        width: Math.min(
          1,
          stage.clientWidth / Math.max(stage.scrollWidth, stage.clientWidth)
        ),
        height: Math.min(
          1,
          stage.clientHeight / Math.max(stage.scrollHeight, stage.clientHeight)
        )
      });
    };

    updateMiniMap();
    const frame = requestAnimationFrame(updateMiniMap);
    stage.addEventListener("scroll", updateMiniMap, { passive: true });
    window.addEventListener("resize", updateMiniMap);

    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", updateMiniMap);
      window.removeEventListener("resize", updateMiniMap);
    };
  }, [zoom, pageNumber, viewportVersion]);

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
      const requestedScale = Math.max(0.3, fitScale * zoom);
      const renderScale = Math.min(requestedScale, MAX_RENDER_SCALE);
      const cssZoom = requestedScale / renderScale;
      const viewport = page.getViewport({ scale: renderScale });
      const context = canvas.getContext("2d");

      if (!context) {
        setError(true);
        return;
      }

      pageElement.style.width = `${Math.floor(viewport.width * cssZoom)}px`;
      pageElement.style.height = `${Math.floor(viewport.height * cssZoom)}px`;
      pageElement.style.setProperty("--pdf-css-zoom", String(cssZoom));

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

        if (active) setMiniMapImage(canvas.toDataURL("image/png"));

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
            if (active) setMiniMapImage(canvas.toDataURL("image/png"));
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
          const anchor = zoomAnchorRef.current;
          if (anchor) {
            requestAnimationFrame(() => {
              if (!stageRef.current || !pageRef.current) return;
              const stage = stageRef.current;
              const page = pageRef.current;
              if (!stage || !page) return;

              const pageRect = page.getBoundingClientRect();
              const stageRect = stage.getBoundingClientRect();
              const pageContentLeft =
                pageRect.left - stageRect.left + stage.scrollLeft;
              const pageContentTop =
                pageRect.top - stageRect.top + stage.scrollTop;
              const pointerX = anchor.clientX - stageRect.left;
              const pointerY = anchor.clientY - stageRect.top;

              stage.scrollLeft = Math.max(
                0,
                pageContentLeft + pageRect.width * anchor.pageX - pointerX
              );
              stage.scrollTop = Math.max(
                0,
                pageContentTop + pageRect.height * anchor.pageY - pointerY
              );

              zoomAnchorRef.current = null;
            });
          }
        }
      }
    });

    return () => {
      active = false;
      renderCancelRef.current?.();
      textLayerCancelRef.current?.();
    };
  }, [pageNumber, pageCount, viewportVersion, zoom]);

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

  const captureZoomAnchor = (clientX: number, clientY: number) => {
    const page = pageRef.current;
    if (!page) return;

    const rect = page.getBoundingClientRect();
    zoomAnchorRef.current = {
      clientX,
      clientY,
      pageX: rect.width ? (clientX - rect.left) / rect.width : 0.5,
      pageY: rect.height ? (clientY - rect.top) / rect.height : 0.5
    };
  };

  const captureViewportCenterAnchor = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    captureZoomAnchor(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  };

  const setZoomValue = (value: number) => {
    const next = Math.round(clampZoom(value) * 100) / 100;
    if (next === 1) {
      resetZoom();
      return;
    }
    zoomRef.current = next;
    setZoom(next);
    setZoomOpen(true);
  };

  const resetZoom = () => {
    zoomAnchorRef.current = null;
    zoomRef.current = 1;
    setZoom(1);
    setZoomOpen(false);

    const resetScroll = () => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollTo({ left: 0, top: 0, behavior: "auto" });
    };

    requestAnimationFrame(() => {
      resetScroll();
      requestAnimationFrame(resetScroll);
    });
  };

  const toggleZoomControls = () => {
    if (zoomRef.current !== 1) {
      resetZoom();
      return;
    }
    setZoomOpen((open) => !open);
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      await document.exitFullscreen?.();
      return;
    }
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      setIsFullscreen(false);
      return;
    }
    if (root.requestFullscreen) {
      try {
        await root.requestFullscreen();
        return;
      } catch {
        // Fall back to app-level fullscreen if the host blocks the API.
      }
    }
    setFallbackFullscreen(true);
    setIsFullscreen(true);
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
    event.stopPropagation();

    const stage = stageRef.current;
    if (!stage || !stage.contains(event.target as Node)) {
      return;
    }

    const startedOnText =
      event.target instanceof Element &&
      Boolean(event.target.closest(".pdf-preview__text-layer"));

    if (event.pointerType === "mouse") {
      if (event.button !== 0 || zoomRef.current <= 1 || startedOnText) return;
      event.preventDefault();
      panRef.current = {
        pointerId: event.pointerId,
        pointerType: "mouse",
        x: event.clientX,
        y: event.clientY,
        startedOnText
      };
      setIsPanning(true);
      rootRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (event.pointerType !== "touch") return;

    const pointers = touchPointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      swipeRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now()
      };
      panRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        startedOnText
      };
      return;
    }

    if (pointers.size === 2) {
      event.preventDefault();
      swipeRef.current = null;
      panRef.current = null;
      

      setZoomOpen(true);
      const [first, second] = Array.from(pointers.values());
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      captureZoomAnchor(midpointX, midpointY);
      pinchRef.current = {
        distance: Math.max(1, pointerDistance(first, second)),
        zoom: zoomRef.current
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      panRef.current?.pointerId === event.pointerId &&
      (panRef.current.pointerType === "touch" || panRef.current.pointerType === "mouse")
    ) {
      const pan = panRef.current;
      if (zoomRef.current > 1 && !pan.startedOnText) {
        const stage = stageRef.current;
        if (stage) {
          event.preventDefault();
          stage.scrollLeft = Math.max(
            0,
            stage.scrollLeft - (event.clientX - pan.x)
          );
          stage.scrollTop = Math.max(
            0,
            stage.scrollTop - (event.clientY - pan.y)
          );
        }
        pan.x = event.clientX;
        pan.y = event.clientY;
        swipeRef.current = null;
      }
      return;
    }

    if (event.pointerType !== "touch") {
      return;
    }

    const pointers = touchPointersRef.current;
    const current = pointers.get(event.pointerId);
    if (!current) return;

    current.x = event.clientX;
    current.y = event.clientY;

    if (pointers.size !== 2 || !pinchRef.current) {
      return;
    }

    event.preventDefault();
    const [first, second] = Array.from(pointers.values());
    const distance = Math.max(1, pointerDistance(first, second));
    setZoomValue(
      pinchRef.current.zoom * (distance / pinchRef.current.distance)
    );
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      if (panRef.current?.pointerId === event.pointerId) {
        if (rootRef.current?.hasPointerCapture(event.pointerId)) {
          rootRef.current.releasePointerCapture(event.pointerId);
        }
        panRef.current = null;
        setIsPanning(false);
      }
      return;
    }
    if (event.pointerType !== "touch") return;

    touchPointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    panRef.current = null;
    

    if (touchPointersRef.current.size !== 0) {
      swipeRef.current = null;
      return;
    }

    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

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

    if (dx > 0) previousPage();
    else nextPage();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    finishPointer(event);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.pointerType === "mouse") {
      if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
      panRef.current = null;
      setIsPanning(false);
      return;
    }
    touchPointersRef.current.delete(event.pointerId);
    swipeRef.current = null;
    pinchRef.current = null;
    panRef.current = null;
  };

  return (
    <div
      ref={rootRef}
      className={`pdf-preview pdf-preview--${mode}${fallbackFullscreen ? " pdf-preview--fallback-fullscreen" : ""}`}
      tabIndex={0}
      onKeyDown={handleViewerKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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

          <button
            type="button"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? t("pdfViewer.exitFullscreen") : t("pdfViewer.fullscreen")}
            title={isFullscreen ? t("pdfViewer.exitFullscreen") : t("pdfViewer.fullscreen")}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>

          <div className="pdf-preview__zoom">
            <button
              type="button"
              aria-expanded={zoomOpen}
              aria-label={t("pdfViewer.zoom")}
              title={t("pdfViewer.zoom")}
              onClick={toggleZoomControls}
            >
              <ZoomIn aria-hidden="true" />
            </button>
            {zoomOpen ? (
              <div className="pdf-preview__zoom-panel">
                <label htmlFor="pdf-preview-zoom">
                  <span>{t("pdfViewer.zoom")}</span>
                  <output>{Math.round(zoom * 100)}%</output>
                </label>
                <input
                  id="pdf-preview-zoom"
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step="0.05"
                  value={zoom}
                  aria-label={t("pdfViewer.zoom")}
                  onChange={(event) => setZoomValue(Number(event.target.value))}
                />
              </div>
            ) : null}
          </div>

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

      <div ref={stageRef} className={`pdf-preview__stage${zoom > 1 ? " pdf-preview__stage--zoomed" : ""}`}>
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
          <div
            ref={pageRef}
            className={`pdf-preview__page${zoom > 1 ? " pdf-preview__page--zoomed" : ""}${isPanning ? " pdf-preview__page--panning" : ""}`}
          >
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
      {zoom > 1 ? (
        <div className="pdf-preview__minimap" aria-hidden="true">
          {miniMapImage ? <img src={miniMapImage} alt="" /> : null}
          <div
            className="pdf-preview__minimap-viewport"
            style={{
              left: miniMap.left * 100 + "%",
              top: miniMap.top * 100 + "%",
              width: miniMap.width * 100 + "%",
              height: miniMap.height * 100 + "%"
            }}
          />
        </div>
      ) : null}
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
