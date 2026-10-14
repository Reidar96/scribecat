import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

describe("public inventory", () => {
  let context: TestContext;
  beforeEach(async () => { context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }); });
  afterEach(async () => { await context.cleanup(); });

  async function configure(publicView = true) {
    await mkdir(path.join(context.vaultPath, "Inventar", "_attachments"), { recursive: true });
    await writeFile(path.join(context.vaultPath, ".scribecat", "plugins.json"), JSON.stringify({ plugins: { inventory: { enabled: true, publicView, folder: "Inventar" } } }));
    await writeFile(path.join(context.vaultPath, "Inventar", "Sykkel.md"), `---\nscribecat-plugin: inventory\ntype: item\nname: Sykkel\nslug: sykkel\ncategory: Sport\nlocation: Bod\nserial-number: HEMMELIG\npublished: true\ncover: _attachments/sykkel.jpg\n---\n\n# Sykkel\n\n## Beskrivelse\n\nEn fin sykkel.\n\n## Notater\n\nPrivat notat.\n`);
    await writeFile(path.join(context.vaultPath, "Inventar", "Skjult.md"), `---\nscribecat-plugin: inventory\ntype: item\nname: Skjult\nslug: skjult\npublished: false\n---\n`);
    await writeFile(path.join(context.vaultPath, "Inventar", "_attachments", "sykkel.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  it("shows only opted-in published items and only public fields", async () => {
    await configure(false);
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" })).statusCode).toBe(404);
    await configure();
    const index = await context.app.inject({ method: "GET", url: "/anna/inventar" });
    expect(index.body).toContain("Sykkel");
    expect(index.body).not.toContain("Skjult");
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar?q=ukjent" })).body).not.toContain("Sykkel");
    const detail = await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" });
    expect(detail.body).toContain("En fin sykkel");
    expect(detail.body).not.toContain("HEMMELIG");
    expect(detail.body).not.toContain("Privat notat");
    expect(detail.headers["content-security-policy"]).toContain("default-src 'none'");
    const token = /sykkel\/media\/([a-f0-9]{32})/.exec(detail.body)?.[1];
    expect(token).toBeTruthy();
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/media/${token}` })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/media/${"0".repeat(32)}` })).statusCode).toBe(404);
  });
});
