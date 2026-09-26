import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  FileText,
  Grid2X2,
  Loader2,
  Maximize2,
  Minimize2 ,
  Square,
  X,
  ZoomIn
} from "lucide-react";
import { readFile } from "@/platform/vaultFs";
import { copyText } from "@/lib/clipboard";
import {
  DEFAULT_DOCX_PAGE_SIZE,
  getDocxPageSize,
  type DocxPageSize
} from "@/lib/editor/docxPageSize";

export type DocumentPreviewRequest = {
  absolutePath: string;
  label: string;
  pageNumber?: number;
};

type Props = DocumentPreviewRequest & {
  onClose?: () => void;
  onOpenInSplit?: (pageNumber: number) => void;
  onPageChange?: (pageNumber: number) => void;
  initialPageNumber?: number;
  mode?: "modal" | "split";
};

type Slide = { svg: string; text: string };

function extension(path: string): string {
  return path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
}

function mimeFor(path: string): string {
  const ext = extension(path);
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "m4v") return "video/x-m4v";
  return "application/octet-stream";
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

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function pointerDistance(
  first: { x: number; y: number },
  second: { x: number; y: number }
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function mmToPixels(mm: number): number {
  return (mm / 25.4) * 96;
}

const OfficeVisual = memo(function OfficeVisual({
  html,
  svg,
  className
}: {
  html?: string;
  svg?: string;
  className: string;
}) {
  if (html !== undefined) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: svg ?? "" }} />;
});

const WordOverviewPage = memo(function WordOverviewPage({
  html,
  widthPx,
  heightPx
}: {
  html: string;
  widthPx: number;
  heightPx: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const update = () => {
      const frameWidth = Math.max(1, frame.clientWidth);
      const frameHeight = Math.max(1, frame.clientHeight);
      setScale(
        Math.min(
          frameWidth / Math.max(1, widthPx),
          frameHeight / Math.max(1, heightPx)
        )
      );
    };

    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(frame);

    return () => observer?.disconnect();
  }, [widthPx, heightPx]);

  return (
    <div
      ref={frameRef}
      className="pdf-preview__overview-page-frame pdf-preview__overview-page-frame--word"
    >
      <div
        className="document-preview__word-sheet document-preview__word-sheet--overview"
        style={{
          width: widthPx + "px",
          height: heightPx + "px",
          minHeight: heightPx + "px",
          transform: `translate(-50%, -50%) scale(${scale})`
        }}
      >
        <OfficeVisual
          html={html}
          className="document-preview__word-sheet-content"
        />
      </div>
    </div>
  );
});

export function DocumentViewer({
  absolutePath,
  label,
  onClose,
  onOpenInSplit,
  onPageChange,
  initialPageNumber = 1,
  mode = "modal"
}: Props) {
  const { t } = useTranslation();
  const ext = extension(absolutePath);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const wordMeasureRef = useRef<HTMLDivElement>(null);
  const zoomUiFrameRef = useRef<number | null>(null);
  const pendingZoomUiRef = useRef(1);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const swipeRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);
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
  const feedbackTimerRef = useRef<number | null>(null);
  const lastReportedPageRef = useRef<number | null>(null);

  const [data, setData] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState("");
  const [wordPages, setWordPages] = useState<string[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPageNumber));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPageNumber)));
  const [pageView, setPageView] = useState<"single" | "grid">("single");
  const [zoom, setZoom] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [wordPageSize, setWordPageSize] = useState<DocxPageSize>(DEFAULT_DOCX_PAGE_SIZE);
  const [viewportVersion, setViewportVersion] = useState(0);

  const isVideo = ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext);
  const isWord = ext === "docx";
  const isPowerPoint = ext === "pptx";
  const pageCount = isPowerPoint
    ? slides.length
    : isWord
      ? wordPages.length
      : 0;

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
    let active = true;
    let url: string | null = null;

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    setData(null);
    setHtml("");
    setWordPages([]);
    setSlides([]);
    setPageNumber(Math.max(1, initialPageNumber));
    setPageView("single");
    setZoom(1);
    zoomRef.current = 1;
    setZoomOpen(false);
    setIsFullscreen(false);
    setFallbackFullscreen(false);
    setCopying(false);
    setCopied(false);
    setCopyFailed(false);
    setError(false);
    setObjectUrl(null);
    setWordPageSize(DEFAULT_DOCX_PAGE_SIZE);
    zoomAnchorRef.current = null;

    void readFile(absolutePath).then(async (bytes) => {
      if (!active) return;
      setData(bytes);

      if (isVideo) {
        url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(absolutePath) }));
        if (active) setObjectUrl(url);
        return;
      }

      try {
        if (isWord) {
          const mammoth = await import("mammoth");
          const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (active) {
            setHtml(result.value);
            setWordPageSize(getDocxPageSize(bytes));
          }
        } else if (isPowerPoint) {
          const { renderPptxToSlideImages } = await import("@/lib/editor/pptxToImages");
          const rendered = await renderPptxToSlideImages(absolutePath, bytes);
          if (!rendered.length) {
            throw new Error("The PowerPoint file does not contain readable slides.");
          }

          if (active) {
            const decoder = new TextDecoder();
            setSlides(
              rendered.map((page) => ({
                svg: decoder.decode(page.data),
                text: page.text
              }))
            );
          }
        } else {
          throw new Error("Unsupported document format");
        }
      } catch {
        if (active) setError(true);
      }
    }).catch(() => {
      if (active) setError(true);
    });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, [absolutePath, ext, isVideo, isWord, isPowerPoint]);

  useEffect(() => {
    if (!isWord || !html || !wordMeasureRef.current) {
      setWordPages(isWord && html ? [html] : []);
      return;
    }

    const measureHost = wordMeasureRef.current;
    const source = measureHost.firstElementChild as HTMLElement | null;

    if (!source) {
      setWordPages([html]);
      return;
    }

    const pageWidthPx = mmToPixels(wordPageSize.widthMm);
    const pageHeightPx = mmToPixels(wordPageSize.heightMm);

    source.style.width = pageWidthPx + "px";
    source.style.height = pageHeightPx + "px";
    source.style.minHeight = pageHeightPx + "px";
    source.style.maxWidth = "none";
    source.style.boxSizing = "border-box";

    const children = Array.from(source.children);

    if (children.length === 0) {
      setWordPages([html]);
      return;
    }

    const pages: string[] = [];
    let page = document.createElement("div");
    page.className = "document-preview__word-sheet";
    page.style.width = pageWidthPx + "px";
    page.style.height = pageHeightPx + "px";
    page.style.minHeight = pageHeightPx + "px";
    page.style.boxSizing = "border-box";
    page.style.overflow = "hidden";
    measureHost.appendChild(page);

    for (const child of children) {
      const clone = child.cloneNode(true) as HTMLElement;
      page.appendChild(clone);

      if (page.scrollHeight > page.clientHeight && page.children.length > 1) {
        page.removeChild(clone);
        pages.push(page.innerHTML);

        page.remove();
        page = document.createElement("div");
        page.className = "document-preview__word-sheet";
        page.style.width = pageWidthPx + "px";
        page.style.height = pageHeightPx + "px";
        page.style.minHeight = pageHeightPx + "px";
        page.style.boxSizing = "border-box";
        page.style.overflow = "hidden";
        measureHost.appendChild(page);
        page.appendChild(clone);
      }
    }

    if (page.children.length > 0) {
      pages.push(page.innerHTML);
    }

    page.remove();

    setWordPages(pages.length > 0 ? pages : [html]);
  }, [
    html,
    isWord,
    wordPageSize.heightMm,
    wordPageSize.widthMm
  ]);

  useEffect(() => {
    return () => {
      if (zoomUiFrameRef.current !== null) {
        cancelAnimationFrame(zoomUiFrameRef.current);
      }
      zoomUiFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || pageView !== "single") return;

      event.preventDefault();
      event.stopPropagation();

      captureZoomAnchor(event.clientX, event.clientY);
      const factor = Math.exp(-event.deltaY / 240);
      setZoomValue(zoomRef.current * factor);
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [pageView]);

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
    if (mode !== "modal") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        document.fullscreenElement === rootRef.current
      ) {
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

      if (isFormControl(event.target)) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (
          event.target instanceof HTMLElement &&
          event.target.isContentEditable
        ) {
          return;
        }

        event.preventDefault();
        if (event.key === "ArrowLeft") previousPage();
        else nextPage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose, pageCount, fallbackFullscreen]);

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
    const page = pageRef.current;
    const stage = stageRef.current;

    if (
      !page ||
      !stage ||
      pageView !== "single" ||
      (!html && slides.length === 0)
    ) {
      return;
    }

    const naturalWidth = isWord
      ? mmToPixels(wordPageSize.widthMm)
      : 1600;
    const naturalHeight = isWord
      ? mmToPixels(wordPageSize.heightMm)
      : 900;

    stage.style.setProperty(
      "--pdf-page-aspect-ratio",
      naturalWidth + " / " + naturalHeight
    );

    const stageWidth = stage.clientWidth || window.innerWidth;
    const stageHeight = stage.clientHeight || window.innerHeight;
    const availableWidth = Math.max(240, stageWidth - 32);
    const availableHeight = Math.max(260, stageHeight - 32);
    const fitScale = Math.min(
      availableWidth / naturalWidth,
      availableHeight / naturalHeight
    );
    const requestedScale = Math.max(0.3, fitScale * zoomRef.current);

    page.style.width = Math.max(1, Math.round(naturalWidth * requestedScale)) + "px";
    page.style.height = Math.max(1, Math.round(naturalHeight * requestedScale)) + "px";
    page.style.setProperty("--pdf-css-zoom", String(fitScale));
    page.style.setProperty("--pdf-view-zoom", String(zoomRef.current));
  }, [
    html,
    isPowerPoint,
    isWord,
    pageNumber,
    pageView,
    slides.length,
    viewportVersion,
    wordPageSize.heightMm,
    wordPageSize.widthMm
  ]);

  useEffect(() => {
    if (!isPowerPoint) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (slides.length === 0 || isFormControl(event.target)) {
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        event.target.isContentEditable
      ) {
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
  }, [isPowerPoint, slides.length, pageCount]);

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

  const applyVisualZoom = (
    next: number,
    previousZoom = zoomRef.current
  ) => {
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

    page.style.width =
      Math.max(1, Math.round(currentWidth * scale)) + "px";
    page.style.height =
      Math.max(1, Math.round(currentHeight * scale)) + "px";
    page.style.setProperty("--pdf-view-zoom", "1");

    const pageLeft = page.offsetLeft;
    const pageTop = page.offsetTop;
    const pageX = pageLeft + page.offsetWidth * (anchor?.pageX ?? 0.5);
    const pageY = pageTop + page.offsetHeight * (anchor?.pageY ?? 0.5);

    stage.scrollLeft = Math.max(0, pageX - pointerX);
    stage.scrollTop = Math.max(0, pageY - pointerY);
  };

  const publishZoomUi = (value: number) => {
    pendingZoomUiRef.current = value;

    if (zoomUiFrameRef.current !== null) {
      return;
    }

    zoomUiFrameRef.current = requestAnimationFrame(() => {
      zoomUiFrameRef.current = null;
      setZoom(pendingZoomUiRef.current);
    });
  };

  const setZoomValue = (value: number) => {
    const next = Math.round(clampZoom(value) * 100) / 100;
    const previousZoom = zoomRef.current;

    if (next === 1) {
      resetZoom();
      return;
    }

    zoomRef.current = next;
    setZoomOpen(true);
    applyVisualZoom(next, previousZoom);
    publishZoomUi(next);
  };

  const resetZoom = () => {
    zoomAnchorRef.current = null;
    const previousZoom = zoomRef.current;
    zoomRef.current = 1;
    setZoomOpen(false);
    applyVisualZoom(1, previousZoom);
    publishZoomUi(1);

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
        // Fall back to an app-level fullscreen mode if the host blocks it.
      }
    }

    setFallbackFullscreen(true);
    setIsFullscreen(true);
  };

  const copyCurrentPage = async () => {
    let text = "";

    if (isPowerPoint) {
      text = slides[pageNumber - 1]?.text ?? "";
    } else if (isWord) {
      const container = document.createElement("div");
      container.innerHTML = wordPages[pageNumber - 1] ?? "";
      text = container.innerText.trim();
    }

    if (!text || copying) return;

    try {
      setCopying(true);
      const didCopy = await copyText(text);
      if (!didCopy) return;
      setCopied(true);

      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }

      feedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        feedbackTimerRef.current = null;
      }, 1400);
    } finally {
      setCopying(false);
    }
  };

  const commitPageInput = () => {
    const requested = Number.parseInt(pageInput, 10);

    if (!Number.isFinite(requested) || pageCount === 0) {
      setPageInput(String(pageNumber));
      return;
    }

    setPageNumber(Math.max(1, Math.min(pageCount, requested)));
  };

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode === "modal" || isFormControl(event.target)) {
      return;
    }

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
    if (!stage || !stage.contains(event.target as Node) || pageView !== "single") {
      return;
    }

    const startedOnText =
      event.target instanceof Element &&
      Boolean(event.target.closest(
        "p, span, li, td, th, h1, h2, h3, h4, h5, h6, a, text"
      ));

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
      rootRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (event.pointerType !== "touch") return;

    const pointers = touchPointersRef.current;
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

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
      (panRef.current.pointerType === "touch" ||
        panRef.current.pointerType === "mouse")
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
      pinchRef.current.zoom *
        (distance / pinchRef.current.distance)
    );
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      if (panRef.current?.pointerId === event.pointerId) {
        if (rootRef.current?.hasPointerCapture(event.pointerId)) {
          rootRef.current.releasePointerCapture(event.pointerId);
        }
        panRef.current = null;
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
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }
      panRef.current = null;
      return;
    }

    touchPointersRef.current.delete(event.pointerId);
    swipeRef.current = null;
    pinchRef.current = null;
    panRef.current = null;
  };

  const kind = useMemo(
    () => (isVideo ? "video" : isPowerPoint ? "powerpoint" : "word"),
    [isVideo, isPowerPoint]
  );

  const pageStyle = {
    "--word-page-width": wordPageSize.widthMm + "mm",
    "--word-page-height": wordPageSize.heightMm + "mm"
  } as React.CSSProperties;

  const overviewPages = useMemo(() => {
    if (isPowerPoint) {
      return slides.map((slideData, index) => (
        <button
          type="button"
          className="pdf-preview__overview-page"
          key={index}
          onClick={() => {
            setPageNumber(index + 1);
            setPageView("single");
          }}
          aria-label={"Slide " + (index + 1)}
        >
          <div className="pdf-preview__overview-page-frame pdf-preview__overview-page-frame--slide">
            <OfficeVisual
              svg={slideData.svg}
              className="document-preview__slide-svg document-preview__slide-svg--thumbnail"
            />
          </div>
          <span>{index + 1} / {slides.length}</span>
        </button>
      ));
    }

    if (isWord) {
      return wordPages.map((pageHtml, index) => (
        <button
          type="button"
          className="pdf-preview__overview-page"
          key={index}
          onClick={() => {
            setPageNumber(index + 1);
            setPageView("single");
          }}
          aria-label={"Page " + (index + 1)}
        >
          <WordOverviewPage
            html={pageHtml}
            widthPx={mmToPixels(wordPageSize.widthMm)}
            heightPx={mmToPixels(wordPageSize.heightMm)}
          />
          <span>{index + 1} / {wordPages.length}</span>
        </button>
      ));
    }

    return [];
  }, [isPowerPoint, isWord, slides, wordPages]);

  const copyLabel = copyFailed
    ? "Copy failed"
    : copied
      ? t("pdfViewer.copied")
      : t("pdfViewer.copyPage");

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className={
        "pdf-preview pdf-preview--" +
        mode +
        (pageView === "grid" ? " pdf-preview--grid" : "") +
        (fallbackFullscreen ? " pdf-preview--fallback-fullscreen" : "") +
        " document-preview document-preview--" +
        kind
      }
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
            disabled={pageCount === 0 || pageNumber <= 1 || isWord}
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
              disabled={pageCount === 0}
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
            <span>{pageCount > 0 ? "/ " + pageCount : "…"}</span>
          </label>

          <button
            type="button"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            aria-label={t("pdfViewer.next")}
            title={t("pdfViewer.next")}
            onClick={nextPage}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>

        <div className="pdf-preview__actions">
          {!isVideo ? (
            <button
              type="button"
              disabled={copying || (!html && !slides[pageNumber - 1]?.text)}
              aria-label={copyLabel}
              title={copyLabel}
              onClick={() => void copyCurrentPage()}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </button>
          ) : null}

          {!isVideo ? (
            <button
              type="button"
              aria-pressed={isFullscreen}
              aria-label={
                isFullscreen ? "Exit fullscreen" : "Fullscreen"
              }
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Maximize2 aria-hidden="true" />
              )}
            </button>
          ) : null}

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
                <label htmlFor="document-preview-zoom">
                  <span>{t("pdfViewer.zoom")}</span>
                  <output>{Math.round(zoom * 100)}%</output>
                </label>
                <input
                  id="document-preview-zoom"
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

          <div
            className="pdf-preview__view-switch"
            role="group"
            aria-label="Page view"
          >
            <button
              type="button"
              className={
                pageView === "single"
                  ? "pdf-preview__view-button pdf-preview__view-button--active"
                  : "pdf-preview__view-button"
              }
              aria-pressed={pageView === "single"}
              aria-label="Single page"
              title="Single page"
              onClick={() => {
                resetZoom();
                setPageView("single");
              }}
            >
              <Square aria-hidden="true" />
            </button>

            <button
              type="button"
              className={
                pageView === "grid"
                  ? "pdf-preview__view-button pdf-preview__view-button--active"
                  : "pdf-preview__view-button"
              }
              aria-pressed={pageView === "grid"}
              aria-label="All pages"
              title="All pages"
              onClick={() => {
                resetZoom();
                setPageView("grid");
              }}
            >
              <Grid2X2 aria-hidden="true" />
            </button>
          </div>

          {onOpenInSplit ? (
            <button
              type="button"
              aria-label={t("pdfViewer.openInSplit")}
              title={t("pdfViewer.openInSplit")}
              onClick={() => onOpenInSplit(pageNumber)}
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

      {isWord && html ? (
        <div
          ref={wordMeasureRef}
          className="document-preview__word-measurer"
          aria-hidden="true"
        >
          <article
            className="document-preview__word-sheet"
            style={pageStyle}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : null}

      <div
          ref={stageRef}
          className={
            "pdf-preview__stage" +
            (zoom > 1 && pageView === "single"
              ? " pdf-preview__stage--zoomed"
              : "") +
            (pageView === "grid" ? " pdf-preview__stage--grid" : "")
          }
        >
          {!data && !error ? (
            <div className="pdf-preview__message">
              <Loader2 className="pdf-preview__spinner" aria-hidden="true" />
              Loading…
            </div>
          ) : null}

          {error ? (
            <div className="pdf-preview__message" role="alert">
              <FileText />
              Unable to preview this file.
            </div>
          ) : null}

          {isVideo && objectUrl ? (
            <video
              className="document-preview__video"
              src={objectUrl}
              controls
              playsInline
              preload="metadata"
            />
          ) : null}

          {isWord && wordPages.length > 0 && pageView === "single" ? (
            <div
              ref={pageRef}
              className="pdf-preview__page document-preview__office-page"
              style={pageStyle}
            >
              <OfficeVisual
                html={wordPages[pageNumber - 1] ?? ""}
                className="document-preview__word-sheet"
              />
            </div>
          ) : null}

          {isPowerPoint && pageView === "single" && slides.length > 0 ? (
            <section
              ref={pageRef}
              className={
                "pdf-preview__page document-preview__slide" +
                (zoom > 1 ? " pdf-preview__page--zoomed" : "")
              }
              aria-label={"Slide " + pageNumber}
            >
              <OfficeVisual
                svg={slides[pageNumber - 1].svg}
                className="document-preview__slide-svg"
              />
            </section>
          ) : null}

          {pageView === "grid" ? (
            <div className="pdf-preview__overview">
              {overviewPages}
            </div>
          ) : null}
        </div>
    </div>
  );
}
