// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/platform", () => ({ platform: { vault: { onFolderFilesChanged: register } } }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: { getState: () => ({ folderPath: '/vault' }) } }));
import { useFolderWatcher } from "./useFolderWatcher";
it("unsubscribes if IPC registration completes after unmount", async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolve!: (cleanup: () => void) => void;
  register.mockReturnValue(new Promise(r => { resolve = r; }));
  const cleanup = vi.fn();
  const host = document.createElement('div'); const root = createRoot(host);
  function Harness() { useFolderWatcher(async () => true); return null; }
  await act(async () => root.render(createElement(Harness)));
  await act(async () => root.unmount());
  resolve(cleanup); await Promise.resolve();
  expect(cleanup).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
