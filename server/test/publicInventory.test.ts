import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    await writeFile(path.join(context.vaultPath, "Inventar", "Sykkel.md"), `---\nscribecat-plugin: inventory\ntype: item\nname: Sykkel\nslug: sykkel\ncategory: Sport\nlocation: Bod\nserial-number: HEMMELIG\npublished: true\ncover: _attachments/sykkel.jpg\n---\n\n# Sykkel\n\n## Bilder\n\n![Sykkel](_attachments/sykkel.jpg)\n\n## Beskrivelse\n\nEn fin sykkel.\n\n## Notater\n\nPrivat notat.\n`);
    await writeFile(path.join(context.vaultPath, "Inventar", "Skjult.md"), `---\nscribecat-plugin: inventory\ntype: item\nname: Skjult\nslug: skjult\npublished: false\n---\n`);
    await writeFile(path.join(context.vaultPath, "Inventar", "_attachments", "sykkel.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  it("shows all fields for opted-in published items without exposing unpublished items", async () => {
    await configure(false);
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" })).statusCode).toBe(404);
    await configure();
    const index = await context.app.inject({ method: "GET", url: "/anna/inventar" });
    expect(index.body).toContain("Sykkel");
    expect(index.body).not.toContain("Skjult");
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar?q=ukjent" })).body).not.toContain("Sykkel");
    const detail = await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" });
    expect(detail.body).toContain("En fin sykkel");
    expect(detail.body).toContain("HEMMELIG");
    expect(detail.body).toContain("Privat notat");
    expect(detail.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(detail.body.match(/\.public-inventory-gallery\{/g)).toHaveLength(1);
    expect(detail.body.indexOf(".public-inventory-gallery{")).toBeLessThan(detail.body.indexOf("</style>"));
    expect(detail.body.slice(detail.body.indexOf("</style>") + 8)).not.toContain(".public-inventory-gallery{");
    const token = /sykkel\/media\/([a-f0-9]{32})/.exec(detail.body)?.[1];
    expect(token).toBeTruthy();
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/media/${token}` })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/media/${"0".repeat(32)}` })).statusCode).toBe(404);
    const categoryOverview = await context.app.inject({ method: "GET", url: "/anna/inventar/oversikt/kategori" });
    const overviewMedia = /src="\.\.\/(sykkel\/media\/[a-f0-9]{32})"/.exec(categoryOverview.body)?.[1];
    expect(overviewMedia).toBeTruthy();
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/${overviewMedia}` })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar/oversikt/kategori/Sport" })).body).toContain("Sykkel");
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar/statistikk" })).body).toContain("<span>Gjenstander</span><strong>1</strong>");
    expect(index.body).toContain('href="inventar/oversikt/plassering"');
  });
  it("uses a balanced inventory cover placeholder when no image exists", async () => {
    await configure();
    const file = path.join(context.vaultPath, "Inventar", "Sykkel.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("cover: _attachments/sykkel.jpg\n", "").replace(/\n## Bilder[\s\S]*?(?=\n## Beskrivelse)/, ""));
    const page = (await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" })).body;
    expect(page).toContain("public-detail--inventory");
    expect(page).toContain("public-inventory-placeholder");
    expect(page).toContain("public-inventory-copy");
    expect(page).not.toContain("<dl class=\"public-facts\"></dl>");
  });
  it("uses only Markdown-listed images and exposes a browsable gallery", async () => {
    await configure();
    const attachments = path.join(context.vaultPath, "Inventar", "_attachments");
    await writeFile(path.join(attachments, "bilde-002.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(path.join(attachments, "miniatyr-002.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const file = path.join(context.vaultPath, "Inventar", "Sykkel.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("![Sykkel](_attachments/sykkel.jpg)", "![Sykkel](_attachments/sykkel.jpg)\n\n![Bilde 2](_attachments/bilde-002.jpg)"));
    const detail = await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" });
    expect(detail.body.match(/data-gallery-image=/g)).toHaveLength(2);
    expect(detail.body).toContain("public-inventory-gallery__main");
    expect(detail.body).toContain("public-inventory-gallery__thumbs");
    expect(detail.body).not.toContain("miniatyr-002");
    expect(detail.body).toContain("public-gallery-next");
    expect(detail.headers["content-security-policy"]).toContain("script-src 'self'");
    expect((await context.app.inject({ method: "GET", url: "/anna/inventar/gallery.js" })).statusCode).toBe(200);
  });
  it("offers every published receipt as a validated download", async () => {
    await configure();
    const folder = path.join(context.vaultPath, "Inventar");
    const file = path.join(folder, "Sykkel.md");
    await writeFile(file, (await readFile(file, "utf8")) + "\n## Kvitteringer\n\n- [Sykkelkjøp.pdf](_attachments/en.pdf)\n- _attachments/to.jpg\n");
    await writeFile(path.join(folder, "_attachments", "en.pdf"), Buffer.from("%PDF-1.4"));
    await writeFile(path.join(folder, "_attachments", "to.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const detail = await context.app.inject({ method: "GET", url: "/anna/inventar/sykkel" });
    expect(detail.body).toContain("Sykkelkjøp.pdf");
    expect(detail.body).toContain("to.jpg");
    const tokens = [...detail.body.matchAll(/sykkel\/kvittering\/([a-f0-9]{32})/g)].map((match) => match[1]);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      const response = await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/kvittering/${token}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-disposition"]).toContain("attachment;");
    }
    const renamed = await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/kvittering/${tokens[0]}` });
    expect(renamed.headers["content-disposition"]).toContain(encodeURIComponent("Sykkelkjøp.pdf"));
    expect((await context.app.inject({ method: "GET", url: `/anna/inventar/sykkel/kvittering/${"0".repeat(32)}` })).statusCode).toBe(404);
  });
});
