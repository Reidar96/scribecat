import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

/** Path prefix the instance runs under, derived from the configured base URL. */
function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}

test("rejects a wrong password", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("password").fill("definitely-not-it");
  await page.getByTestId("login").click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password.");
  await expect(page.getByTestId("logout")).toHaveCount(0);
});

const SEED = ["# Roadmap", "", "- [x] ship stage one", "- [x] write tests", "", "Seeded by the e2e run.", ""].join("\n");

test("login, list, open, edit in TipTap, save, reload, logout", async ({ page, context }) => {
  await signIn(page);

  // Known starting content, written through the API the UI itself uses.
  const seeded = await page.request.put(`${basePath(page)}/api/files/content`, { data: { path: NOTE, content: SEED } });
  expect(seeded.ok()).toBe(true);

  // The session cookie is scoped to the base path, not the whole host.
  const cookie = (await context.cookies()).find((entry) => entry.name === "scribedog_session");
  expect(cookie).toBeDefined();
  expect(cookie?.path).toBe(basePath(page) || "/");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  // File list from the vault.
  const files = page.getByTestId("file");
  await expect(files.filter({ hasText: NOTE })).toHaveCount(1);

  // Open a note; the editor shows its rendered markdown.
  await files.filter({ hasText: NOTE }).click();
  await expect(page.getByTestId("note-title")).toContainText(NOTE);
  const editor = page.getByTestId("editor");
  await expect(editor.locator("h1")).toHaveText("Roadmap");
  await expect(page.getByTestId("save")).toBeDisabled();
  // The editor autofocuses right after it mounts; a click that lands before
  // that would be overridden by it, so wait for the focus first.
  await expect(editor).toHaveClass(/ProseMirror-focused/);

  // Edit inside TipTap: type at the end of the last paragraph.
  const marker = `Edited in the browser at ${new Date().toISOString()}`;
  const lastParagraph = editor.locator("p").last();
  await expect(lastParagraph).toHaveText("Seeded by the e2e run.");
  await lastParagraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await expect(lastParagraph).toHaveText(`Seeded by the e2e run. ${marker}`);
  await expect(page.getByTestId("save")).toBeEnabled();

  // Save with the shortcut, then confirm through the API that the markdown
  // on disk contains the new paragraph.
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status")).toHaveText("Saved.");
  await expect(page.getByTestId("save")).toBeDisabled();

  const saved = await page.request.get(`${basePath(page)}/api/files/content?path=${encodeURIComponent(NOTE)}`);
  expect(saved.ok()).toBe(true);
  const body = (await saved.json()) as { content: string };
  expect(body.content).toContain(marker);
  expect(body.content.startsWith("# Roadmap")).toBe(true);

  // A reload keeps the session (cookie) and shows the saved content again.
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();
  await files.filter({ hasText: NOTE }).click();
  await expect(editor).toContainText(marker);

  // Logout drops the cookie and brings the login form back.
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("password")).toBeVisible();
  expect((await context.cookies()).find((entry) => entry.name === "scribedog_session")).toBeUndefined();

  const afterLogout = await page.request.get(`${basePath(page)}/api/files`);
  expect(afterLogout.status()).toBe(401);
});

test("bare host root answers 404 when a base path is configured", async ({ page, baseURL }) => {
  test.skip(new URL(baseURL ?? "https://localhost/").pathname === "/", "instance runs at the root");

  const root = new URL("/", baseURL);
  const response = await page.request.get(root.toString());
  expect(response.status()).toBe(404);
});
