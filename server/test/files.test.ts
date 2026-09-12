import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers.js";

describe("file API", () => {
  let context: TestContext;
  let cookie: string;

  beforeEach(async () => {
    context = await createTestContext();
    cookie = await context.login();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("lists markdown files only, sorted, without the metadata directory", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/files", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const files = response.json().files as Array<{ relativePath: string; mtimeMs: number }>;
    expect(files.map((file) => file.relativePath)).toEqual(["Notes/Idea.md", "Welcome.md"]);
    expect(files.every((file) => file.mtimeMs > 0)).toBe(true);
  });

  it("reads a note", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/files/content?path=Notes%2FIdea.md",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ relativePath: "Notes/Idea.md", content: "# Idea\n" });
  });

  it("answers 404 for a note that does not exist", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/files/content?path=Nope.md", headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
  });

  it("answers 400 for paths outside the rules", async () => {
    for (const bad of ["../x.md", "/etc/passwd", ".scribedog/server/auth.json", ".scribedog/secret.md", "Notes/not-markdown.txt"]) {
      const response = await context.app.inject({
        method: "GET",
        url: `/api/files/content?path=${encodeURIComponent(bad)}`,
        headers: { cookie }
      });

      expect(response.statusCode, bad).toBe(400);
      expect(response.json().error, bad).toBe("invalid_path");
    }

    expect((await context.app.inject({ method: "GET", url: "/api/files/content", headers: { cookie } })).statusCode).toBe(400);
  });

  it("saves a note and reports the new mtime", async () => {
    const before = await context.app.inject({ method: "GET", url: "/api/files/content?path=Welcome.md", headers: { cookie } });

    const response = await context.app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: { cookie },
      payload: { path: "Welcome.md", content: "# Changed\n\nNew text with ümlauts.\n" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().relativePath).toBe("Welcome.md");
    expect(response.json().mtimeMs).toBeGreaterThanOrEqual(before.json().mtimeMs);
    expect(await readFile(path.join(context.vaultPath, "Welcome.md"), "utf8")).toBe("# Changed\n\nNew text with ümlauts.\n");
  });

  it("does not create new files yet", async () => {
    const response = await context.app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: { cookie },
      payload: { path: "Brand-new.md", content: "# New\n" }
    });

    expect(response.statusCode).toBe(404);
  });

  it("refuses to write outside the vault or into the metadata directory", async () => {
    for (const bad of ["../escape.md", ".scribedog/server/auth.json", ".scribedog/x.md", "Notes/x.txt"]) {
      const response = await context.app.inject({
        method: "PUT",
        url: "/api/files/content",
        headers: { cookie },
        payload: { path: bad, content: "pwned" }
      });

      expect(response.statusCode, bad).toBe(400);
    }
  });

  it("validates the save body", async () => {
    expect(
      (await context.app.inject({ method: "PUT", url: "/api/files/content", headers: { cookie }, payload: { path: "Welcome.md" } }))
        .statusCode
    ).toBe(400);
    expect(
      (
        await context.app.inject({
          method: "PUT",
          url: "/api/files/content",
          headers: { cookie },
          payload: { path: "Welcome.md", content: 1 }
        })
      ).statusCode
    ).toBe(400);
  });

  it("requires a session for every file route", async () => {
    expect((await context.app.inject({ method: "GET", url: "/api/files" })).statusCode).toBe(401);
    expect((await context.app.inject({ method: "GET", url: "/api/files/content?path=Welcome.md" })).statusCode).toBe(401);
    expect(
      (await context.app.inject({ method: "PUT", url: "/api/files/content", payload: { path: "Welcome.md", content: "x" } })).statusCode
    ).toBe(401);
  });
});
