// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useViewportHeight } from "./useViewportHeight";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("scrolls a focused mobile text field above the on-screen keyboard", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const viewport = new EventTarget();
  Object.defineProperties(viewport, { height: { value: 300 }, offsetTop: { value: 0 } });
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const scroll = document.createElement("div");
  scroll.style.overflowY = "auto";
  Object.defineProperties(scroll, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } });
  const input = document.createElement("input");
  input.getBoundingClientRect = () => new DOMRect(10, 350, 100, 30);
  scroll.append(input);
  document.body.append(scroll);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Harness() { useViewportHeight(); return null; }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { input.focus(); viewport.dispatchEvent(new Event("resize")); });
    expect(scroll.scrollTop).toBeGreaterThan(100);
    const position = scroll.scrollTop;
    input.getBoundingClientRect = () => new DOMRect(10, 350, 100, 30);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); document.dispatchEvent(new Event("selectionchange")); });
    expect(scroll.scrollTop).toBe(position);
    await act(async () => { viewport.dispatchEvent(new Event("resize")); });
    expect(scroll.scrollTop).toBeGreaterThan(position);
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("300px");
    expect(document.documentElement.style.getPropertyValue("--keyboard-edit-space")).toBe("160px");
  } finally {
    await act(async () => root.unmount());
    scroll.remove(); host.remove();
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
  }
});
