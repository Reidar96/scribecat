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
  ZoomIn,
  Square,
  Grid2X2
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { readFile } from "@/platform/vaultFs";
import { copyText } from "@/lib/clipboard";

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
  pageNumber?: number;
};

type PdfViewerSurfaceProps = PdfPreviewRequest & {
  onClose?: () => void;
  onOpenInSplit?: (pageNumber: number) => void;
  onPageChange?: (pageNumber: number) => void;
  initialPageNumber?: number;
  mode?: "modal" | "split" | "inline";
  restoreMinimizedRequestId?: number;
};


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
  onPageChange,
  initialPageNumber = 1,
  mode = "modal",
  restoreMinimizedRequestId = 0
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
  const renderZoomRef = useRef(1);
  const zoomRenderTimerRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  } | null>(null);
  const lastReportedPageRef = useRef<number | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPageNumber));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPageNumber)));
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
  const [renderZoom, setRenderZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const lastRestoreMinimizedRequestIdRef = useRef(restoreMinimizedRequestId);
  const [pageView, setPageView] = useState<"single" | "grid">("single");
  const [pageThumbnails, setPageThumbnails] = useState<string[]>([]);
  const [pageThumbnailLoading, setPageThumbnailLoading] = useState(false);

  const previousPage = () => {
    setPageNumber((page) => Math.max(1, page - 1));
  };

  const nextPage = () => {
    setPageNumber((page) => Math.min(pageCount || 1, page + 1));
  };

  useEffect(() => {
    setPageInput(String(pageNumber));

    if (lastReportedPageRef.current === pageNumber) {
      return;
    }

    lastReportedPageRef.current = pageNumber;
    onPageChange?.(pageNumber);
  }, [pageNumber, onPageChange]);

  useEffect(() => {
    zoomRef.current = zoom;
    renderZoomRef.current = renderZoom;
  }, [zoom, renderZoom]);

  useEffect(() => {
    if (
      mode === "inline" &&
      restoreMinimizedRequestId > 0 &&
      restoreMinimizedRequestId !== lastRestoreMinimizedRequestIdRef.current
    ) {
      setIsMinimized(false);
    }

    lastRestoreMinimizedRequestIdRef.current = restoreMinimizedRequestId;
  }, [mode, restoreMinimizedRequestId]);

  useEffect(() => {
    return () => {
      if (zoomRenderTimerRef.current !== null) {
        window.clearTimeout(zoomRenderTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      // Desktop trackpad pinch is exposed as Ctrl+wheel. Keep the browser
      // from applying its own page zoom and apply it only to this PDF.
      if (!event.ctrlKey) return;

      event.preventDefault();
      event.stopPropagation();

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
        setPageView("single");
        setPageThumbnails([]);

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
        setPageNumber(
          Math.max(1, Math.min(document.numPages, initialPageNumber))
        );
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
    if (pageView !== "grid") {
      setPageThumbnails([]);
      setPageThumbnailLoading(false);
      return;
    }

    const document = documentRef.current;
    if (!document || pageCount === 0) {
      return;
    }

    let active = true;
    setPageThumbnailLoading(true);
    setPageThumbnails([]);

    void (async () => {
      const thumbnails: string[] = [];

      try {
        for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
          if (!active) return;

          const page = await document.getPage(pageIndex);
          const baseViewport = page.getViewport({ scale: 1 });
          const stage = stageRef.current;
          const stageWidth = stage?.clientWidth || window.innerWidth;
          const computedStage = stage ? window.getComputedStyle(stage) : null;
          const horizontalPadding =
            (Number.parseFloat(computedStage?.paddingLeft ?? "0") || 0) +
            (Number.parseFloat(computedStage?.paddingRight ?? "0") || 0);
          const contentWidth = Math.max(320, stageWidth - horizontalPadding - 32);
          const columns = stageWidth >= 1000 ? 2 : 1;
          const targetCssWidth = Math.min(
            720,
            Math.max(320, (contentWidth - (columns - 1) * 16) / columns)
          );
          const scale = Math.max(
            0.45,
            targetCssWidth / Math.max(1, baseViewport.width)
          );
          const viewport = page.getViewport({ scale });
          const qualityScale = Math.min(
            2,
            Math.max(1.5, window.devicePixelRatio || 1)
          );
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width * qualityScale));
          canvas.height = Math.max(1, Math.ceil(viewport.height * qualityScale));
          canvas.style.width = String(Math.ceil(viewport.width)) + "px";
          canvas.style.height = String(Math.ceil(viewport.height)) + "px";
          const context = canvas.getContext("2d");

          if (!context) {
            canvas.remove();
            continue;
          }

          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvasContext: context,
            viewport,
            transform:
              qualityScale === 1
                ? undefined
                : [qualityScale, 0, 0, qualityScale, 0, 0]
          }).promise;

          if (!active) return;
          thumbnails.push(canvas.toDataURL("image/png"));
          canvas.width = 1;
          canvas.height = 1;
        }

        if (active) setPageThumbnails(thumbnails);
      } finally {
        if (active) setPageThumbnailLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [pageView, pageCount]);

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
      const requestedScale = Math.max(0.3, fitScale * renderZoom);
      const renderScale = Math.min(requestedScale, MAX_RENDER_SCALE);
      const cssZoom = requestedScale / renderScale;
      const viewport = page.getViewport({ scale: renderScale });
      const context = canvas.getContext("2d");

      if (!context) {
        setError(true);
        return;
      }

      const renderedWidth = Math.floor(viewport.width * cssZoom);
      const renderedHeight = Math.floor(viewport.height * cssZoom);
      const visualRatio = zoom / Math.max(0.01, renderZoom);
      pageElement.style.width = `${Math.max(1, Math.round(renderedWidth * visualRatio))}px`;
      pageElement.style.height = `${Math.max(1, Math.round(renderedHeight * visualRatio))}px`;
      pageElement.style.setProperty("--pdf-css-zoom", String(cssZoom));
      pageElement.style.setProperty("--pdf-view-zoom", String(visualRatio));

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
          const anchor = zoomAnchorRef.current;
          if (anchor) {
            requestAnimationFrame(() => {
              if (!stageRef.current || !pageRef.current) return;
              const stage = stageRef.current;
              const page = pageRef.current;
              if (!stage || !page) return;

              const stageRect = stage.getBoundingClientRect();
              const pointerX = anchor.clientX - stageRect.left;
              const pointerY = anchor.clientY - stageRect.top;

              stage.scrollLeft = Math.max(
                0,
                page.offsetLeft + page.offsetWidth * anchor.pageX - pointerX
              );
              stage.scrollTop = Math.max(
                0,
                page.offsetTop + page.offsetHeight * anchor.pageY - pointerY
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
  }, [pageNumber, pageCount, viewportVersion, renderZoom, pageView]);

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
    const stage = stageRef.current;
    const page = pageRef.current;
    if (!stage || !page) return;

    const stageRect = stage.getBoundingClientRect();
    const pointerX = clientX - stageRect.left;
    const pointerY = clientY - stageRect.top;
    const pageWidth = Math.max(1, page.offsetWidth);
    const pageHeight = Math.max(1, page.offsetHeight);
    const pageLeft = page.offsetLeft;
    const pageTop = page.offsetTop;

    zoomAnchorRef.current = {
      clientX,
      clientY,
      pageX: Math.min(
        1,
        Math.max(0, (stage.scrollLeft + pointerX - pageLeft) / pageWidth)
      ),
      pageY: Math.min(
        1,
        Math.max(0, (stage.scrollTop + pointerY - pageTop) / pageHeight)
      )
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

  const scheduleRenderZoom = (next: number) => {
    if (zoomRenderTimerRef.current !== null) {
      window.clearTimeout(zoomRenderTimerRef.current);
    }

    if (next === renderZoomRef.current) return;

    zoomRenderTimerRef.current = window.setTimeout(() => {
      zoomRenderTimerRef.current = null;
      renderZoomRef.current = next;
      setRenderZoom(next);
    }, 140);
  };

  const applyVisualZoom = (next: number, previousZoom = zoomRef.current) => {
    const stage = stageRef.current;
    const page = pageRef.current;
    if (!stage || !page) return;

    const anchor = zoomAnchorRef.current;
    const stageRect = stage.getBoundingClientRect();
    const pointerX = anchor
      ? anchor.clientX - stageRect.left
      : stageRect.width / 2;
    const pointerY = anchor
      ? anchor.clientY - stageRect.top
      : stageRect.height / 2;
    const currentZoom = Math.max(0.01, previousZoom);
    const currentWidth = Math.max(1, page.offsetWidth);
    const currentHeight = Math.max(1, page.offsetHeight);
    const scale = next / currentZoom;

    page.style.width = String(Math.max(1, Math.round(currentWidth * scale))) + "px";
    page.style.height = String(Math.max(1, Math.round(currentHeight * scale))) + "px";
    page.style.setProperty("--pdf-view-zoom", String(
      next / Math.max(0.01, renderZoomRef.current)
    ));

    const pageLeft = page.offsetLeft;
    const pageTop = page.offsetTop;
    const pageX = pageLeft + page.offsetWidth * (anchor?.pageX ?? 0.5);
    const pageY = pageTop + page.offsetHeight * (anchor?.pageY ?? 0.5);

    stage.scrollLeft = Math.max(0, pageX - pointerX);
    stage.scrollTop = Math.max(0, pageY - pointerY);
  };
  const setZoomValue = (value: number) => {
    const next = Math.round(clampZoom(value) * 100) / 100;
    const previousZoom = zoomRef.current;

    if (next === 1) {
      resetZoom();
      return;
    }

    zoomRef.current = next;
    setZoom(next);
    setZoomOpen(true);
    applyVisualZoom(next, previousZoom);
    scheduleRenderZoom(next);
  };

  const resetZoom = () => {
    zoomAnchorRef.current = null;
    const previousZoom = zoomRef.current;
    zoomRef.current = 1;
    setZoom(1);
    setZoomOpen(false);

    if (zoomRenderTimerRef.current !== null) {
      window.clearTimeout(zoomRenderTimerRef.current);
      zoomRenderTimerRef.current = null;
    }

    renderZoomRef.current = 1;
    setRenderZoom(1);
    applyVisualZoom(1, previousZoom);

    requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollTo({ left: 0, top: 0, behavior: "auto" });
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

      const didCopy = await copyText(text);
      if (!didCopy) return;
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
      Boolean(event.target.closest(".pdf-preview__text-layer span"));

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
    const midpointX = (first.x + second.x) / 2;
    const midpointY = (first.y + second.y) / 2;
    captureZoomAnchor(midpointX, midpointY);
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
      className={`pdf-preview pdf-preview--${mode}${pageView === "grid" ? " pdf-preview--grid" : ""}${fallbackFullscreen ? " pdf-preview--fallback-fullscreen" : ""}${isMinimized ? " pdf-preview--minimized" : ""}`}
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
                  onChange={(event) => {
                    captureViewportCenterAnchor();
                    setZoomValue(Number(event.target.value));
                  }}
                />
              </div>
            ) : null}
          </div>

          <div className="pdf-preview__view-switch" role="group" aria-label="Page view">
            <button
              type="button"
              className={pageView === "single" ? "pdf-preview__view-button pdf-preview__view-button--active" : "pdf-preview__view-button"}
              aria-pressed={pageView === "single"}
              aria-label="Single page"
              title="Single page"
              onClick={() => setPageView("single")}
            >
              <Square aria-hidden="true" />
            </button>
            <button
              type="button"
              className={pageView === "grid" ? "pdf-preview__view-button pdf-preview__view-button--active" : "pdf-preview__view-button"}
              aria-pressed={pageView === "grid"}
              aria-label="All pages"
              title="All pages"
              onClick={() => setPageView("grid")}
            >
              <Grid2X2 aria-hidden="true" />
            </button>
          </div>

          {onOpenInSplit ? (
            <button
              type="button"
              aria-label={t("pdfViewer.openInSplit")}
              title={t("pdfViewer.openInSplit")}
              onClick={() => {
                if (mode === "inline") {
                  setIsMinimized(true);
                }
                onOpenInSplit(pageNumber);
              }}
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

      {!isMinimized ? (
        <div
          ref={stageRef}
          className={`pdf-preview__stage${zoom > 1 ? " pdf-preview__stage--zoomed" : ""}${pageView === "grid" ? " pdf-preview__stage--grid" : ""}`}
        >
        {loading ? (
          <div className="pdf-preview__message">
            <Loader2 className="pdf-preview__spinner" aria-hidden="true" />
            <span>{t("pdfViewer.loading")}</span>
          </div>
        ) : error ? (
          <div className="pdf-preview__message" role="alert">
            {t("pdfViewer.error")}
          </div>
        ) : pageView === "grid" ? (
          <div className="pdf-preview__overview">
            {pageThumbnailLoading && pageThumbnails.length === 0 ? (
              <div className="pdf-preview__message">
                <Loader2 className="pdf-preview__spinner" aria-hidden="true" />
                <span>Loading pages…</span>
              </div>
            ) : null}
            {pageThumbnails.map((src, index) => (
              <button
                type="button"
                className="pdf-preview__overview-page"
                key={src}
                onClick={() => {
                  setPageNumber(index + 1);
                  setPageView("single");
                }}
                aria-label={`Page ${index + 1}`}
              >
                <img src={src} alt="" />
                <span>{index + 1} / {pageThumbnails.length}</span>
              </button>
            ))}
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
      ) : null}

    </div>
  );
}

type PdfViewerModalProps = PdfPreviewRequest & {
  onClose: () => void;
  onOpenInSplit?: (pageNumber: number) => void;
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
