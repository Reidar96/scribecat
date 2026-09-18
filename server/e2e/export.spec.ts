import { expect, test, type Download, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const PASSWORD = process.env.SCRIBEDOG_E2E_PASSWORD ?? "e2e-test-password";
const NOTE = process.env.SCRIBEDOG_E2E_NOTE ?? "Projects/Roadmap.md";

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

const treeRow = (page: Page, title: string) => page.getByRole("treeitem").and(page.getByTitle(title, { exact: true }));

async function expandTo(page: Page, relativePath: string): Promise<void> {
  const segments = relativePath.split("/");

  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = treeRow(page, segments.slice(0, depth).join("/"));

    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.click();
    }
  }
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

const SEED = ["# Roadmap", "", "Exported from the browser.", ""].join("\n");

// Nothing leaves the browser as a file except through these three paths, so
// each one is exercised end to end: the note as the .md it is, the server's
// ZIP of a folder, and a format rendered in the browser.
test("downloads a note as Markdown, a folder as ZIP and a rendered export", async ({ page }) => {
  await signIn(page);

  const seeded = await page.request.put(`${basePath(page)}/api/fs/text`, { data: { path: NOTE, content: SEED } });
  expect(seeded.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("logout")).toBeVisible();
  await expandTo(page, NOTE);

  const noteName = NOTE.split("/").pop()!.replace(/\.md$/i, "");
  const folderPath = NOTE.split("/").slice(0, -1).join("/");
  const folderName = folderPath.split("/").pop()!;

  // 1. The note as Markdown, from the tree's context menu.
  await treeRow(page, NOTE).click({ button: "right" });
  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download as Markdown" }).click();
  const markdown = await markdownDownload;
  expect(markdown.suggestedFilename()).toBe(`${noteName}.md`);
  expect((await downloadBytes(markdown)).toString("utf8")).toBe(SEED);

  // 2. The folder as a ZIP of its raw files, packed by the server.
  await treeRow(page, folderPath).click({ button: "right" });
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download as ZIP (Markdown files)" }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toBe(`${folderName}.zip`);
  const unpacked = unzipSync(new Uint8Array(await downloadBytes(zip)));
  expect(Object.keys(unpacked)).toContain(`${noteName}.md`);
  expect(strFromU8(unpacked[`${noteName}.md`])).toBe(SEED);
  expect(Object.keys(unpacked).some((name) => name.split("/").includes(".scribedog"))).toBe(false);

  // 3. A rendered export through the dialog: no destination to choose, the
  // browser saves the file. HTML is the format whose result can be read here.
  await treeRow(page, NOTE).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export…" }).click();
  const dialog = page.getByRole("dialog", { name: "Export note" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Destination folder")).toHaveCount(0);
  await dialog.getByRole("combobox").selectOption("html");
  const htmlDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  const html = await htmlDownload;
  expect(html.suggestedFilename()).toBe(`${noteName}.html`);
  const rendered = (await downloadBytes(html)).toString("utf8");
  expect(rendered).toContain("<h1");
  expect(rendered).toContain("Exported from the browser.");
  await expect(dialog).toHaveCount(0);

  // 4. The whole vault from the vault name at the top of the sidebar.
  await page.getByTestId("vault-name").click({ button: "right" });
  const vaultDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download as ZIP (Markdown files)" }).click();
  const vault = await vaultDownload;
  expect(vault.suggestedFilename()).toMatch(/\.zip$/);
  const vaultFiles = Object.keys(unzipSync(new Uint8Array(await downloadBytes(vault))));
  expect(vaultFiles).toContain(NOTE);
  expect(vaultFiles.some((name) => name.split("/").includes(".scribedog"))).toBe(false);
});
