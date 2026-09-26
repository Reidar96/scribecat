import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, Play, X } from "lucide-react";
import { unzipSync } from "fflate";
import { readFile } from "@/platform/vaultFs";

type Props = { absolutePath: string; label: string; onClose?: () => void };

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

function decodeXml(value: string): string {
  const el = new DOMParser().parseFromString(value, "application/xml").documentElement;
  return (el?.textContent ?? value).replace(/\s+/g, " ").trim();
}

function xmlText(xml: string, tag: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName(tag)).map((n) => (n.textContent ?? "").trim()).filter(Boolean);
}

function resolveTarget(base: string, target: string): string {
  const parts = (base + "/" + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

type Slide = { title?: string; texts: string[]; images: string[] };

async function parsePptx(data: Uint8Array): Promise<{ slides: Slide[]; blobs: Record<string, string> }> {
  const zip = unzipSync(data);
  const decoder = new TextDecoder();
  const slideNames = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  const blobs: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(zip)) {
    if (/^ppt\/media\//.test(name)) {
      const ext = extension(name);
      const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/*";
      blobs[name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    }
  }
  const slides: Slide[] = [];
  for (const slideName of slideNames) {
    const xml = decoder.decode(zip[slideName]);
    const texts = xmlText(xml, "a:t").map(decodeXml);
    const relPath = slideName.replace(/slide\d+\.xml$/, "_rels/") + slideName.split("/").pop() + ".rels";
    const relXml = zip[relPath] ? decoder.decode(zip[relPath]) : "";
    const images: string[] = [];
    for (const match of relXml.matchAll(/Target="([^"]+)"/g)) {
      const target = match[1];
      const resolved = resolveTarget("ppt/slides", target);
      if (blobs[resolved]) images.push(blobs[resolved]);
    }
    slides.push({ title: texts[0], texts, images });
  }
  return { slides, blobs };
}

export function DocumentViewer({ absolutePath, label, onClose }: Props) {
  const ext = extension(absolutePath);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState("");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const isVideo = ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext);
  const isWord = ext === "docx";
  const isPowerPoint = ext === "pptx";

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setError(false);
    setHtml("");
    setSlides([]);
    setSlide(0);
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
          const parsed = await parsePptx(bytes);
          if (active) setSlides(parsed.slides);
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
    };
  }, [absolutePath, ext, isVideo, isWord, isPowerPoint]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const kind = useMemo(() => isVideo ? "video" : isPowerPoint ? "powerpoint" : "word", [isVideo, isPowerPoint]);

  return (
    <div className={`document-preview document-preview--${kind}`}>
      <div className="document-preview__toolbar">
        <strong>{label}</strong>
        <div className="document-preview__actions">
          {slides.length > 0 ? <span>{slide + 1} / {slides.length}</span> : null}
          {slides.length > 1 ? <button type="button" disabled={slide === 0} onClick={() => setSlide((n) => Math.max(0, n - 1))} aria-label="Previous slide"><ChevronLeft /></button> : null}
          {slides.length > 1 ? <button type="button" disabled={slide === slides.length - 1} onClick={() => setSlide((n) => Math.min(slides.length - 1, n + 1))} aria-label="Next slide"><ChevronRight /></button> : null}
          {onClose ? <button type="button" onClick={onClose} aria-label="Close"><X /></button> : null}
        </div>
      </div>
      <div className="document-preview__stage">
        {!data && !error ? <div className="document-preview__message"><Loader2 className="pdf-preview__spinner" /> Loading…</div> : null}
        {error ? <div className="document-preview__message"><FileText /> Unable to preview this file.</div> : null}
        {isVideo && objectUrl ? <video className="document-preview__video" src={objectUrl} controls playsInline preload="metadata" /> : null}
        {isWord && html && <article className="document-preview__word" dangerouslySetInnerHTML={{ __html: html }} />}
        {isPowerPoint && slides.length > 0 ? (
          <section className="document-preview__slide" aria-label={`Slide ${slide + 1}`}>
            {slides[slide].images.map((src, index) => <img key={index} src={src} alt="" />)}
            <div className="document-preview__slide-text">
              {slides[slide].texts.map((text, index) => <p key={index}>{text}</p>)}
            </div>
          </section>
        ) : null}
        {isVideo && !objectUrl && data && <div className="document-preview__message"><Play /> Preparing video…</div>}
      </div>
    </div>
  );
}
