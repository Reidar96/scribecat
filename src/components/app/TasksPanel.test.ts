// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("@/hooks/useLayoutMode", () => ({ useLayoutMode: () => "desktop" }));
vi.mock("@/platform/paths", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@/lib/fileSystem", () => ({
  getRelativeDisplayPath: (root: string, path: string) => path.slice(root.length + 1),
  readMarkdownFile: async (path: string) => `# ${path.split("/").pop()?.slice(0, -3)}\n\n## Existing\n- [ ] Task\n`
}));
vi.mock("@/store/useEditorSettingsStore", async () => {
  const { create } = await import("zustand");
  const { DEFAULT_TASK_SETTINGS } = await import("@/lib/tasks");
  return { useEditorSettingsStore: create((set) => ({ taskSettings: DEFAULT_TASK_SETTINGS,
    setTaskSettings: (patch: object) => set((state: { taskSettings: object }) => ({ taskSettings: { ...state.taskSettings, ...patch } })) })) };
});
import { TasksPanel } from "./TasksPanel";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { DEFAULT_TASK_SETTINGS } from "@/lib/tasks";
let host: HTMLDivElement;
let root: Root;
const persist = vi.fn(async (_filePath: string, _markdown: string) => true);
const category = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".tasks-category--managed")].find((button) => button.firstElementChild?.textContent === name)!;
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(input: HTMLElement, key: string) {
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useEditorSettingsStore.setState({ taskSettings: { ...DEFAULT_TASK_SETTINGS, categoryOrder: [] } });
  persist.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(TasksPanel, {
    folderPath: "/vault", filePaths: ["/vault/Gjøremål/Alpha.md", "/vault/Gjøremål/Beta.md", "/vault/Gjøremål/Gamma.md"], fileMtimeMs: {}, sidebarVisible: true,
    onSidebarVisibilityToggle: vi.fn(), onOpenSidebar: vi.fn(), onClose: vi.fn(), onPersistTaskFile: persist,
    onRenameTaskFile: async () => true, onDeleteTaskFile: async () => true
  })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("creates categories and sections directly in the list and heading with Enter, and cancels with Escape", async () => {
  await click(host.querySelector<HTMLButtonElement>(".tasks-category-add")!);
  const name = host.querySelector<HTMLInputElement>(".tasks-category-name-edit input")!;
  expect(document.activeElement).toBe(name);
  await type(name, "Delta"); await key(name, "Enter");
  expect(persist).toHaveBeenCalledWith("/vault/Gjøremål/Delta.md", expect.stringContaining("# Delta"));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="tasks.newSection"]')!);
  const heading = host.querySelector<HTMLInputElement>(".tasks-section-heading input")!;
  await type(heading, "New section"); await key(heading, "Enter");
  expect(persist).toHaveBeenLastCalledWith("/vault/Gjøremål/Delta.md", expect.stringContaining("## New section"));
  expect(host.querySelector(".tasks-section-heading h4")?.textContent).toBe("New section");
  await click(host.querySelector<HTMLButtonElement>(".tasks-category-add")!);
  await key(host.querySelector<HTMLInputElement>(".tasks-category-name-edit input")!, "Escape");
  expect(host.querySelector(".tasks-category-name-edit input")).toBeNull();
});

it.each([false, true])("reorders categories before and after another row (horizontal=%s)", async (horizontal) => {
  const data = new Map<string, string>();
  const dataTransfer = { types: [] as string[], setData: (type: string, value: string) => { data.set(type, value); dataTransfer.types.push(type); }, getData: (type: string) => data.get(type) ?? "", effectAllowed: "", dropEffect: "" };
  const dispatch = async (element: HTMLElement, type: string, coordinate: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: coordinate, clientY: coordinate });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    await act(async () => element.dispatchEvent(event));
  };
  const target = category("Gamma").parentElement!;
  target.parentElement!.style.display = horizontal ? "flex" : "block";
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, width: 100, height: 100 } as DOMRect);
  await dispatch(category("Alpha"), "dragstart", 0);
  await dispatch(target, "dragover", 90);
  expect(target.className).toContain("drop-after");
  await dispatch(target, "drop", 90);
  expect(useEditorSettingsStore.getState().taskSettings.categoryOrder).toEqual(["Beta", "Gamma", "Alpha"]);
  const beta = category("Beta").parentElement!;
  vi.spyOn(beta, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, width: 100, height: 100 } as DOMRect);
  await dispatch(category("Alpha"), "dragstart", 0);
  await dispatch(beta, "dragover", 10); await dispatch(beta, "drop", 10);
  expect(useEditorSettingsStore.getState().taskSettings.categoryOrder).toEqual(["Alpha", "Beta", "Gamma"]);
});

it("renames a section in its heading using the section menu", async () => {
  await click(category("Alpha"));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="tasks.sectionMoreActions"]')!);
  const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "tasks.renameCategoryAction")!;
  expect(rename).toBeTruthy();
  await click(rename);
  const input = host.querySelector<HTMLInputElement>(".tasks-section-heading input")!;
  expect(input).toBeTruthy();
  expect(document.activeElement).toBe(input);
  await type(input, "Renamed"); await key(input, "Enter");
  expect(persist).toHaveBeenLastCalledWith("/vault/Gjøremål/Alpha.md", expect.stringContaining("## Renamed\n- [ ] Task"));
});

it("adds a task directly under a section and focuses the new row", async () => {
  await click(category("Alpha"));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="tasks.sectionMoreActions"]')!);
  const add = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "tasks.newTask")!;
  await click(add);
  const markdown = persist.mock.lastCall?.[1] as string;
  expect(markdown).toMatch(/## Existing[\s\S]*- \[ \] tasks.newTask/);
  expect(host.querySelectorAll<HTMLInputElement>(".tasks-item__text")).toHaveLength(2);
  expect((document.activeElement as HTMLInputElement)?.value).toBe("tasks.newTask");
});
