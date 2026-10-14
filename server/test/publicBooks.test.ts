import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

describe("public books", () => {
  let context: TestContext;
  beforeEach(async () => { context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }); });
  afterEach(async () => { await context.cleanup(); });

  it("shows only opted-in published books without private notes", async () => {
    const folder = path.join(context.vaultPath, "Bøker", "Eksempel");
    await mkdir(path.join(folder, "_attachments"), { recursive: true });
    await writeFile(path.join(context.vaultPath, ".scribecat", "plugins.json"), JSON.stringify({ plugins: { books: { enabled: true, publicView: false, folder: "Bøker" } } }));
    await writeFile(path.join(folder, "Eksempel.md"), `---\nscribecat-plugin: books\ntype: book\ntitle: Eksempel\nslug: eksempel\nauthor: Forfatter\ncategory: Roman\nstatus: finished\nstarted: 2026-10-01\npublished: true\ncover: _attachments/omslag.jpg\n---\n\n# Eksempel\n\n## Oppsummering\n\nOffentlig omtale.\n\n## Høydepunkter\n\n- Et godt sitat.\n\n## Mine tanker\n\nHEMMELIG notat.\n`);
    await writeFile(path.join(folder, "_attachments", "omslag.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect((await context.app.inject({ method: "GET", url: "/anna/boker/eksempel" })).statusCode).toBe(404);
    await writeFile(path.join(context.vaultPath, ".scribecat", "plugins.json"), JSON.stringify({ plugins: { books: { enabled: true, publicView: true, folder: "Bøker" } } }));
    const index = await context.app.inject({ method: "GET", url: "/anna/boker?q=eksempel" });
    expect(index.body).toContain("Eksempel");
    const detail = await context.app.inject({ method: "GET", url: "/anna/boker/eksempel" });
    expect(detail.body).toContain("Offentlig omtale");
    expect(detail.body).toContain("Et godt sitat");
    expect(detail.body).toContain("Lesestatus</dt><dd>Lest");
    expect(detail.body).toContain("Startet</dt><dd>2026-10-01");
    expect(detail.body).toContain('aria-label="Åpne eller lukk sidemeny"');
    expect(detail.body).not.toContain("HEMMELIG");
    const token = /eksempel\/media\/([a-f0-9]{32})/.exec(detail.body)?.[1];
    expect(token).toBeTruthy();
    expect((await context.app.inject({ method: "GET", url: `/anna/boker/eksempel/media/${token}` })).statusCode).toBe(200);
    const author = await context.app.inject({ method: "GET", url: "/anna/boker/oversikt/forfatter/Forfatter" });
    expect(author.statusCode).toBe(200);
    expect(author.body).toContain('href="../../eksempel"');
    expect((await context.app.inject({ method: "GET", url: "/anna/boker/statistikk" })).body).toContain("<span>Bøker</span><strong>1</strong>");
  });
});
