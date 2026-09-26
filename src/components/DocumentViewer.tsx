import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Grid2X2, Loader2, Play, Square, X } from "lucide-react";
import { readFile } from "@/platform/vaultFs";

type Props = { absolutePath: string; label: string; onClose?: () => void };
type Slide = { src: string };

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
  const [data, setData] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState("");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pptView, setPptView] = useState<"single" | "all">("single");
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const isVideo = ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext);
  const isWord = ext === "docx";
  const isPowerPoint = ext === "pptx";

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    let pptBlobUrls: string[] = [];
    setError(false);
    setHtml("");
    setSlides([]);
    setSlide(0);
    setPptView("single");
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
          const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (active) setHtml(result.value);
        } else if (isPowerPoint) {
          const { renderPptxToSlideImages } = await import("@/lib/editor/pptxToImages");
          const rendered = await renderPptxToSlideImages(absolutePath, bytes);
          pptBlobUrls = rendered.map((page) =>
            URL.createObjectURL(new Blob([page.data], { type: page.mimeType }))
          );
          if (rendered.length === 0) {
            throw new Error("The PowerPoint file does not contain readable slides.");
          }
          if (active) setSlides(pptBlobUrls.map((src) => ({ src })));
        } else {
          throw new Error("Unsupported document format");
        }
      } catch {
        if (active) setError(true);
      }
    }).catch(() => active && setError(true));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      for (const blobUrl of pptBlobUrls) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [absolutePath, ext, isVideo, isWord, isPowerPoint]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    if (!isPowerPoint) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (slides.length === 0) return;
      if (event.key === "ArrowLeft") setSlide((n) => Math.max(0, n - 1));
      if (event.key === "ArrowRight") setSlide((n) => Math.min(slides.length - 1, n + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPowerPoint, slides.length]);

  const handleSlidePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!isPowerPoint || event.pointerType === "mouse") return;
    touchStartRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  const handleSlidePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !isPowerPoint) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (performance.now() - start.time > 700 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0) setSlide((n) => Math.min(slides.length - 1, n + 1));
    else setSlide((n) => Math.max(0, n - 1));
  };

  const kind = useMemo(() => isVideo ? "video" : isPowerPoint ? "powerpoint" : "word", [isVideo, isPowerPoint]);

  return (
    <div className={`document-preview document-preview--${kind}`}>
      <div className="document-preview__toolbar">
        <strong>{label}</strong>
        <div className="document-preview__actions">
          {isPowerPoint && slides.length > 0 ? (
            <>
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
            </>
          ) : null}
          {isPowerPoint && pptView === "single" && slides.length > 0 ? <span>{slide + 1} / {slides.length}</span> : null}
          {isPowerPoint && pptView === "single" && slides.length > 1 ? <button type="button" disabled={slide === 0} onClick={() => setSlide((n) => Math.max(0, n - 1))} aria-label="Previous slide"><ChevronLeft /></button> : null}
          {isPowerPoint && pptView === "single" && slides.length > 1 ? <button type="button" disabled={slide === slides.length - 1} onClick={() => setSlide((n) => Math.min(slides.length - 1, n + 1))} aria-label="Next slide"><ChevronRight /></button> : null}
          {onClose ? <button type="button" onClick={onClose} aria-label="Close"><X /></button> : null}
        </div>
      </div>
      <div className="document-preview__stage">
        {!data && !error ? <div className="document-preview__message"><Loader2 className="pdf-preview__spinner" /> Loading…</div> : null}
        {error ? <div className="document-preview__message"><FileText /> Unable to preview this file.</div> : null}
        {isVideo && objectUrl ? <video className="document-preview__video" src={objectUrl} controls playsInline preload="metadata" /> : null}
        {isWord && html && <article className="document-preview__word" dangerouslySetInnerHTML={{ __html: html }} />}
        {isPowerPoint && slides.length > 0 && pptView === "single" ? (
          <section className="document-preview__slide" aria-label={`Slide ${slide + 1}`} onPointerDown={handleSlidePointerDown} onPointerUp={handleSlidePointerUp}>
            <img src={slides[slide].src} alt="" />
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
                <img src={currentSlide.src} alt="" />
              </section>
            ))}
          </div>
        ) : null}
        {isVideo && !objectUrl && data && <div className="document-preview__message"><Play /> Preparing video…</div>}
      </div>
    </div>
  );
}
