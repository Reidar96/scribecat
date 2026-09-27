// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), render: vi.fn() }));
vi.mock("@/platform/vaultFs", () => ({ readFile: async () => new Uint8Array() }));
vi.mock("@/platform", () => ({ platform: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {}, TextLayer: undefined,
  getDocument: () => ({ promise: Promise.resolve({ numPages: 7, getPage: pdf.getPage, destroy: vi.fn() }) })
}));
import { PdfViewerSurface } from "./PdfViewerModal";
import { readFileSync } from "node:fs";
const viewerStyles = readFileSync("src/styles/editor-content.css", "utf8");

let host: HTMLDivElement;
let root: Root;
const observed = new Set<Element>();
async function click(selector: string) {
  await act(async () => { (document.querySelector(selector) as HTMLElement).click(); });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    target?: Element;
    observe(target: Element) { this.target = target; observed.add(target); }
    disconnect() { if (this.target) observed.delete(this.target); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AA==");
  pdf.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  pdf.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: pdf.render
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(PdfViewerSurface, { absolutePath: "sample.pdf", label: "Sample", mode: "inline", onOpenInSplit: vi.fn() })); });
  await act(async () => { await vi.dynamicImportSettled(); });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); observed.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("PDF view transitions", () => {
  it.each(["close split", "restore while split stays open"])("keeps an explicit overview height after %s", async (transition) => {
    const styles = document.createElement("style");
    styles.textContent = viewerStyles;
    document.head.append(styles);
    try {
      await click('.pdf-preview__view-button[aria-pressed="false"]');
      await click(".pdf-preview__split-button");
      expect(document.querySelector(".pdf-preview__stage")).toBeNull();
      if (transition === "close split") {
        await act(async () => root.render(createElement(PdfViewerSurface, {
          absolutePath: "sample.pdf", label: "Sample", mode: "inline",
          onOpenInSplit: vi.fn(), restoreMinimizedRequestId: 1
        })));
      } else {
        await click(".pdf-preview__restore-button");
      }
      const stage = document.querySelector<HTMLElement>(".pdf-preview__stage")!;
      // Restoring creates a fresh stage without the single-page renderer's
      // custom property. The CSS must size the grid independently of it.
      expect(stage.style.getPropertyValue("--pdf-inline-stage-height")).toBe("");
      expect(getComputedStyle(stage).height).toBe("54dvh");
      expect(getComputedStyle(stage).maxHeight).toBe("570px");
      expect(document.querySelectorAll(".pdf-preview__overview-page")).toHaveLength(6);
      expect(observed.has(stage)).toBe(true);
    } finally {
      styles.remove();
    }
  });
  it("does not reuse the rendered page's pixel dimensions for the overview", async () => {
    const page = document.querySelector<HTMLElement>(".pdf-preview__page")!;
    expect(page.style.width).toMatch(/px$/);
    expect(page.style.height).toMatch(/px$/);
    await click('.pdf-preview__view-button[aria-pressed="false"]');
    const overview = document.querySelector<HTMLElement>(".pdf-preview__overview-wrap")!;
    expect(overview).not.toBe(page);
    expect(overview.style.width).toBe("");
    expect(overview.style.height).toBe("");
    expect(document.querySelectorAll(".pdf-preview__overview-page")).toHaveLength(6);
    await click(".pdf-preview__overview-page");
    expect(document.querySelector(".pdf-preview__page")).not.toBe(overview);
  });
  it("observes the new stage and intercepts trackpad zoom after minimize/restore", async () => {
    await click(".pdf-preview__split-button");
    await click(".pdf-preview__restore-button");
    const stage = document.querySelector(".pdf-preview__stage")!;
    expect(observed.has(stage)).toBe(true);
    const wheel = new WheelEvent("wheel", { ctrlKey: true, deltaY: -50, cancelable: true, bubbles: true });
    await act(async () => { stage.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
  });
  it("rerenders when opening another PDF with the same page count", async () => {
    const previousRenders = pdf.render.mock.calls.length;
    await act(async () => { root.render(createElement(PdfViewerSurface, { absolutePath: "other.pdf", label: "Other", mode: "inline" })); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(document.querySelector<HTMLCanvasElement>("canvas")!.width).toBeGreaterThan(1);
    expect(pdf.render.mock.calls.length).toBeGreaterThan(previousRenders);
  });
  it("shows a readable error if a PDF page cannot be loaded", async () => {
    pdf.getPage.mockRejectedValueOnce(new Error("broken page"));
    await click('.pdf-preview__pager button[aria-label="pdfViewer.next"]');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("pdfViewer.error");
  });
  it("shows a readable error if an overview page cannot be loaded", async () => {
    pdf.getPage.mockRejectedValueOnce(new Error("broken thumbnail"));
    await click('.pdf-preview__view-button[aria-pressed="false"]');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("pdfViewer.error");
  });
  it("centers an incomplete final row without inheriting page dimensions", async () => {
    await click('.pdf-preview__view-button[aria-pressed="false"]');
    await click('.pdf-preview__overview-nav button[aria-label="pdfViewer.next"]');
    const tiles = document.querySelectorAll<HTMLElement>('.pdf-preview__overview-page');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].style.gridColumn).toBe("3 / span 2");
    expect(document.querySelector<HTMLElement>('.pdf-preview__overview-wrap')!.style.height).toBe("");
  });

});
