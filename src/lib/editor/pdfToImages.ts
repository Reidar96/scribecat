type PdfViewportLike = {
  width: number;
  height: number;
};

type PdfPageLike = {
  getViewport(options: { scale: number }): PdfViewportLike;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
    background?: string;
  }): { promise: Promise<void> };
};

type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
};

export type RenderedPdfPage = {
  fileName: string;
  mimeType: "image/png";
  data: Uint8Array;
  altText: string;
};

const MAX_RENDER_WIDTH = 1600;
const MAX_RENDER_SCALE = 2.4;

function pdfBaseName(fileName: string): string {
  const leaf = fileName.replace(/\\/g, "/").split("/").pop() || "PDF";
  return leaf.replace(/\.pdf$/i, "") || "PDF";
}

function pageFileName(baseName: string, pageNumber: number, pageCount: number): string {
  const digits = String(Math.max(1, pageCount)).length;
  return `${baseName}-page-${String(pageNumber).padStart(digits, "0")}.png`;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not encode rendered PDF page as PNG."));
        return;
      }

      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

/**
 * Renders every page of a PDF to a PNG that can travel through the editor's
 * existing image-attachment pipeline. The original PDF is intentionally not
 * linked from the note: the note stores ordinary Markdown image nodes, so the
 * PDF appears inline like any other image on desktop and web.
 */
export async function renderPdfToPageImages(
  fileName: string,
  data: Uint8Array
): Promise<RenderedPdfPage[]> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]);

  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdfDocument = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocumentLike;
  const baseName = pdfBaseName(fileName);
  const pages: RenderedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(
        1,
        Math.min(MAX_RENDER_SCALE, MAX_RENDER_WIDTH / Math.max(1, baseViewport.width))
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas is unavailable while rendering the PDF.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
        background: "#ffffff"
      }).promise;

      pages.push({
        fileName: pageFileName(baseName, pageNumber, pdfDocument.numPages),
        mimeType: "image/png",
        data: await canvasToPngBytes(canvas),
        altText:
          pdfDocument.numPages === 1
            ? baseName
            : `${baseName} — page ${pageNumber} of ${pdfDocument.numPages}`
      });

      // Release the backing store before rendering the next page. Multi-page
      // PDFs otherwise keep several full-resolution canvases alive until GC.
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    await pdfDocument.destroy?.();
  }

  return pages;
}
