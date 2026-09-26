import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Grid2X2,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Square,
  X
} from "lucide-react";
import { readFile } from "@/platform/vaultFs";
import { copyText } from "@/lib/clipboard";
import {
  DEFAULT_DOCX_PAGE_SIZE,
  getDocxPageSize,
  type DocxPageSize
} from "@/lib/editor/docxPageSize";

type Props = { absolutePath: string; label: string; onClose?: () => void };
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

export function DocumentViewer({ absolutePath, label, onClose }: Props) {
  const ext = extension(absolutePath);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState("");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pptView, setPptView] = useState<"single" | "all">("single");
  const [officeCopying, setOfficeCopying] = useState(false);
  const [officeCopied, setOfficeCopied] = useState(false);
  const [officeCopyError, setOfficeCopyError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wordPageSize, setWordPageSize] = useState<DocxPageSize>(DEFAULT_DOCX_PAGE_SIZE);

  const isVideo = ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext);
  const isWord = ext === "docx";
  const isPowerPoint = ext === "pptx";

  const clearCopyFeedbackTimer = () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  };

  useEffect(() => {
    let active = true;
    let url: string | null = null;

    clearCopyFeedbackTimer();
    setData(null);
    setHtml("");
    setSlides([]);
    setSlide(0);
    setPptView("single");
    setError(false);
    setObjectUrl(null);
    setOfficeCopying(false);
    setOfficeCopied(false);
    setOfficeCopyError(false);
    setIsFullscreen(false);
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
          if (rendered.length === 0) {
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
      clearCopyFeedbackTimer();
    };
  }, [absolutePath, ext, isVideo, isWord, isPowerPoint]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
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
    if (!isPowerPoint) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (slides.length === 0) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSlide((n) => Math.max(0, n - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSlide((n) => Math.min(slides.length - 1, n + 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPowerPoint, slides.length]);

  const handleSlidePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!isPowerPoint || event.pointerType === "mouse") return;
    touchStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now()
    };
  };

  const handleSlidePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !isPowerPoint) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (
      performance.now() - start.time > 700 ||
      Math.abs(dx) < 48 ||
      Math.abs(dx) < Math.abs(dy) * 1.25
    ) {
      return;
    }

    if (dx < 0) {
      setSlide((n) => Math.min(slides.length - 1, n + 1));
    } else {
      setSlide((n) => Math.max(0, n - 1));
    }
  };

  const copyOfficeText = async () => {
    let text = "";

    if (isPowerPoint) {
      text = slides[slide]?.text ?? "";
    } else if (isWord) {
      const container = document.createElement("div");
      container.innerHTML = html;
      text = container.innerText.trim();
    }

    if (!text || officeCopying) return;

    clearCopyFeedbackTimer();
    setOfficeCopying(true);
    setOfficeCopied(false);
    setOfficeCopyError(false);

    try {
      const didCopy = await copyText(text);
      if (didCopy) {
        setOfficeCopied(true);
      } else {
        setOfficeCopyError(true);
      }

      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setOfficeCopied(false);
        setOfficeCopyError(false);
        copyFeedbackTimerRef.current = null;
      }, 1400);
    } finally {
      setOfficeCopying(false);
    }
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;

    if (document.fullscreenElement === root) {
      await document.exitFullscreen?.();
      return;
    }

    if (root.requestFullscreen) {
      try {
        await root.requestFullscreen();
      } catch {
        // Keep the normal modal if the host rejects fullscreen.
      }
    }
  };

  const kind = useMemo(
    () => (isVideo ? "video" : isPowerPoint ? "powerpoint" : "word"),
    [isVideo, isPowerPoint]
  );

  const pageStyle = {
    "--word-page-width": `${wordPageSize.widthMm}mm`,
    "--word-page-height": `${wordPageSize.heightMm}mm`
  } as React.CSSProperties;

  const copyLabel = officeCopyError
    ? "Copy failed"
    : officeCopied
      ? "Text copied"
      : isPowerPoint
        ? "Copy slide text"
        : "Copy document text";

  return (
    <div ref={rootRef} className={`document-preview document-preview--${kind}`}>
      <div className="document-preview__toolbar">
        <strong>{label}</strong>

        {isPowerPoint ? (
          <div className="document-preview__pager" aria-label="Slide navigation">
            <button
              type="button"
              className={pptView === "single" ? "document-preview__view-button document-preview__view-button--active" : "document-preview__view-button"}
              aria-pressed={pptView === "single"}
              aria-label="Show one slide"
              title="One slide"
              onClick={() => setPptView("single")}
            >
              <Square aria-hidden="true" />
            </button>
            <button
              type="button"
              className={pptView === "all" ? "document-preview__view-button document-preview__view-button--active" : "document-preview__view-button"}
              aria-pressed={pptView === "all"}
              aria-label="Show all slides"
              title="All slides"
              onClick={() => setPptView("all")}
            >
              <Grid2X2 aria-hidden="true" />
            </button>
            {pptView === "single" ? (
              <>
                <button
                  type="button"
                  disabled={slide === 0 || slides.length === 0}
                  aria-label="Previous slide"
                  title="Previous slide"
                  onClick={() => setSlide((n) => Math.max(0, n - 1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <span>{slides.length > 0 ? `${slide + 1} / ${slides.length}` : "…"}</span>
                <button
                  type="button"
                  disabled={slide >= slides.length - 1 || slides.length === 0}
                  aria-label="Next slide"
                  title="Next slide"
                  onClick={() => setSlide((n) => Math.min(slides.length - 1, n + 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="document-preview__actions">
          {!isVideo && (isPowerPoint ? slides[slide]?.text : html) ? (
            <button
              type="button"
              disabled={officeCopying}
              onClick={() => void copyOfficeText()}
              aria-label={copyLabel}
              title={copyLabel}
            >
              {officeCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </button>
          ) : null}

          {!isVideo ? (
            <button
              type="button"
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          ) : null}

          {onClose ? (
            <button type="button" onClick={onClose} aria-label="Close" title="Close">
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={`document-preview__stage document-preview__stage--${kind}`}>
        {!data && !error ? (
          <div className="document-preview__message">
            <Loader2 className="pdf-preview__spinner" /> Loading…
          </div>
        ) : null}
        {error ? (
          <div className="document-preview__message">
            <FileText /> Unable to preview this file.
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

        {isWord && html ? (
          <article
            className="document-preview__word-sheet"
            style={pageStyle}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}

        {isPowerPoint && slides.length > 0 && pptView === "single" ? (
          <section
            className="document-preview__slide"
            aria-label={`Slide ${slide + 1}`}
            onPointerDown={handleSlidePointerDown}
            onPointerUp={handleSlidePointerUp}
          >
            <div
              className="document-preview__slide-svg"
              dangerouslySetInnerHTML={{ __html: slides[slide].svg }}
            />
          </section>
        ) : null}

        {isPowerPoint && slides.length > 0 && pptView === "all" ? (
          <div className="document-preview__slides-all">
            {slides.map((currentSlide, index) => (
              <section
                key={index}
                className="document-preview__slide document-preview__slide--thumbnail"
                aria-label={`Slide ${index + 1}`}
                onClick={() => {
                  setSlide(index);
                  setPptView("single");
                }}
              >
                <div
                  className="document-preview__slide-svg"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: currentSlide.svg }}
                />
              </section>
            ))}
          </div>
        ) : null}

        {isVideo && !objectUrl && data ? (
          <div className="document-preview__message">
            <Play /> Preparing video…
          </div>
        ) : null}
      </div>
    </div>
  );
}
