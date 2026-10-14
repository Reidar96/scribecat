// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginTopbar } from "./PluginTopbar";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("shared plugin topbar", () => {
  it("keeps the main sidebar control and home action in the same positions for apps and books", () => {
    const toggle = vi.fn();
    const home = vi.fn();
    for (const icon of ["apps", "books"] as const) {
      act(() => root.render(createElement(PluginTopbar, { title: icon === "apps" ? "Apper" : "Bøker", icon, isPhone: false,
        sidebarVisible: true, onSidebarVisibilityToggle: toggle, onOpenSidebar: vi.fn(), onClose: home })));
      const header = host.querySelector("header")!;
      expect(header.querySelector("button:first-child")?.getAttribute("aria-label")).toBe("Lukk sidemeny");
      expect(header.lastElementChild?.getAttribute("aria-label")).toBe("Hjem");
      act(() => (header.querySelector("button:first-child") as HTMLButtonElement).click());
      act(() => (header.lastElementChild as HTMLButtonElement).click());
    }
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(home).toHaveBeenCalledTimes(2);
  });
});
