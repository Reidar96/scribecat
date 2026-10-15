import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

describe("public shopping", () => {
  let context: TestContext;
  beforeEach(async () => { context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }); });
  afterEach(async () => { await context.cleanup(); });
  async function configure(enabled = true) {
    await mkdir(path.join(context.vaultPath, "Handlelister"), { recursive: true });
    await writeFile(path.join(context.vaultPath, ".scribecat", "plugins.json"), JSON.stringify({ plugins: { shopping: { enabled: true, publicView: enabled, folder: "Handlelister" } } }));
    await writeFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "---\nscribecat-plugin: shopping\ntype: shopping-list\ntitle: Uke\nslug: uke\npublished: true\n---\n\n# Uke\n\n## Kjøl\n\n- [ ] Melk\n");
    await writeFile(path.join(context.vaultPath, "Handlelister", "Privat.md"), "---\nscribecat-plugin: shopping\ntype: shopping-list\ntitle: Privat\nslug: privat\npublished: false\n---\n\n# Privat\n\n## Annet\n");
  }
  it("serves only published lists when public view is enabled", async () => {
    await configure(false);
    expect((await context.app.inject({ method: "GET", url: "/anna/handleliste/uke" })).statusCode).toBe(404);
    await configure();
    expect((await context.app.inject({ method: "GET", url: "/anna/handleliste/uke" })).body).toContain("Melk");
    expect((await context.app.inject({ method: "GET", url: "/anna/handleliste/privat" })).statusCode).toBe(404);
  });
  it("limits writes to adding and checking items in a published list", async () => {
    await configure();
    const url = "/anna/handleliste/uke/items";
    expect((await context.app.inject({ method: "POST", url, payload: "item=Ost&category=Kj%C3%B8l", headers: { "content-type": "application/x-www-form-urlencoded" } })).statusCode).toBe(403);
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", host: "localhost" };
    expect((await context.app.inject({ method: "POST", url, payload: "item=Feil&category=Kj%C3%B8l", headers: { ...headers, origin: "https://unrelated.example" } })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "POST", url, payload: "item=Ost&category=Kj%C3%B8l", headers })).statusCode).toBe(303);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8")).toContain("- [ ] Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/toggle", payload: "index=0", headers })).statusCode).toBe(303);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8")).toContain("- [x] Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/privat/items", payload: "item=Hemmelig&category=Annet", headers })).statusCode).toBe(400);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Privat.md"), "utf8")).not.toContain("Hemmelig");
  });
  it("lets a public visitor create a category without overwriting the Markdown list", async () => {
    await configure();
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", host: "localhost" };
    const url = "/anna/handleliste/uke/categories";
    expect((await context.app.inject({ method: "POST", url, payload: "category=Frukt", headers })).statusCode).toBe(303);
    expect((await context.app.inject({ method: "POST", url, payload: "category=Frukt", headers })).statusCode).toBe(400);
    expect((await context.app.inject({ method: "POST", url, payload: "category=%23Hemmelig", headers })).statusCode).toBe(400);
    const markdown = await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8");
    expect(markdown).toContain("## Kjøl\n\n- [ ] Melk");
    expect(markdown).toContain("## Frukt");
  });
  it("deletes a chosen public item or category without changing the others", async () => {
    await configure();
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", host: "localhost" };
    const file = path.join(context.vaultPath, "Handlelister", "Uke.md");
    await writeFile(file, (await readFile(file, "utf8")) + "- [ ] Ost\n\n## Frukt\n\n- [ ] Eple\n");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/delete-item", payload: "index=0", headers })).statusCode).toBe(303);
    expect(await readFile(file, "utf8")).not.toContain("Melk");
    expect(await readFile(file, "utf8")).toContain("Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/delete-category", payload: "category=Frukt", headers })).statusCode).toBe(303);
    const markdown = await readFile(file, "utf8");
    expect(markdown).not.toContain("Frukt");
    expect(markdown).not.toContain("Eple");
    expect(markdown).toContain("## Kjøl");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/delete-item", payload: "index=40", headers })).statusCode).toBe(400);
  });
  it("renames a category without losing its items and shows lists in navigation", async () => {
    await configure();
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", host: "localhost" };
    const url = "/anna/handleliste/uke/rename-category";
    expect((await context.app.inject({ method: "POST", url, payload: "category=Kj%C3%B8l&name=Meieri", headers })).statusCode).toBe(303);
    expect((await context.app.inject({ method: "POST", url, payload: "category=Meieri&name=%23Bad", headers })).statusCode).toBe(400);
    const markdown = await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8");
    expect(markdown).toContain("## Meieri\n\n- [ ] Melk");
    expect(markdown).not.toContain("## Kjøl");
    const page = (await context.app.inject({ method: "GET", url: "/anna/handleliste/uke" })).body;
    expect(page).toContain('href="../handleliste/uke"');
    expect(page).toContain('action="uke/rename-category"');
  });
  it("renders category editing inline and puts completed items below active items", async () => {
    await configure();
    const file = path.join(context.vaultPath, "Handlelister", "Uke.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("- [ ] Melk", "- [ ] Melk\n- [x] Brød"));
    const page = (await context.app.inject({ method: "GET", url: "/anna/handleliste/uke" })).body;
    expect(page).toContain('class="public-category-title"');
    expect(page).toContain('aria-label="Lagre kategorinavn"');
    expect(page).toContain('aria-label="Slett kategorien Kjøl"');
    expect(page.indexOf("Melk")).toBeLessThan(page.indexOf("Fullført (1)"));
    expect(page.indexOf("Fullført (1)")).toBeLessThan(page.indexOf("Brød"));
  });
  it("renames one item inline without changing its completed state or neighboring items", async () => {
    await configure();
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", host: "localhost" };
    const file = path.join(context.vaultPath, "Handlelister", "Uke.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("- [ ] Melk", "- [x] Melk\n- [ ] Ost"));
    const before = (await context.app.inject({ method: "GET", url: "/anna/handleliste/uke" })).body;
    expect(before).toContain('action="uke/rename-item"');
    expect(before).toContain('aria-label="Navn på vare: Melk"');
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/rename-item", payload: "index=0&name=Kefir", headers })).statusCode).toBe(303);
    const markdown = await readFile(file, "utf8");
    expect(markdown).toContain("- [x] Kefir\n- [ ] Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/rename-item", payload: "index=1&name=%23+Overskrift", headers })).statusCode).toBe(303);
    expect(await readFile(file, "utf8")).toContain("- [ ] # Overskrift");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/rename-item", payload: "index=0&name=Feil%0ANavn", headers })).statusCode).toBe(400);
  });
});
