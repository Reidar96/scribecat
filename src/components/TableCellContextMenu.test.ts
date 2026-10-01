// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TableCellContextMenu } from "@/components/TableCellContextMenu";
import { buildPreviewExtensions } from "@/lib/editor/extensions";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  editor?.destroy();
  host?.remove();
  root = null;
  editor = null;
  host = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function touch(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    clientX: { value: x },
    clientY: { value: y }
  });
  return event;
}

describe("table cell touch menu", () => {
  it("deletes every selected row from the context menu", async () => {
    editor = new Editor({ extensions: buildPreviewExtensions(), content: "| First | Second |\n| --- | --- |\n| A | B |\n| C | D |\n| E | F |" });
    host = document.createElement("div");
    host.append(editor.view.dom);
    document.body.append(host);
    const menuHost = document.createElement("div");
    host.append(menuHost);
    root = createRoot(menuHost);
    await act(async () => root?.render(createElement(TableCellContextMenu, { editor: editor! })));
    const cells = host.querySelectorAll<HTMLTableCellElement>("td");
    await act(async () => {
      editor!.commands.setCellSelection({ anchorCell: editor!.view.posAtDOM(cells[0], 0) - 1, headCell: editor!.view.posAtDOM(cells[3], 0) - 1 });
    });
    expect(cells[0].classList.contains("selectedCell")).toBe(true);
    await act(async () => cells[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
    const deleteRows = [...document.querySelectorAll<HTMLButtonElement>(".table-cell-menu [role='menuitem']")].find((item) => item.textContent === "Delete rows");
    expect(deleteRows).toBeTruthy();
    await act(async () => deleteRows!.click());
    expect(host.querySelectorAll("tr")).toHaveLength(2);
    expect(editor!.getText()).toContain("E");
    expect(editor!.getText()).not.toContain("A");
    expect(editor!.getText()).not.toContain("C");
  });

  it("deletes every selected column from the context menu", async () => {
    editor = new Editor({ extensions: buildPreviewExtensions(), content: "| A | B | C |\n| --- | --- | --- |\n| D | E | F |" });
    host = document.createElement("div");
    host.append(editor.view.dom);
    document.body.append(host);
    const menuHost = document.createElement("div");
    host.append(menuHost);
    root = createRoot(menuHost);
    await act(async () => root?.render(createElement(TableCellContextMenu, { editor: editor! })));
    const cells = host.querySelectorAll<HTMLTableCellElement>("td");
    await act(async () => editor!.commands.setCellSelection({ anchorCell: editor!.view.posAtDOM(cells[0], 0) - 1, headCell: editor!.view.posAtDOM(cells[1], 0) - 1 }));
    await act(async () => cells[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
    const deleteColumns = [...document.querySelectorAll<HTMLButtonElement>(".table-cell-menu [role='menuitem']")].find((item) => item.textContent === "Delete columns");
    expect(deleteColumns).toBeTruthy();
    await act(async () => deleteColumns!.click());
    expect(host.querySelectorAll("tr")).toHaveLength(2);
    expect([...host.querySelectorAll("tr")].map((row) => row.children.length)).toEqual([1, 1]);
    expect(editor!.getText()).toContain("F");
    expect(editor!.getText()).not.toContain("D");
  });

  it("opens on a stationary long press and cancels when the user scrolls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("640"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    editor = new Editor({ extensions: buildPreviewExtensions(), content: "| First | Second |\n| --- | --- |\n| A | B |" });
    host = document.createElement("div");
    host.append(editor.view.dom);
    document.body.append(host);
    const menuHost = document.createElement("div");
    host.append(menuHost);
    root = createRoot(menuHost);
    await act(async () => root?.render(createElement(TableCellContextMenu, { editor: editor! })));
    const cell = host.querySelector("td")!;

    await act(async () => {
      cell.dispatchEvent(touch("pointerdown", 40, 60));
      window.dispatchEvent(touch("pointermove", 40, 90));
      vi.advanceTimersByTime(600);
    });
    expect(document.querySelector(".table-cell-menu")).toBeNull();

    await act(async () => {
      cell.dispatchEvent(touch("pointerdown", 40, 60));
      vi.advanceTimersByTime(600);
    });
    expect(document.querySelector(".table-cell-menu[role='menu']")).not.toBeNull();
    expect(document.querySelector(".table-cell-menu.file-tree-context-menu--sheet")).not.toBeNull();
    expect(document.querySelector(".file-tree-context-menu__backdrop")).not.toBeNull();
  });
});
