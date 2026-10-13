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
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost" };
    expect((await context.app.inject({ method: "POST", url, payload: "item=Ost&category=Kj%C3%B8l", headers })).statusCode).toBe(303);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8")).toContain("- [ ] Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/uke/toggle", payload: "index=0", headers })).statusCode).toBe(303);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Uke.md"), "utf8")).toContain("- [x] Ost");
    expect((await context.app.inject({ method: "POST", url: "/anna/handleliste/privat/items", payload: "item=Hemmelig&category=Annet", headers })).statusCode).toBe(400);
    expect(await readFile(path.join(context.vaultPath, "Handlelister", "Privat.md"), "utf8")).not.toContain("Hemmelig");
  });
});
