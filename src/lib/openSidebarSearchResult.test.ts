import { beforeEach, expect, it, vi } from "vitest";
import { openSidebarSearchResult } from "./openSidebarSearchResult";
import { useAppStore } from "@/store/useAppStore";
import { useSearchStore } from "@/store/useSearchStore";

beforeEach(() => {
  useAppStore.setState({ selectedFilePath: null });
  useSearchStore.setState({ isPanelOpen: false, query: "", pendingTarget: null, allFiles: true });
});

it("opens find on the selected document and targets its first match", async () => {
  const select = vi.fn(async (path: string) => useAppStore.setState({ selectedFilePath: path }));
  expect(await openSidebarSearchResult("/vault/a.md", "  tekst  ", select)).toBe(true);
  expect(useSearchStore.getState()).toMatchObject({
    isPanelOpen: true, query: "tekst", allFiles: false,
    pendingTarget: { filePath: "/vault/a.md", matchIndex: 0 }
  });
});

it("leaves find closed when the file switch was canceled", async () => {
  expect(await openSidebarSearchResult("/vault/a.md", "tekst", async () => {})).toBe(false);
  expect(useSearchStore.getState()).toMatchObject({ isPanelOpen: false, query: "", pendingTarget: null });
});
