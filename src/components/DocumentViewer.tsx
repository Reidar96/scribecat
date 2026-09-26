import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight, Columns2, Copy, FileText, Grid2X2,
  Loader2, Maximize2, Minimize2, Square, X, ZoomIn
} from "lucide-react";
import { readFile } from "@/platform/vaultFs";
import { copyText } from "@/lib/clipboard";
import {
  DEFAULT_DOCX_PAGE_SIZE,
  getDocxPageSize,
  type DocxPageSize
} from "@/lib/editor/docxPageSize";

type Props = {
  absolutePath: string;
  label: string;
  onClose?: () => void;
  onOpenInSplit?: () => void;
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

export function DocumentViewer({
  absolutePath,
  label,
  onClose,
  onOpenInSplit,
  mode = "modal"
}: Props) {
  const ext = extension(absolutePath);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const [data, setData] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState("");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageView, setPageView] = useState<"single" | "grid">("single");
  const [zoom, setZoom] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [wordPageSize, setWordPageSize] = useState<DocxPageSize>(DEFAULT_DOCX_PAGE_SIZE);

  const isVideo = ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext);
  const isWord = ext === "docx";
  const isPowerPoint = ext === "pptx";
  const pageCount = isPowerPoint ? slides.length : isWord ? 1 : 0;

  useEffect(() => {
    let active = true;
    let url: string | null = null;

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    setData(null);
    setHtml("");
    setSlides([]);
    setPageNumber(1);
    setPageView("single");
    setZoom(1);
    setZoomOpen(false);
    setIsFullscreen(false);
    setIsMinimized(false);
    setCopying(false);
    setCopied(false);
    setCopyFailed(false);
    setError(false);
    setObjectUrl(null);
    setWordPageSize(DEFAULT_DOCX_PAGE_SIZE);

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
          if (!rendered.length) throw new Error("No readable slides");
          if (active) {
            const decoder = new TextDecoder();
            setSlides(rendered.map((page) => ({ svg: decoder.decode(page.data), text: page.text })));
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
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (document.fullscreenElement === rootRef.current) void document.exitFullscreen?.();
    };
  }, []);

  useEffect(() => {
    if (!isPowerPoint) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (slides.length === 0) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPageNumber((n) => Math.max(1, n - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPageNumber((n) => Math.min(slides.length, n + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPowerPoint, slides.length]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!isPowerPoint || event.pointerType === "mouse") return;
    touchStartRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !isPowerPoint) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (performance.now() - start.time > 700 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    setPageNumber((n) => dx < 0 ? Math.min(pageCount, n + 1) : Math.max(1, n - 1));
  };

  const copyDocumentText = async () => {
    let text = "";
    if (isPowerPoint) text = slides[pageNumber - 1]?.text ?? "";
    else if (isWord) {
      const container = document.createElement("div");
      container.innerHTML = html;
      text = container.innerText.trim();
    }
    if (!text || copying) return;

    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setCopying(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      const ok = await copyText(text);
      setCopied(ok);
      setCopyFailed(!ok);
      feedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        setCopyFailed(false);
        feedbackTimerRef.current = null;
      }, 1400);
    } finally {
      setCopying(false);
    }
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      await document.exitFullscreen?.();
      return;
    }
    try {
      await root.requestFullscreen?.();
    } catch {
      // Keep ordinary preview when the host rejects fullscreen.
    }
  };

  const pageStyle = {
    "--word-page-width": `${wordPageSize.widthMm}mm`,
    "--word-page-height": `${wordPageSize.heightMm}mm`,
    "--office-preview-zoom": String(zoom)
  } as React.CSSProperties;

  const copyLabel = copyFailed ? "Copy failed" : copied ? "Text copied" : "Copy text";
  const previousPage = () => setPageNumber((n) => Math.max(1, n - 1));
  const nextPage = () => setPageNumber((n) => Math.min(pageCount || 1, n + 1));
  const changeZoom = (value: number) => setZoom(Math.max(0.5, Math.min(3, value)));

  return (
    <div
      ref={rootRef}
      className={"pdf-preview pdf-preview--" + mode + " document-preview document-preview--" + (isPowerPoint ? "powerpoint" : "word") + (isMinimized ? " pdf-preview--minimized" : "")}
      tabIndex={0}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pdf-preview__toolbar">
        <strong className="pdf-preview__name" title={label}>{label}</strong>

        <div className="pdf-preview__pager">
          <button type="button" disabled={pageCount === 0 || pageNumber <= 1 || isWord} aria-label="Previous page" title="Previous page" onClick={previousPage}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <label className="pdf-preview__page-input">
            <span className="sr-only">Page</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              value={pageNumber}
              disabled={pageCount === 0 || isWord}
              onChange={(event) => setPageNumber(Math.max(1, Math.min(pageCount || 1, Number(event.target.value) || 1)))}
            />
            <span>{pageCount > 0 ? "/ " + pageCount : "…"}</span>
          </label>
          <button type="button" disabled={pageCount === 0 || pageNumber >= pageCount} aria-label="Next page" title="Next page" onClick={nextPage}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>

        <div className="pdf-preview__actions">
          {!isVideo ? (
            <button type="button" disabled={copying || (!html && !slides[pageNumber - 1]?.text)} aria-label={copyLabel} title={copyLabel} onClick={() => void copyDocumentText()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </button>
          ) : null}

          {!isVideo ? (
            <button type="button" aria-pressed={isFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          ) : null}

          {mode !== "modal" ? (
            <button type="button" aria-pressed={isMinimized} aria-label={isMinimized ? "Expand document" : "Minimize document"} title={isMinimized ? "Expand document" : "Minimize document"} onClick={() => setIsMinimized((value) => !value)}>
              {isMinimized ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
            </button>
          ) : null}

          <div className="pdf-preview__zoom">
            <button type="button" aria-expanded={zoomOpen} aria-label="Zoom" title="Zoom" onClick={() => setZoomOpen((open) => !open)}>
              <ZoomIn aria-hidden="true" />
            </button>
            {zoomOpen ? (
              <div className="pdf-preview__zoom-panel">
                <label htmlFor="office-preview-zoom"><span>Zoom</span><output>{Math.round(zoom * 100)}%</output></label>
                <input id="office-preview-zoom" type="range" min="0.5" max="3" step="0.05" value={zoom} aria-label="Zoom" onChange={(event) => changeZoom(Number(event.target.value))} />
              </div>
            ) : null}
          </div>

          <div className="pdf-preview__view-switch" role="group" aria-label="Page view">
            <button type="button" className={pageView === "single" ? "pdf-preview__view-button pdf-preview__view-button--active" : "pdf-preview__view-button"} aria-pressed={pageView === "single"} aria-label="Single page" title="Single page" onClick={() => setPageView("single")}>
              <Square aria-hidden="true" />
            </button>
            <button type="button" className={pageView === "grid" ? "pdf-preview__view-button pdf-preview__view-button--active" : "pdf-preview__view-button"} aria-pressed={pageView === "grid"} aria-label="All pages" title="All pages" onClick={() => setPageView("grid")}>
              <Grid2X2 aria-hidden="true" />
            </button>
          </div>

          {onOpenInSplit ? (
            <button type="button" aria-label="Open in split" title="Open in split" onClick={() => onOpenInSplit()}>
              <Columns2 aria-hidden="true" />
            </button>
          ) : null}

          {onClose ? (
            <button type="button" className="pdf-preview__close" aria-label="Close" title="Close" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {!isMinimized ? (
        <div className="pdf-preview__stage">
          {!data && !error ? <div className="pdf-preview__message"><Loader2 className="pdf-preview__spinner" /> Loading…</div> : null}
          {error ? <div className="pdf-preview__message" role="alert"><FileText /> Unable to preview this file.</div> : null}

          {isVideo && objectUrl ? <video className="document-preview__video" src={objectUrl} controls playsInline preload="metadata" /> : null}

          {isWord && html ? (
            <article className="document-preview__word-sheet" style={pageStyle} dangerouslySetInnerHTML={{ __html: html }} />
          ) : null}

          {isPowerPoint && pageView === "single" && slides.length > 0 ? (
            <section className="document-preview__slide" aria-label={"Slide " + pageNumber} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} style={pageStyle}>
              <div className="document-preview__slide-svg" dangerouslySetInnerHTML={{ __html: slides[pageNumber - 1].svg }} />
            </section>
          ) : null}

          {isPowerPoint && pageView === "grid" && slides.length > 0 ? (
            <div className="document-preview__slides-all">
              {slides.map((slideData, index) => (
                <section key={index} className="document-preview__slide document-preview__slide--thumbnail" aria-label={"Slide " + (index + 1)} onClick={() => { setPageNumber(index + 1); setPageView("single"); }}>
                  <div className="document-preview__slide-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: slideData.svg }} />
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}