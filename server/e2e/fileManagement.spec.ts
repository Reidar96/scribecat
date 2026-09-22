import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("scribedog-language", "en");
  });
});

function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const treeRow = (page: Page, title: string) => page.getByRole("treeitem").and(page.getByTitle(title, { exact: true }));
const fsUrl = (page: Page, route: string, path: string) => `${basePath(page)}/api/fs/${route}?path=${encodeURIComponent(path)}`;

async function existsOnServer(page: Page, path: string): Promise<boolean> {
  const response = await page.request.get(fsUrl(page, "exists", path));
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { exists: boolean }).exists;
}

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test("creates, renames and deletes notes and folders, and stores a dropped image", async ({ page }) => {
  await signIn(page);
  const stamp = Date.now().toString(36);
  const noteName = `Browser note ${stamp}`;
  const renamedName = `Renamed note ${stamp}`;
  const folderName = `Web folder ${stamp}`;

  // New note: the + button creates it and opens the title for renaming. It
  // lands next to whatever the tree had selected; the title shows the
  // vault-relative path, which the rest of the test works with.
  await page.getByRole("button", { name: "New file", exact: true }).click();
  const titleInput = page.getByRole("textbox", { name: "File name" }).first();
  await expect(titleInput).toBeVisible();
  await titleInput.fill(noteName);
  await titleInput.press("Enter");
  await expect(page.getByTestId("note-title")).toHaveText(new RegExp(`${escapeRegExp(noteName)}$`));
  const notePath = `${await page.getByTestId("note-title").textContent()}.md`;
  const folderPrefix = notePath.slice(0, notePath.length - `${noteName}.md`.length);
  const renamedPath = `${folderPrefix}${renamedName}.md`;
  await expect(treeRow(page, notePath)).toBeVisible();

  // Type into it and save; the file is on disk with that content.
  const editor = page.getByTestId("editor");
  await editor.click();
  await expect(editor).toHaveClass(/ProseMirror-focused/);
  await page.keyboard.type("Written in the browser.");
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");
  const created = await page.request.get(fsUrl(page, "text", notePath));
  expect(created.ok()).toBe(true);
  expect(((await created.json()) as { content: string }).content).toContain("Written in the browser.");

  // Drop an image onto the editor: it lands in the note folder's _attachments/ directory.
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();
  await editor.evaluate(
    (element, { bytes, x, y }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], "dot.png", { type: "image/png" }));
      element.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true })
      );
    },
    { bytes: Array.from(PNG), x: box!.x + box!.width / 2, y: box!.y + 20 }
  );
  await expect(editor.locator("img")).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status")).toHaveAttribute("data-dirty", "false");
  const withImage = (await (await page.request.get(fsUrl(page, "text", notePath))).json()) as { content: string };
  const imageRef = /\]\((_attachments\/[^)]+\.png)\)/.exec(withImage.content)?.[1];
  expect(imageRef).toBeTruthy();
  const imagePath = `${folderPrefix}${imageRef}`;
  const stored = await page.request.get(fsUrl(page, "file", imagePath));
  expect(stored.ok()).toBe(true);
  expect(stored.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await stored.body()).equals(PNG)).toBe(true);

  // Rename through the tree's context menu.
  await treeRow(page, notePath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameInput = page.getByRole("textbox", { name: "File name" }).last();
  await renameInput.fill(renamedName);
  await renameInput.press("Enter");
  await expect(treeRow(page, renamedPath)).toBeVisible();
  expect(await existsOnServer(page, renamedPath)).toBe(true);
  expect(await existsOnServer(page, notePath)).toBe(false);

  // New folder, named on creation.
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const folderInput = page.getByRole("textbox", { name: "Folder name" });
  await expect(folderInput).toBeVisible();
  await folderInput.fill(folderName);
  await folderInput.press("Enter");
  const folderRow = page.getByRole("treeitem").and(page.getByTitle(new RegExp(`${escapeRegExp(folderName)}$`)));
  await expect(folderRow).toBeVisible();
  const folderPath = (await folderRow.getAttribute("title")) ?? folderName;
  const folderStat = (await (await page.request.get(fsUrl(page, "stat", folderPath))).json()) as { isDirectory: boolean };
  expect(folderStat.isDirectory).toBe(true);

  // Delete the note through the toolbar and the confirmation dialog. The
  // image it referenced goes with it (orphan cleanup), the folder stays.
  await treeRow(page, renamedPath).click();
  await page.getByRole("button", { name: "Delete file", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(treeRow(page, renamedPath)).toHaveCount(0);
  expect(await existsOnServer(page, renamedPath)).toBe(false);
  await expect.poll(() => existsOnServer(page, imagePath)).toBe(false);

  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path: folderPath, recursive: true } });
});

test("keeps a manual sort order on the server", async ({ page }) => {
  await signIn(page);

  // Manual mode is the default; the order file appears once the tree is
  // reordered. Creating a note is the simplest reorder there is: it is
  // inserted into the order of its folder.
  const stamp = Date.now().toString(36);
  await page.getByRole("button", { name: "New file", exact: true }).click();
  const titleInput = page.getByRole("textbox", { name: "File name" }).first();
  await titleInput.fill(`Ordered ${stamp}`);
  await titleInput.press("Enter");
  const notePath = `${await page.getByTestId("note-title").textContent()}.md`;

  await expect
    .poll(async () => {
      const response = await page.request.get(fsUrl(page, "text", ".scribedog/order.json"));

      return response.ok() ? ((await response.json()) as { content: string }).content : "";
    })
    .toContain(`Ordered ${stamp}.md`);

  await page.request.post(`${basePath(page)}/api/fs/remove`, { data: { path: notePath } });
});

test("shows files that change on the server without a reload", async ({ page, playwright, baseURL }) => {
  await signIn(page);
  const name = `Live ${Date.now().toString(36)}.md`;

  // A second client (another device, a sync tool on the host) writes a note.
  const other = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const login = await other.post("./api/auth/login", { data: { password: PASSWORD } });
  expect(login.ok()).toBe(true);
  const written = await other.put("./api/fs/text", { data: { path: name, content: "# From elsewhere\n" } });
  expect(written.ok()).toBe(true);

  await expect(treeRow(page, name)).toBeVisible({ timeout: 10_000 });

  await other.post("./api/fs/remove", { data: { path: name } });
  await expect(treeRow(page, name)).toHaveCount(0, { timeout: 10_000 });
  await other.dispose();
});
