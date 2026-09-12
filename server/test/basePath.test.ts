import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { ConfigError, loadConfig, normalizeBasePath } from "../src/config.js";
import { BASE_PATH_PLACEHOLDER, renderIndexHtml } from "../src/web/staticSite.js";
import { createTestContext, TEST_PASSWORD, type TestContext } from "./helpers.js";

describe("normalizeBasePath", () => {
  it("treats empty and root as the root", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("   ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("//")).toBe("");
  });

  it("adds the leading slash and strips trailing ones", () => {
    expect(normalizeBasePath("anna")).toBe("/anna");
    expect(normalizeBasePath("/anna")).toBe("/anna");
    expect(normalizeBasePath("/anna/")).toBe("/anna");
    expect(normalizeBasePath("anna/")).toBe("/anna");
    expect(normalizeBasePath("/anna//notes/")).toBe("/anna/notes");
    expect(normalizeBasePath("\\anna\\")).toBe("/anna");
    expect(normalizeBasePath(" /team-a.v2_x ")).toBe("/team-a.v2_x");
  });

  it("rejects segments that would need escaping", () => {
    for (const bad of ["/an na", "/anna?x", "/a/../b", "/./a", "/a#b", "/anna;x", "/ünicode", "/a%20b"]) {
      expect(() => normalizeBasePath(bad), bad).toThrow(ConfigError);
    }
  });

  it("feeds into loadConfig", () => {
    expect(loadConfig({ SCRIBEDOG_BASE_PATH: "bob/" }).basePath).toBe("/bob");
    expect(loadConfig({}).basePath).toBe("");
  });
});

describe("renderIndexHtml", () => {
  const template = `<script type="module" src="${BASE_PATH_PLACEHOLDER}/assets/index-abc.js"></script><meta name="scribedog-base-path" content="${BASE_PATH_PLACEHOLDER}">`;

  it("substitutes every placeholder with the prefix", () => {
    expect(renderIndexHtml(template, "/anna")).toBe(
      '<script type="module" src="/anna/assets/index-abc.js"></script><meta name="scribedog-base-path" content="/anna">'
    );
  });

  it("removes the placeholder for the root", () => {
    expect(renderIndexHtml(template, "")).toBe(
      '<script type="module" src="/assets/index-abc.js"></script><meta name="scribedog-base-path" content="">'
    );
  });
});

describe("app under a base path", () => {
  let context: TestContext;
  let webDistDir: string;

  beforeEach(async () => {
    webDistDir = await mkdtemp(path.join(os.tmpdir(), "scribedog-web-dist-"));
    await mkdir(path.join(webDistDir, "assets"), { recursive: true });
    await writeFile(
      path.join(webDistDir, "index.html"),
      `<!doctype html><html><head><meta name="scribedog-base-path" content="${BASE_PATH_PLACEHOLDER}"><script type="module" src="${BASE_PATH_PLACEHOLDER}/assets/app.js"></script></head><body></body></html>`
    );
    await writeFile(path.join(webDistDir, "assets", "app.js"), "console.log('app');\n");
    context = await createTestContext({ SCRIBEDOG_BASE_PATH: "/anna/" }, { webDistDir });
  });

  afterEach(async () => {
    await context.cleanup();
    await rm(webDistDir, { recursive: true, force: true });
  });

  it("serves nothing at the bare root", async () => {
    expect((await context.app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "GET", url: "/api/files" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { password: TEST_PASSWORD } })).statusCode).toBe(
      404
    );
    expect((await context.app.inject({ method: "GET", url: "/assets/app.js" })).statusCode).toBe(404);
  });

  it("serves the templated index.html under the prefix", async () => {
    for (const url of ["/anna", "/anna/"]) {
      const response = await context.app.inject({ method: "GET", url });

      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/html/);
      expect(response.body).toContain('content="/anna"');
      expect(response.body).toContain('src="/anna/assets/app.js"');
      expect(response.body).not.toContain(BASE_PATH_PLACEHOLDER);
    }
  });

  it("serves assets under the prefix with long caching", async () => {
    const response = await context.app.inject({ method: "GET", url: "/anna/assets/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toMatch(/immutable/);
    expect(response.body).toContain("console.log");
  });

  it("does not let the static handler reach outside the assets directory", async () => {
    expect((await context.app.inject({ method: "GET", url: "/anna/assets/../index.html" })).statusCode).not.toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/anna/assets/..%2Findex.html" })).statusCode).not.toBe(200);
  });

  it("scopes the session cookie to the prefix and mounts the API under it", async () => {
    const login = await context.app.inject({ method: "POST", url: "/anna/api/auth/login", payload: { password: TEST_PASSWORD } });

    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);
    expect(cookie?.path).toBe("/anna");

    const cookieHeader = `${cookie?.name}=${cookie?.value}`;
    const files = await context.app.inject({ method: "GET", url: "/anna/api/files", headers: { cookie: cookieHeader } });
    expect(files.statusCode).toBe(200);
    expect(files.json().files.map((file: { relativePath: string }) => file.relativePath)).toEqual(["Notes/Idea.md", "Welcome.md"]);

    const logout = await context.app.inject({ method: "POST", url: "/anna/api/auth/logout", headers: { cookie: cookieHeader } });
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME)?.path).toBe("/anna");
  });
});

describe("app at the root", () => {
  let context: TestContext;
  let webDistDir: string;

  beforeEach(async () => {
    webDistDir = await mkdtemp(path.join(os.tmpdir(), "scribedog-web-dist-"));
    await mkdir(path.join(webDistDir, "assets"), { recursive: true });
    await writeFile(
      path.join(webDistDir, "index.html"),
      `<!doctype html><html><head><script type="module" src="${BASE_PATH_PLACEHOLDER}/assets/app.js"></script></head></html>`
    );
    await writeFile(path.join(webDistDir, "assets", "app.js"), "console.log('app');\n");
    context = await createTestContext({}, { webDistDir });
  });

  afterEach(async () => {
    await context.cleanup();
    await rm(webDistDir, { recursive: true, force: true });
  });

  it("serves index.html and assets at the root", async () => {
    const index = await context.app.inject({ method: "GET", url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('src="/assets/app.js"');

    expect((await context.app.inject({ method: "GET", url: "/assets/app.js" })).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: "/index.html" })).statusCode).toBe(404);
  });
});
