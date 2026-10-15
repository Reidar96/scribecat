import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers.js";

describe("public recipes", () => {
  let context: TestContext;
  beforeEach(async () => { context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }); });
  afterEach(async () => { await context.cleanup(); });
  const get = (context: TestContext, route: string) => context.app.inject({ method: "GET", url: `/anna/public/recipes${route}` });

  async function configure(context: TestContext, publicView = true) {
    await mkdir(path.join(context.vaultPath, "Oppskrifter", "_attachments"), { recursive: true });
    await writeFile(path.join(context.vaultPath, ".scribecat", "plugins.json"), JSON.stringify({ plugins: { recipes: { enabled: true, publicView, folder: "Oppskrifter" } } }));
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "Focaccia.md"),
      `---\nscribecat-plugin: recipes\ntype: recipe\ntitle: Focaccia\nslug: focaccia\npublished: true\nservings: 6\n---\n\n# Focaccia\n\n## Ingredienser\n\n- Mel\n\n[hemmelig](../Notes/Idea.md)\n\n![Brød](_attachments/bread.jpg)\n`);
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "Hemmelig.md"),
      `---\nscribecat-plugin: recipes\ntype: recipe\ntitle: Hemmelig\nslug: hemmelig\npublished: false\n---\n\n# Hemmelig\n`);
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "_attachments", "bread.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "_attachments", "private.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  it("requires both plugin opt-in and explicit document publication", async () => {
    await configure(context, false);
    expect((await get(context, "/focaccia")).statusCode).toBe(404);
    await configure(context);
    const index = await get(context, "");
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("Focaccia");
    expect((await context.app.inject({ method: "GET", url: "/anna/oppskrifter" })).body).toContain("Focaccia");
    expect((await context.app.inject({ method: "GET", url: "/anna/oppskrifter/focaccia" })).body).toContain('type="checkbox"');
    expect(index.body).not.toContain("Hemmelig");
    expect((await get(context, "/hemmelig")).statusCode).toBe(404);
    const detail = await get(context, "/focaccia");
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Ingredienser");
    expect(detail.headers["content-security-policy"]).toContain("default-src 'none'");
    expect((await get(context, "/../Notes/Idea.md")).statusCode).toBe(404);
  });

  it("only serves images referenced by a published recipe, even with a guessed token", async () => {
    await configure(context);
    const detail = await get(context, "/focaccia");
    const token = /focaccia\/media\/([a-f0-9]{32})/.exec(detail.body)?.[1];
    expect(token).toBeTruthy();
    const image = await get(context, `/focaccia/media/${token}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/jpeg");
    expect((await get(context, `/hemmelig/media/${token}`)).statusCode).toBe(404);
    expect((await get(context, `/focaccia/media/${"0".repeat(32)}`)).statusCode).toBe(404);
  });

  it("escapes HTML and never turns private Markdown links into public links", async () => {
    await configure(context);
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "Focaccia.md"),
      `---\nscribecat-plugin: recipes\ntype: recipe\ntitle: Focaccia\nslug: focaccia\npublished: true\n---\n\n<script>alert(1)</script>\n\n[hemmelig](../Notes/Idea.md)\n`);
    const detail = await get(context, "/focaccia");
    expect(detail.body).not.toContain("<script>");
    expect(detail.body).not.toContain("href=\"../Notes/Idea.md\"");
  });

  it("does not choose an arbitrary document when two published recipes share a slug", async () => {
    await configure(context);
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "Duplicate.md"),
      "---\nscribecat-plugin: recipes\ntype: recipe\ntitle: Another\nslug: focaccia\npublished: true\n---\n\n# Another\n");
    expect((await get(context, "/focaccia")).statusCode).toBe(404);
    expect((await get(context, "")).body).not.toContain("Another");
  });

  it("filters the public catalog by search and category", async () => {
    await configure(context);
    await writeFile(path.join(context.vaultPath, "Oppskrifter", "Focaccia.md"),
      `---\nscribecat-plugin: recipes\ntype: recipe\ntitle: Focaccia\nslug: focaccia\ncategory: Bakst\npublished: true\n---\n\n# Focaccia\n\n## Beskrivelse\n\nLuftig brød.\n\n## Ingredienser\n\n- 500 g Mel\n`);
    expect((await get(context, "?q=luftig&category=Bakst")).body).toContain("Focaccia");
    const listing = (await get(context, "?q=luftig&category=Bakst")).body;
    expect(listing).toContain('<strong>Focaccia</strong>');
    expect(listing).not.toContain('<span class="muted">Bakst');
    expect(listing).not.toContain('porsjoner</span>');
    expect((await get(context, "?q=ukjent")).body).not.toContain("<strong>Focaccia</strong>");
    expect((await get(context, "/focaccia")).body).toContain("Luftig brød.");
  });
});
