// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps a menu opened at the lower edge fully within the desktop viewport", async () => {
  vi.stubGlobal("innerWidth", 500);
  vi.stubGlobal("innerHeight", 400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200, height: 300, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 300,
    toJSON: () => undefined
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ContextMenuSurface, {
    x: 450, y: 390, children: createElement("button", { type: "button" }, "Action")
  })));
  const menu = document.querySelector<HTMLElement>(".file-tree-context-menu[role='menu']");
  expect(menu?.style.left).toBe("292px");
  expect(menu?.style.top).toBe("92px");
  await act(async () => root.unmount());
  host.remove();
});
