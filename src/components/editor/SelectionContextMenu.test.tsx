// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useLayoutMode", () => ({ useLayoutMode: () => "desktop" }));
vi.mock("@/store/useShortcutsStore", () => ({ useShortcutsStore: (selector: (state: { overrides: object }) => unknown) => selector({ overrides: {} }) }));

import { SelectionContextMenu } from "./SelectionContextMenu";

let host: HTMLDivElement;
let root: Root;
const run = vi.fn();
const fakeEditor = { chain: () => ({ focus: () => ({ insertTable: run, toggleBlockquote: run, toggleCodeBlock: run, setHorizontalRule: run }) }) };
const onPaste = vi.fn();
const onInsertImage = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SelectionContextMenu, {
    x: 20, y: 20, hasSelection: false, canEdit: true, editor: fakeEditor as never,
    onCopyFormatted: vi.fn(), onCopyMarkdown: vi.fn(), onCopyPlainText: vi.fn(), onPaste,
    onInsertImage, onInsertLink: vi.fn(), onInsertBlock: vi.fn(), onClose: vi.fn()
  })));
});

afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("SelectionContextMenu", () => {
  it("offers normal and plain-text paste, plus icon actions for inserting content", () => {
    expect(document.querySelector('[aria-label="editorContextMenu.paste"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.pastePlainText"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.insertImage"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.insertTable"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.insertBlock"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.insertDivider"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="editorContextMenu.copyFormatted"]')).toBeNull();
  });

  it("routes paste and image actions to their handlers", () => {
    act(() => (document.querySelector('[aria-label="editorContextMenu.pastePlainText"]') as HTMLButtonElement).click());
    act(() => (document.querySelector('[aria-label="editorContextMenu.insertImage"]') as HTMLButtonElement).click());
    expect(onPaste).toHaveBeenCalledWith(true);
    expect(onInsertImage).toHaveBeenCalledOnce();
  });
});
