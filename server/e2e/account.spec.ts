import { expect, test, type Page } from "@playwright/test";

/**
 * The account side of the server edition: changing the password (which ends
 * every other session) and storing an API key, which the server keeps to
 * itself.
 *
 * These tests change instance-wide state, which is why the whole suite runs
 * with a single worker (see playwright.config.ts). Each test puts the
 * password back, and the hook below catches the case where one failed
 * halfway through.
 */

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const NEW_PASSWORD = "e2e-changed-password";

let currentPassword = PASSWORD;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("scribedog-language", "en");
  });
});

test.afterEach(async ({ page }) => {
  if (currentPassword === PASSWORD) {
    return;
  }

  await page.request.post(`${basePath(page)}/api/auth/password`, {
    data: { currentPassword, newPassword: PASSWORD }
  });
  currentPassword = PASSWORD;
});

function basePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/$/, "");
}

async function signIn(page: Page, password = currentPassword): Promise<void> {
  await page.goto("./");
  await page.getByTestId("password").fill(password);
  await page.getByTestId("login").click();
  await expect(page.getByTestId("logout")).toBeVisible();
}

async function openSettings(page: Page, tab: string): Promise<void> {
  await page.getByTestId("settings").click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}

test("changing the password signs other devices out and keeps this one", async ({ page, browser }) => {
  await signIn(page);

  // A second device, signed in before the change.
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const other = await otherContext.newPage();
  await other.addInitScript(() => window.localStorage.setItem("scribedog-language", "en"));
  await signIn(other);

  await openSettings(page, "Account");
  await page.getByTestId("current-password").fill(PASSWORD);
  await page.getByTestId("new-password").fill(NEW_PASSWORD);
  await page.getByTestId("repeat-password").fill(NEW_PASSWORD);
  await page.getByTestId("change-password").click();
  await expect(page.getByTestId("password-changed")).toBeVisible();
  currentPassword = NEW_PASSWORD;

  // This tab keeps working: it got fresh cookies with the change.
  expect((await page.request.get(`${basePath(page)}/api/files`)).status()).toBe(200);

  // The other one is out, and the old password no longer opens the door.
  expect((await other.request.get(`${basePath(other)}/api/files`)).status()).toBe(401);
  await other.goto("./");
  await other.getByTestId("password").fill(PASSWORD);
  await other.getByTestId("login").click();
  await expect(other.getByRole("alert")).toHaveText("Wrong password.");

  // The new one does.
  await other.getByTestId("password").fill(NEW_PASSWORD);
  await other.getByTestId("login").click();
  await expect(other.getByTestId("logout")).toBeVisible();

  await otherContext.close();
});

test("a wrong current password is refused", async ({ page }) => {
  await signIn(page);
  await openSettings(page, "Account");

  await page.getByTestId("current-password").fill("not the password");
  await page.getByTestId("new-password").fill(NEW_PASSWORD);
  await page.getByTestId("repeat-password").fill(NEW_PASSWORD);
  await page.getByTestId("change-password").click();

  await expect(page.getByRole("alert")).toHaveText("The current password is wrong.");
  expect((await page.request.get(`${basePath(page)}/api/files`)).status()).toBe(200);
});

test("an API key is stored on the server and never handed back", async ({ page }) => {
  await signIn(page);
  await openSettings(page, "AI settings");

  await page.getByLabel("Provider").selectOption("openai");

  const key = `sk-e2e-${Date.now()}`;

  await page.getByTestId("api-key").fill(key);
  await page.getByRole("button", { name: "Save" }).click();

  // Reopening shows that a key is stored, without showing the key.
  await openSettings(page, "AI settings");
  await expect(page.getByTestId("api-key")).toHaveValue("");
  await expect(page.getByTestId("api-key")).toHaveAttribute("placeholder", /Stored/);

  // And the API says the same: an id, no value, anywhere in the answer.
  const status = await page.request.get(`${basePath(page)}/api/secrets`);
  const body = await status.text();

  expect(status.ok()).toBe(true);
  expect(body).toContain("openai");
  expect(body).not.toContain(key);

  // Clean up so a repeated run starts from the same place.
  await page.request.delete(`${basePath(page)}/api/secrets/openai`);
});

test("a cross-site write is refused", async ({ page }) => {
  await signIn(page);

  const response = await page.request.put(`${basePath(page)}/api/fs/text`, {
    headers: { origin: "https://evil.example" },
    data: { path: "Welcome.md", content: "should not be written" }
  });

  expect(response.status()).toBe(403);
});
