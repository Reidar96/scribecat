// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const trash = vi.hoisted(() => ({ list: vi.fn(), children: vi.fn(), restore: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ refreshFolderFiles: trash.refresh }) }));
vi.mock("@/lib/noteTrash", () => ({ listTrashedNotes: trash.list, listTrashedChildren: trash.children, restoreTrashedNote: trash.restore, permanentlyDeleteTrashedNote: trash.remove }));
import { NoteTrashDialog } from "./NoteTrashDialog";
import { readFileSync } from "node:fs";
let root: Root;
let host: HTMLDivElement;
const entry = { id: "folder", relativePath: "Project", kind: "folder", deletedAt: "2026-09-28T10:00:00Z" };
async function click(selector: string) { await act(async () => document.querySelector<HTMLElement>(selector)!.click()); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  trash.list.mockResolvedValue([entry, ...Array.from({ length: 60 }, (_, i) => ({ id: `file-${i}`, relativePath: `Long parent folder/Note ${i}.md`, deletedAt: entry.deletedAt }))]);
  trash.children.mockImplementation(async (_root, _note, subpath) => subpath ? [{ subpath: "Nested/Note.md", name: "Note.md", kind: "file" }] : [{ subpath: "Nested", name: "Nested", kind: "folder" }]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(NoteTrashDialog, { root: "/vault", onClose: vi.fn() })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows many entries in a bounded scrolling list and restores a nested file or folder independently", async () => {
  const style = document.createElement("style"); style.textContent = readFileSync("src/styles/versions.css", "utf8"); document.head.append(style);
  try {
    expect(document.querySelectorAll(".note-trash__row")).toHaveLength(61);
    expect(getComputedStyle(document.querySelector(".note-trash__list")!).overflow).toBe("auto");
    expect(getComputedStyle(document.querySelector(".note-trash__list")!).maxHeight).toBe("55vh");
    await click('.note-trash__expand[aria-label="Project"]');
    await click('.note-trash__expand[aria-label="Nested"]');
    await click('[aria-label="trash.restore: Note.md"]');
    expect(trash.restore).toHaveBeenCalledWith("/vault", entry, "Nested/Note.md");
    expect(trash.refresh).toHaveBeenCalled();
    await click('.note-trash__expand[aria-label="Project"]');
    await click('[aria-label="trash.restore: Nested"]');
    expect(trash.restore).toHaveBeenLastCalledWith("/vault", entry, "Nested");
  } finally { style.remove(); }
});

it("requires the standard delete dialog before permanently deleting a folder", async () => {
  await click('[aria-label="trash.deleteForever: Project"]');
  expect(document.querySelector('#delete-dialog-title')?.textContent).toBe("trash.deleteForever");
  expect(trash.remove).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("common.cancel");
  const dialog = document.querySelector('[aria-labelledby="delete-dialog-title"]')!;
  await act(async () => (dialog.querySelectorAll("button")[0] as HTMLElement).click());
  expect(trash.remove).not.toHaveBeenCalled();
  await click('[aria-label="trash.deleteForever: Project"]');
  await act(async () => (document.querySelector('[aria-labelledby="delete-dialog-title"]')!.querySelectorAll("button")[1] as HTMLElement).click());
  expect(trash.remove).toHaveBeenCalledWith("/vault", entry);
});
