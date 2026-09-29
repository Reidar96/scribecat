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
  it("opens on a stationary long press and cancels when the user scrolls", async () => {
    vi.useFakeTimers();
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
  });
});
