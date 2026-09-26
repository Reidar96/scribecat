import { unzipSync } from "fflate";

type PptxSlide = {
  texts: string[];
  images: Array<{ mimeType: string; data: Uint8Array }>;
};

function extension(path: string): string {
  return path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
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

function xmlText(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("a:t"))
    .map((node) => (node.textContent ?? "").trim())
    .filter(Boolean);
}

function mimeForExtension(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "bmp") return "image/bmp";
  return "application/octet-stream";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\x27/g, "&apos;");
}

function toDataUrl(mimeType: string, data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return "data:" + mimeType + ";base64," + btoa(binary);
}

async function parseSlides(data: Uint8Array): Promise<PptxSlide[]> {
  const zip = unzipSync(data);
  const decoder = new TextDecoder();
  const slideNames = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  const slides: PptxSlide[] = [];

  for (const slideName of slideNames) {
    const xml = decoder.decode(zip[slideName]);
    const slideFileName = slideName.split("/").pop() ?? "";
    const relPath = "ppt/slides/_rels/" + slideFileName + ".rels";
    const relXml = zip[relPath] ? decoder.decode(zip[relPath]) : "";
    const images: PptxSlide["images"] = [];

    for (const match of relXml.matchAll(/Target="([^"]+)"/g)) {
      const resolved = resolveTarget("ppt/slides", match[1]);
      const bytes = zip[resolved];
      const mimeType = mimeForExtension(extension(resolved));
      if (bytes && resolved.startsWith("ppt/media/") && mimeType !== "application/octet-stream") {
        images.push({ mimeType, data: bytes });
      }
    }

    slides.push({ texts: xmlText(xml), images });
  }

  return slides;
}

function slideSvg(slide: PptxSlide, index: number, total: number): string {
  const images = slide.images.slice(0, 4);
  const columns = images.length > 1 ? 2 : 1;
  const imageWidth = columns === 1 ? 1180 : 700;
  const imageHeight = images.length > 0 ? (columns === 1 ? 500 : 360) : 0;
  const imageSvg = images.map((image, imageIndex) => {
    const col = imageIndex % columns;
    const row = Math.floor(imageIndex / columns);
    const x = columns === 1 ? 210 : col === 0 ? 80 : 820;
    const y = 50 + row * 390;
    return '<image href="' + toDataUrl(image.mimeType, image.data) + '" x="' + x + '" y="' + y + '" width="' + imageWidth + '" height="' + (imageHeight || 450) + '" preserveAspectRatio="xMidYMid meet"/>';
  }).join("");
  const textStart = images.length > 0 ? 610 : 150;
  const textSvg = slide.texts.slice(0, 14).map((value, textIndex) => {
    const size = textIndex === 0 ? 34 : 24;
    const y = textStart + textIndex * 38;
    return '<text x="800" y="' + y + '" text-anchor="middle" font-family="Arial, sans-serif" font-size="' + size + '" fill="#111">' + escapeXml(value) + "</text>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">' +
    '<rect width="1600" height="900" fill="#fff"/>' +
    imageSvg + textSvg +
    '<text x="1540" y="860" text-anchor="end" font-family="Arial, sans-serif" font-size="18" fill="#777">' + (index + 1) + " / " + total + "</text></svg>";
}

export async function renderPptxToSlideImages(
  fileName: string,
  data: Uint8Array
): Promise<Array<{
  fileName: string;
  mimeType: "image/svg+xml";
  data: Uint8Array;
  altText: string;
  text: string;
}>> {
  const slides = await parseSlides(data);
  if (slides.length === 0) {
    throw new Error("The PowerPoint file does not contain readable slides.");
  }
  const baseName = (fileName.replace(/\\/g, "/").split("/").pop() ?? "PowerPoint")
    .replace(/\.pptx$/i, "") || "PowerPoint";
  const digits = String(slides.length).length;
  const encoder = new TextEncoder();
  return slides.map((slide, index) => ({
    fileName: baseName + "-slide-" + String(index + 1).padStart(digits, "0") + ".svg",
    mimeType: "image/svg+xml" as const,
    data: encoder.encode(slideSvg(slide, index, slides.length)),
    altText: baseName + " — slide " + (index + 1) + " of " + slides.length,
    text: slide.texts.join("\n")
  }));
}