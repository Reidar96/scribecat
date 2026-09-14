import { devices, expect, test, type Page } from "@playwright/test";

/**
 * The phone and tablet layouts of the web app (stage 3c), with touch: the
 * sidebar as a sheet, the context menu behind the row's "…" button, "Move
 * to…" instead of drag and drop, the chat as a sheet, the save button in the
 * header, typing with the toolbar at the bottom, and the settings dialog as a
 * full-screen sheet. Each block emulates one device (viewport, touch, user
 * agent); the layout itself only looks at the viewport width, so a narrow
 * desktop window behaves the same.
 *
 * The chat test needs the scripted model of the e2e stack
 * (docker-compose.e2e.yml), like agent.spec.ts.
 */

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("scribedog-language", "en");
    window.localStorage.setItem(
      "scribedog-ai-settings",
      JSON.stringify({ provider: "openai", apiUrl: "https://llm.e2e.internal", model: "mock-model" })
    );
  });
});

function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function readOnServer(page: Page, path: string): Promise<string> {
  const response = await page.request.get(`${basePath(page)}/api/fs/text?path=${encodeURIComponent(path)}`);
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { content: string }).content;
}

async function writeOnServer(page: Page, path: string, content: string): Promise<void> {
  const response = await page.request.put(`${basePath(page)}/api/fs/text`, { data: { path, content } });
  expect(response.ok()).toBe(true);
}

async function removeOnServer(page: Page, path: string): Promise<void> {
  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path } });
}

const treeRow = (page: Page, title: string) => page.getByRole("treeitem").and(page.getByTitle(title, { exact: true }));

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}

/** Opens a note through the tree; folders start collapsed. */
async function openNote(page: Page, relativePath: string): Promise<void> {
  const segments = relativePath.split("/");

  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = treeRow(page, segments.slice(0, depth).join("/"));

    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.tap();
    }
  }

  await treeRow(page, relativePath).tap();
  await expect(page.getByTestId("note-title")).toHaveText(relativePath);
}

const SEED = "# Roadmap\n\nSeeded by the mobile e2e run.\n";

/** A device preset without the browser choice, which cannot change per describe block. */
function device(name: string) {
  const { defaultBrowserType: _browser, ...options } = devices[name];

  return options;
}

test.describe("phone (Pixel 7)", () => {
  test.use(device("Pixel 7"));

  test("the file list is a sheet: open by itself without a note, closed by choosing one, back via the header", async ({ page }) => {
    await signIn(page);
    await writeOnServer(page, NOTE, SEED);

    // No note open: the sheet is already there, since the list is the only
    // thing to do at this point.
    const sheet = page.getByRole("dialog", { name: "Markdown files" });
    await expect(sheet).toBeVisible();

    await openNote(page, NOTE);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("editor")).toContainText("Seeded by the mobile e2e run.");

    // The desktop's docked column is not there, the header button is.
    await expect(page.locator(".workspace-grid > .sidebar-panel")).toHaveCount(0);
    await page.getByTestId("open-sidebar").tap();
    await expect(sheet).toBeVisible();
    await page.getByTestId("sidebar-close").tap();
    await expect(sheet).toHaveCount(0);

    // A reload (which is what returning to the browser on a phone often is)
    // lands on the same note, so the sheet stays closed.
    await page.reload();
    await expect(page.getByTestId("note-title")).toHaveText(NOTE);
    await expect(sheet).toHaveCount(0);

    // Not once the note is gone.
    await removeOnServer(page, NOTE);
    await page.reload();
    await expect(sheet).toBeVisible();
    await writeOnServer(page, NOTE, SEED);
  });

  test("typing with the toolbar at the bottom, then saving through the header button", async ({ page }) => {
    await signIn(page);
    await writeOnServer(page, NOTE, SEED);
    await openNote(page, NOTE);

    const editor = page.locator(".ProseMirror");
    await editor.locator("p").first().tap();
    await expect(editor).toHaveClass(/ProseMirror-focused/);
    await page.keyboard.press("End");
    await page.keyboard.type(" Typed on a phone.");

    // The toolbar sits below the editor now.
    const toolbarBox = await page.locator(".editor-toolbar").boundingBox();
    const editorBox = await editor.boundingBox();
    expect(toolbarBox && editorBox && toolbarBox.y > editorBox.y).toBe(true);

    // Bold through the bottom toolbar, on the word just typed.
    await page.keyboard.press("Shift+Home");
    await page.getByRole("button", { name: "Bold", exact: true }).tap();

    const status = page.getByTestId("status");
    await expect(status).toHaveText("Save");
    await status.tap();
    await expect(status).toHaveText("Saved");

    const saved = await readOnServer(page, NOTE);
    expect(saved).toContain("Typed on a phone.");
    expect(saved).toContain("**");
  });

  test("the row's more button opens the context menu as a sheet; Move to… moves the note", async ({ page }) => {
    await signIn(page);
    await writeOnServer(page, NOTE, SEED);
    // Leftovers of a failed earlier run would make the move refuse ("name
    // taken") while the check below still finds the file.
    await removeOnServer(page, "Projects/Mobile move.md");
    await writeOnServer(page, "Mobile move.md", "# Mobile move\n");
    await page.reload();
    await expect(page.getByTestId("logout")).toBeVisible();

    const row = treeRow(page, "Mobile move.md");
    await expect(row).toBeVisible();
    // The "…" belongs to the row's list item, next to the row button.
    await row.locator("xpath=..").getByTestId("row-more").tap();

    const menu = page.getByRole("menu", { name: "Mobile move.md" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/file-tree-context-menu--sheet/);
    await menu.getByRole("menuitem", { name: "Move to…" }).tap();

    const dialog = page.getByRole("dialog", { name: /Move “Mobile move.md”/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option", { name: "Projects" }).tap();
    await dialog.getByTestId("move-confirm").tap();
    await expect(dialog).toHaveCount(0);

    expect(await readOnServer(page, "Projects/Mobile move.md")).toBe("# Mobile move\n");
    await expect(treeRow(page, "Mobile move.md")).toHaveCount(0);
    // Into a collapsed folder: the row shows once that folder is opened.
    await treeRow(page, "Projects").tap();
    await expect(treeRow(page, "Projects/Mobile move.md")).toBeVisible();

    await removeOnServer(page, "Projects/Mobile move.md");
  });

  test("the chat opens from the header as a full-screen sheet and answers", async ({ page }) => {
    await signIn(page);
    await writeOnServer(page, NOTE, SEED);
    const stored = await page.request.put(`${basePath(page)}/api/secrets/openai`, { data: { value: "sk-mock" } });
    expect(stored.ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId("logout")).toBeVisible();
    await openNote(page, NOTE);

    await page.getByTestId("open-chat").tap();
    const sheet = page.getByRole("dialog", { name: "AI chat" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && Math.round(box.width) === viewport.width).toBe(true);

    await sheet.getByPlaceholder(/Write a message/).fill("e2e:echo phone");
    await sheet.getByRole("button", { name: "Send", exact: true }).tap();
    await expect(sheet.locator(".chat-message--assistant").filter({ hasText: "Mock reply to: e2e:echo phone" })).toBeVisible({
      timeout: 15_000
    });

    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("phone (iPhone 14)", () => {
  test.use(device("iPhone 14"));

  test("settings fill the screen and save", async ({ page }) => {
    await signIn(page);

    // The settings button is in the sidebar, which is the sheet here.
    await page.getByTestId("settings").tap();
    const panel = page.locator(".ai-dialog__panel--settings");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && Math.round(box.width) === viewport.width).toBe(true);

    // Two tabs deep, then back to one that saves: the tab strip scrolls
    // sideways on this width, and the actions stay put at the bottom.
    await page.getByTestId("settings-tab-account").tap();
    await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
    await page.getByRole("tab", { name: "General" }).tap();
    await page.getByRole("button", { name: "Save", exact: true }).tap();
    await expect(panel).toHaveCount(0);
  });
});

test.describe("tablet (iPad Mini)", () => {
  test.use(device("iPad Mini"));

  test("the file list stays docked, the chat is a side sheet next to the editor", async ({ page }) => {
    await signIn(page);
    await writeOnServer(page, NOTE, SEED);
    await page.reload();
    await expect(page.getByTestId("logout")).toBeVisible();

    await expect(page.locator(".workspace-grid > .sidebar-panel")).toBeVisible();
    await expect(page.getByTestId("open-sidebar")).toHaveCount(0);
    await openNote(page, NOTE);

    await page.getByTestId("open-chat").tap();
    const sheet = page.getByRole("dialog", { name: "AI chat" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    const viewport = page.viewportSize();
    // Narrower than the screen, flush with its right edge; the tree on the
    // left stays in use.
    expect(box && viewport && box.width < viewport.width && Math.round(box.x + box.width) === viewport.width).toBe(true);
    await expect(treeRow(page, NOTE)).toBeVisible();

    // The touch layer applies regardless of width: the rows carry the "…".
    await expect(treeRow(page, NOTE).locator("xpath=..").getByTestId("row-more")).toBeVisible();
  });
});
