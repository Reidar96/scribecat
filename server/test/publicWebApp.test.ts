import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

describe("public Home Screen apps", () => {
  let context: TestContext;
  beforeEach(async () => { context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }); });
  afterEach(async () => { await context.cleanup(); });

  it.each(["oppskrifter", "boker", "inventar", "handleliste"])("gives %s an independent, scoped standalone manifest on every page", async (route) => {
    const root = `/anna/${route}`;
    const page = await context.app.inject({ method: "GET", url: root });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`href="${root}/manifest.webmanifest"`);
    expect(page.body).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(page.headers["content-security-policy"]).toContain("manifest-src 'self'");
    const manifest = await context.app.inject({ method: "GET", url: `${root}/manifest.webmanifest` });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["content-type"]).toContain("application/manifest+json");
    expect(manifest.json()).toMatchObject({ id: root, start_url: root, scope: root, display: "standalone" });
    expect((await context.app.inject({ method: "GET", url: `${root}/icon.svg` })).statusCode).toBe(200);
  });
});
