import { unzipSync } from "fflate";

type RelationshipMap = Record<string, string>;

type SlideSource = {
  xml: string;
  relXml: string;
};

type RenderContext = {
  zip: Record<string, Uint8Array>;
  decoder: TextDecoder;
  themeColors: Record<string, string>;
  slideWidth: number;
  slideHeight: number;
  relationships: RelationshipMap;
};

type ShapeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
};

type TextRun = {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
};

type PptxSlide = {
  svg: string;
  text: string;
  width: number;
  height: number;
};

function localName(node: Element): string {
  return node.localName ?? node.tagName.split(":").pop() ?? "";
}

function descendants(node: Element, name: string): Element[] {
  return Array.from(node.getElementsByTagName("*")).filter(
    (candidate) => localName(candidate) === name
  );
}

function firstDescendant(node: Element, name: string): Element | null {
  return descendants(node, name)[0] ?? null;
}

function attr(node: Element | null, name: string): string | null {
  if (!node) return null;
  return node.getAttribute(name);
}

function numberAttr(node: Element | null, name: string, fallback = 0): number {
  const value = Number.parseFloat(attr(node, name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
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

function extension(path: string): string {
  return path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
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

function parseRelationships(xml: string): RelationshipMap {
  if (!xml) return {};
  const document = parseXml(xml);
  const relationships: RelationshipMap = {};

  for (const relationship of Array.from(document.getElementsByTagName("*")).filter(
    (node) => localName(node) === "Relationship"
  )) {
    const id = attr(relationship, "Id");
    const target = attr(relationship, "Target");
    const targetMode = attr(relationship, "TargetMode");
    if (id && target && targetMode !== "External") {
      relationships[id] = target;
    }
  }

  return relationships;
}

function parseThemeColors(xml: string): Record<string, string> {
  if (!xml) return {};
  const document = parseXml(xml);
  const scheme = Array.from(document.getElementsByTagName("*")).find(
    (node) => localName(node) === "clrScheme"
  );
  if (!scheme) return {};

  const colors: Record<string, string> = {};
  for (const child of Array.from(scheme.children)) {
    const name = localName(child);
    const color =
      firstDescendant(child, "srgbClr")?.getAttribute("val") ??
      firstDescendant(child, "sysClr")?.getAttribute("lastClr");
    if (color) colors[name] = "#" + color;
  }

  return colors;
}

function resolveColor(
  node: Element | null,
  themeColors: Record<string, string>,
  fallback = "#111111"
): string {
  if (!node) return fallback;

  const srgb = firstDescendant(node, "srgbClr")?.getAttribute("val");
  if (srgb) return "#" + srgb;

  const scheme = firstDescendant(node, "schemeClr")?.getAttribute("val");
  if (scheme && themeColors[scheme]) return themeColors[scheme];

  const system = firstDescendant(node, "sysClr")?.getAttribute("lastClr");
  if (system) return "#" + system;

  return fallback;
}

function resolveFill(
  parent: Element,
  themeColors: Record<string, string>,
  fallback = "none"
): string {
  if (firstDescendant(parent, "noFill")) return "none";
  const solid = firstDescendant(parent, "solidFill");
  if (solid) return resolveColor(solid, themeColors, fallback);

  const schemeFill = firstDescendant(parent, "solidFill");
  if (schemeFill) return resolveColor(schemeFill, themeColors, fallback);

  return fallback;
}

function getShapeBox(node: Element): ShapeBox | null {
  const xfrm =
    firstDescendant(node, "xfrm") ??
    firstDescendant(node, "grpSpPr");
  if (!xfrm) return null;

  const off = firstDescendant(xfrm, "off");
  const ext = firstDescendant(xfrm, "ext");
  if (!off || !ext) return null;

  return {
    x: numberAttr(off, "x"),
    y: numberAttr(off, "y"),
    width: Math.max(0, numberAttr(ext, "cx")),
    height: Math.max(0, numberAttr(ext, "cy")),
    rotation: numberAttr(xfrm, "rot") / 60000,
    flipH: attr(xfrm, "flipH") === "1",
    flipV: attr(xfrm, "flipV") === "1"
  };
}

function mapBox(box: ShapeBox, parent: {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}): ShapeBox {
  return {
    x: parent.x + box.x * parent.scaleX,
    y: parent.y + box.y * parent.scaleY,
    width: box.width * parent.scaleX,
    height: box.height * parent.scaleY,
    rotation: box.rotation,
    flipH: box.flipH,
    flipV: box.flipV
  };
}

function shapeTransform(box: ShapeBox): string {
  const transforms: string[] = [];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  if (box.rotation) {
    transforms.push(
      "rotate(" + box.rotation.toFixed(4) + " " + cx + " " + cy + ")"
    );
  }

  if (box.flipH || box.flipV) {
    const sx = box.flipH ? -1 : 1;
    const sy = box.flipV ? -1 : 1;
    transforms.push(
      "translate(" + cx + " " + cy + ") scale(" + sx + " " + sy + ") translate(" +
        -cx + " " + -cy + ")"
    );
  }

  return transforms.length > 0 ? ' transform="' + transforms.join(" ") + '"' : "";
}

function shapeGeometry(shape: Element): string {
  const geometry = firstDescendant(shape, "prstGeom");
  const preset = geometry?.getAttribute("prst") ?? "rect";
  if (preset === "ellipse" || preset === "oval") return "ellipse";
  if (preset === "roundRect") return "roundRect";
  return "rect";
}

function renderShapeBackground(
  shape: Element,
  box: ShapeBox,
  themeColors: Record<string, string>
): string {
  const spPr =
    descendants(shape, "spPr")[0] ??
    descendants(shape, "grpSpPr")[0];
  if (!spPr) return "";

  const fill = resolveFill(spPr, themeColors, "none");
  const geometry = shapeGeometry(shape);
  if (fill === "none" && !firstDescendant(spPr, "ln")) return "";

  const line = firstDescendant(spPr, "ln");
  const lineFill = line ? resolveFill(line, themeColors, "none") : "none";
  const lineWidth = line ? Math.max(1, numberAttr(line, "w", 12700) / 914400) : 0;

  const common =
    ' fill="' + escapeXml(fill) + '"' +
    (lineFill !== "none"
      ? ' stroke="' + escapeXml(lineFill) + '" stroke-width="' + lineWidth + '"'
      : "");

  if (geometry === "ellipse") {
    return (
      '<ellipse cx="' + (box.x + box.width / 2) +
      '" cy="' + (box.y + box.height / 2) +
      '" rx="' + box.width / 2 +
      '" ry="' + box.height / 2 + '"' +
      common + shapeTransform(box) + "/>"
    );
  }

  const radius = geometry === "roundRect"
    ? Math.min(box.width, box.height) * 0.08
    : 0;
  return (
    '<rect x="' + box.x +
    '" y="' + box.y +
    '" width="' + box.width +
    '" height="' + box.height +
    '"' + (radius ? ' rx="' + radius + '" ry="' + radius + '"' : "") +
    common + shapeTransform(box) + "/>"
  );
}

function fontSizeFromProperties(props: Element | null, fallback: number): number {
  const size = numberAttr(props, "sz", 1800);
  return props && Number.isFinite(size) && size > 0 ? size / 100 : fallback;
}

function runPropertyElement(run: Element): Element | null {
  return firstDescendant(run, "rPr") ?? firstDescendant(run, "endParaRPr");
}

function textRuns(
  paragraph: Element,
  body: Element,
  themeColors: Record<string, string>
): TextRun[] {
  const defaultProps =
    firstDescendant(paragraph, "defRPr") ??
    firstDescendant(body, "defRPr");
  const defaultSize = fontSizeFromProperties(defaultProps, 18);
  const defaultColor = resolveColor(
    firstDescendant(defaultProps ?? body, "solidFill"),
    themeColors,
    "#111111"
  );
  const defaultFont =
    attr(defaultProps, "typeface") ??
    attr(firstDescendant(body, "latin"), "typeface") ??
    "Arial";

  const runs: TextRun[] = [];
  for (const run of descendants(paragraph, "r")) {
    const text = Array.from(run.getElementsByTagName("*"))
      .filter((node) => localName(node) === "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (!text) continue;

    const props = runPropertyElement(run);
    const fill = firstDescendant(props ?? run, "solidFill");
    runs.push({
      text,
      fontSize: fontSizeFromProperties(props, defaultSize),
      fontFamily: attr(props, "typeface") ?? defaultFont,
      color: resolveColor(fill, themeColors, defaultColor),
      bold: attr(props, "b") === "1",
      italic: attr(props, "i") === "1"
    });
  }

  return runs;
}

function paragraphAlignment(paragraph: Element): "start" | "middle" | "end" {
  const pPr = firstDescendant(paragraph, "pPr");
  const align = attr(pPr, "algn");
  if (align === "ctr") return "middle";
  if (align === "r") return "end";
  return "start";
}

function renderText(
  shape: Element,
  box: ShapeBox,
  body: Element,
  themeColors: Record<string, string>
): { svg: string; text: string } {
  const bodyPr = firstDescendant(body, "bodyPr");
  const leftInset = Math.max(0, numberAttr(bodyPr && firstDescendant(bodyPr, "lIns"), "val", 0));
  const rightInset = Math.max(0, numberAttr(bodyPr && firstDescendant(bodyPr, "rIns"), "val", 0));
  const topInset = Math.max(0, numberAttr(bodyPr && firstDescendant(bodyPr, "tIns"), "val", 0));
  const bottomInset = Math.max(0, numberAttr(bodyPr && firstDescendant(bodyPr, "bIns"), "val", 0));
  const usableWidth = Math.max(1, box.width - leftInset - rightInset);
  const paragraphs = descendants(body, "p");
  const textLines: string[] = [];
  const elements: string[] = [];

  const paragraphData = paragraphs.map((paragraph) => {
    const runs = textRuns(paragraph, body, themeColors);
    const text = runs.map((run) => run.text).join("");
    const maxSize = Math.max(10, ...runs.map((run) => run.fontSize));
    return {
      runs,
      text,
      maxSize,
      alignment: paragraphAlignment(paragraph)
    };
  }).filter((paragraph) => paragraph.text.length > 0);

  if (paragraphData.length === 0) {
    return { svg: "", text: "" };
  }

  const lineHeight = Math.max(12, Math.max(...paragraphData.map((p) => p.maxSize)) * 1.2);
  const totalHeight = paragraphData.length * lineHeight;
  const anchor = attr(bodyPr, "anchor") ?? "t";
  const startY =
    anchor === "ctr"
      ? box.y + topInset + Math.max(0, (box.height - topInset - bottomInset - totalHeight) / 2)
      : anchor === "b"
        ? box.y + box.height - bottomInset - totalHeight
        : box.y + topInset;

  let y = startY + lineHeight * 0.08;

  for (const paragraph of paragraphData) {
    const anchorValue = paragraph.alignment;
    const x =
      anchorValue === "middle"
        ? box.x + leftInset + usableWidth / 2
        : anchorValue === "end"
          ? box.x + box.width - rightInset
          : box.x + leftInset;

    const runsSvg = paragraph.runs.map((run) =>
      '<tspan font-family="' + escapeXml(run.fontFamily) +
      '" font-size="' + run.fontSize +
      '" fill="' + escapeXml(run.color) +
      (run.bold ? ' font-weight="700"' : "") +
      (run.italic ? ' font-style="italic"' : "") +
      '>' + escapeXml(run.text) + "</tspan>"
    ).join("");

    elements.push(
      '<text x="' + x +
      '" y="' + y +
      '" text-anchor="' + (anchorValue === "middle" ? "middle" : anchorValue === "end" ? "end" : "start") +
      ' dominant-baseline="hanging" xml:space="preserve"' +
      shapeTransform(box) + ">" + runsSvg + "</text>"
    );

    textLines.push(paragraph.text);
    y += lineHeight;
  }

  return {
    svg: elements.join(""),
    text: textLines.join("\n")
  };
}

function renderImage(
  shape: Element,
  box: ShapeBox,
  context: RenderContext
): string {
  const blip = firstDescendant(shape, "blip");
  const embed = blip?.getAttribute("r:embed") ?? blip?.getAttribute("embed");
  if (!embed) return "";

  const target = context.relationships[embed];
  if (!target) return "";

  const resolved = resolveTarget("ppt/slides", target);
  const bytes = context.zip[resolved];
  if (!bytes) return "";

  const mimeType = mimeForExtension(extension(resolved));
  if (mimeType === "application/octet-stream") return "";

  const srcRect = firstDescendant(shape, "srcRect");
  const cropTop = numberAttr(srcRect, "t", 0) / 100000;
  const cropBottom = numberAttr(srcRect, "b", 0) / 100000;
  const cropLeft = numberAttr(srcRect, "l", 0) / 100000;
  const cropRight = numberAttr(srcRect, "r", 0) / 100000;

  const sourceWidth = Math.max(0.01, 100 - cropLeft - cropRight);
  const sourceHeight = Math.max(0.01, 100 - cropTop - cropBottom);
  const clipId = "clip-" + Math.random().toString(36).slice(2);

  return (
    '<svg x="' + box.x + '" y="' + box.y +
    '" width="' + box.width + '" height="' + box.height +
    '" viewBox="0 0 100 100" preserveAspectRatio="none"' +
    shapeTransform(box) + ">" +
    '<defs><clipPath id="' + clipId + '"><rect x="' + cropLeft +
    '" y="' + cropTop + '" width="' + sourceWidth +
    '" height="' + sourceHeight + '"/></clipPath></defs>' +
    '<image href="' + toDataUrl(mimeType, bytes) +
    '" x="' + (-cropLeft * 100 / sourceWidth) +
    '" y="' + (-cropTop * 100 / sourceHeight) +
    '" width="' + (100 * 100 / sourceWidth) +
    '" height="' + (100 * 100 / sourceHeight) +
    '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')"/>' +
    "</svg>"
  );
}

function renderShapeTree(
  nodes: Element[],
  context: RenderContext,
  parent: { x: number; y: number; scaleX: number; scaleY: number }
): { svg: string; text: string[] } {
  const output: string[] = [];
  const text: string[] = [];

  for (const node of nodes) {
    const name = localName(node);
    if (name === "nvGrpSpPr" || name === "grpSpPr" || name === "nvSpPr" || name === "nvPicPr") {
      continue;
    }

    if (name === "grpSp") {
      const box = getShapeBox(node);
      if (!box) continue;

      const grpSpPr = descendants(node, "grpSpPr")[0];
      const xfrm =
        firstDescendant(grpSpPr ?? node, "xfrm") ??
        firstDescendant(node, "xfrm");
      const off = firstDescendant(xfrm ?? node, "off");
      const ext = firstDescendant(xfrm ?? node, "ext");
      const chOff = firstDescendant(xfrm ?? node, "chOff");
      const chExt = firstDescendant(xfrm ?? node, "chExt");

      const childParent = xfrm && off && ext && chOff && chExt
        ? {
            x: parent.x + (numberAttr(off, "x") - numberAttr(chOff, "x")) * parent.scaleX,
            y: parent.y + (numberAttr(off, "y") - numberAttr(chOff, "y")) * parent.scaleY,
            scaleX:
              parent.scaleX *
              Math.max(0.0001, numberAttr(ext, "cx") / Math.max(1, numberAttr(chExt, "cx"))),
            scaleY:
              parent.scaleY *
              Math.max(0.0001, numberAttr(ext, "cy") / Math.max(1, numberAttr(chExt, "cy")))
          }
        : parent;

      const children = Array.from(node.children).filter((child) =>
        ["sp", "pic", "grpSp", "graphicFrame"].includes(localName(child))
      );
      const nested = renderShapeTree(children, context, childParent);
      output.push(nested.svg);
      text.push(...nested.text);
      continue;
    }

    if (name === "graphicFrame") {
      const box = getShapeBox(node);
      if (!box) continue;
      const mapped = mapBox(box, parent);
      const texts = descendants(node, "t")
        .map((t) => t.textContent ?? "")
        .filter(Boolean);
      if (texts.length) {
        output.push(
          '<text x="' + mapped.x +
          '" y="' + (mapped.y + 18) +
          '" font-family="Arial, sans-serif" font-size="18" fill="#111111">' +
          escapeXml(texts.join(" ")) + "</text>"
        );
        text.push(texts.join(" "));
      }
      continue;
    }

    if (name === "sp") {
      const box = getShapeBox(node);
      const body = firstDescendant(node, "txBody");
      if (!box) continue;

      const mapped = mapBox(box, parent);
      output.push(renderShapeBackground(node, mapped, context.themeColors));

      if (body) {
        const renderedText = renderText(node, mapped, body, context.themeColors);
        output.push(renderedText.svg);
        if (renderedText.text) text.push(renderedText.text);
      }
      continue;
    }

    if (name === "pic") {
      const box = getShapeBox(node);
      if (!box) continue;
      const mapped = mapBox(box, parent);
      const image = renderImage(node, mapped, context);
      if (image) output.push(image);
      continue;
    }
  }

  return { svg: output.join(""), text };
}

function slideSvg(
  source: SlideSource,
  contextBase: Omit<RenderContext, "relationships">,
  relationships: RelationshipMap,
  index: number,
  total: number
): PptxSlide {
  const document = parseXml(source.xml);
  const slide = Array.from(document.getElementsByTagName("*")).find(
    (node) => localName(node) === "sld"
  );
  if (!slide) {
    throw new Error("Invalid PowerPoint slide XML.");
  }

  const context: RenderContext = {
    ...contextBase,
    relationships
  };

  const background =
    firstDescendant(slide, "bgPr");
  const backgroundFill = background
    ? resolveFill(background, context.themeColors, "#ffffff")
    : "#ffffff";

  const shapeTree =
    Array.from(slide.children).find((child) => localName(child) === "spTree");

  const children = shapeTree
    ? Array.from(shapeTree.children).filter((child) =>
        ["sp", "pic", "grpSp", "graphicFrame"].includes(localName(child))
      )
    : [];

  const rendered = renderShapeTree(children, context, {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1
  });

  const footer =
    '<text x="' + (context.slideWidth - 120000) +
    '" y="' + (context.slideHeight - 90000) +
    '" text-anchor="end" font-family="Arial, sans-serif" font-size="' +
    Math.max(12000, context.slideWidth / 80) +
    '" fill="rgba(0,0,0,0.45)">' + (index + 1) + " / " + total + "</text>";

  const svg =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + context.slideWidth +
    '" height="' + context.slideHeight + '" viewBox="0 0 ' +
    context.slideWidth + " " + context.slideHeight + '">' +
    "<rect width=\"100%\" height=\"100%\" fill=\"" +
    escapeXml(backgroundFill) + "\"/>" +
    rendered.svg +
    footer +
    "</svg>";

  return {
    svg,
    text: rendered.text.join("\n"),
    width: context.slideWidth,
    height: context.slideHeight
  };
}

function readSlideSources(
  zip: Record<string, Uint8Array>,
  decoder: TextDecoder
): SlideSource[] {
  const slideNames = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/\d+/)?.[0] ?? 0) -
        Number(b.match(/\d+/)?.[0] ?? 0)
    );

  return slideNames.map((name) => {
    const file = name.split("/").pop() ?? "";
    const relName = "ppt/slides/_rels/" + file + ".rels";
    return {
      xml: decoder.decode(zip[name]),
      relXml: zip[relName] ? decoder.decode(zip[relName]) : ""
    };
  });
}

function slideSize(zip: Record<string, Uint8Array>, decoder: TextDecoder): {
  width: number;
  height: number;
} {
  const file = zip["ppt/presentation.xml"];
  if (!file) return { width: 12192000, height: 6858000 };

  const document = parseXml(decoder.decode(file));
  const size = firstDescendant(document.documentElement, "sldSz");
  return {
    width: Math.max(1, numberAttr(size, "cx", 12192000)),
    height: Math.max(1, numberAttr(size, "cy", 6858000))
  };
}

function themeColorsFromZip(
  zip: Record<string, Uint8Array>,
  decoder: TextDecoder
): Record<string, string> {
  const themeName = Object.keys(zip).find((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  return themeName ? parseThemeColors(decoder.decode(zip[themeName])) : {};
}

async function parseSlides(data: Uint8Array): Promise<PptxSlide[]> {
  const zip = unzipSync(data);
  const decoder = new TextDecoder();
  const sources = readSlideSources(zip, decoder);

  if (sources.length === 0) return [];

  const size = slideSize(zip, decoder);
  const themeColors = themeColorsFromZip(zip, decoder);
  const contextBase = {
    zip,
    decoder,
    themeColors,
    slideWidth: size.width,
    slideHeight: size.height
  };

  return sources.map((source, index) =>
    slideSvg(
      source,
      contextBase,
      parseRelationships(source.relXml),
      index,
      sources.length
    )
  );
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
  width: number;
  height: number;
}>> {
  const slides = await parseSlides(data);
  if (slides.length === 0) {
    throw new Error("The PowerPoint file does not contain readable slides.");
  }

  const baseName =
    (fileName.replace(/\\/g, "/").split("/").pop() ?? "PowerPoint")
      .replace(/\.pptx$/i, "") || "PowerPoint";
  const digits = String(slides.length).length;
  const encoder = new TextEncoder();

  return slides.map((slide, index) => ({
    fileName:
      baseName +
      "-slide-" +
      String(index + 1).padStart(digits, "0") +
      ".svg",
    mimeType: "image/svg+xml" as const,
    data: encoder.encode(slide.svg),
    altText: baseName + " — slide " + (index + 1) + " of " + slides.length,
    text: slide.text,
    width: slide.width,
    height: slide.height
  }));
}
