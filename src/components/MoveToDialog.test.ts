// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { MoveToDialog } from "./MoveToDialog";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => {
  await act(async () => root.render(createElement(MoveToDialog, {
    request: null, fileRelativePaths: [], emptyFolderRelativePaths: [], isMoving: false,
    onConfirm: vi.fn(), onCancel: vi.fn()
  })));
});

it("expands an unavailable current folder so its child can be chosen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onConfirm = vi.fn();
  await act(async () => root.render(createElement(MoveToDialog, {
    request: { sources: [{ kind: "file", relativePath: "Projects/Roadmap.md" }], label: "Roadmap.md" },
    fileRelativePaths: ["Projects/Roadmap.md", "Projects/Archive/Old.md"],
    emptyFolderRelativePaths: [], isMoving: false, onConfirm, onCancel: vi.fn()
  })));
  const projects = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((row) => row.title === "Projects")!;
  expect(projects.getAttribute("aria-disabled")).toBe("true");
  await act(async () => projects.click());
  const archive = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((row) => row.title === "Projects/Archive")!;
  expect(archive).toBeTruthy();
  await act(async () => archive.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="move-confirm"]')!.click());
  expect(onConfirm).toHaveBeenCalledWith("Projects/Archive");
  vi.unstubAllGlobals();
});
