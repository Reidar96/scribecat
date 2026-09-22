import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers.js";

describe("file API", () => {
  let context: TestContext;
  let cookie: string;

  const get = (url: string) => context.app.inject({ method: "GET", url, headers: { cookie } });
  const post = (url: string, payload: unknown) => context.app.inject({ method: "POST", url, headers: { cookie }, payload });
  const putJson = (url: string, payload: unknown) => context.app.inject({ method: "PUT", url, headers: { cookie }, payload });
  const q = (relativePath: string) => `path=${encodeURIComponent(relativePath)}`;

  beforeEach(async () => {
    context = await createTestContext();
    cookie = await context.login();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("lists markdown files only, sorted, without the metadata directory", async () => {
    const response = await get("/api/files");

    expect(response.statusCode).toBe(200);
    const files = response.json().files as Array<{ relativePath: string; mtimeMs: number }>;
    expect(files.map((file) => file.relativePath)).toEqual(["Notes/Idea.md", "Welcome.md"]);
    expect(files.every((file) => file.mtimeMs > 0)).toBe(true);
  });

  it("lists directory entries, the root included", async () => {
    const root = await get("/api/fs/entries?path=");
    expect(root.statusCode).toBe(200);
    const names = (root.json().entries as Array<{ name: string; isDirectory: boolean; isFile: boolean }>).map((e) => e.name).sort();
    expect(names).toEqual([".scribecat", "Notes", "Welcome.md"]);

    const notes = await get(`/api/fs/entries?${q("Notes")}`);
    expect(notes.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idea.md", isFile: true, isDirectory: false }),
        expect.objectContaining({ name: "not-markdown.txt", isFile: true })
      ])
    );

    expect((await get(`/api/fs/entries?${q("Welcome.md")}`)).statusCode).toBe(400);
    expect((await get(`/api/fs/entries?${q("Nope")}`)).statusCode).toBe(404);
  });

  it("stats and checks existence", async () => {
    const file = await get(`/api/fs/stat?${q("Notes/Idea.md")}`);
    expect(file.statusCode).toBe(200);
    expect(file.json()).toMatchObject({ isFile: true, isDirectory: false, isSymlink: false, size: 7 });
    expect(file.json().mtimeMs).toBeGreaterThan(0);

    const folder = await get(`/api/fs/stat?${q("Notes")}`);
    expect(folder.json()).toMatchObject({ isFile: false, isDirectory: true });

    expect((await get(`/api/fs/stat?${q("Nope.md")}`)).statusCode).toBe(404);

    expect((await get(`/api/fs/exists?${q("Notes/Idea.md")}`)).json()).toEqual({ exists: true });
    expect((await get(`/api/fs/exists?${q("Nope.md")}`)).json()).toEqual({ exists: false });
    expect((await get(`/api/fs/exists?${q(".scribecat/server/auth.json")}`)).statusCode).toBe(400);
  });

  it("reads and writes text, creating new files in existing folders", async () => {
    expect((await get(`/api/fs/text?${q("Notes/Idea.md")}`)).json()).toEqual({ content: "# Idea\n" });
    expect((await get(`/api/fs/text?${q("Nope.md")}`)).statusCode).toBe(404);

    const overwrite = await putJson("/api/fs/text", { path: "Welcome.md", content: "# Changed\n\nNew text with ümlauts.\n" });
    expect(overwrite.statusCode).toBe(200);
    expect(overwrite.json().mtimeMs).toBeGreaterThan(0);
    expect(await readFile(path.join(context.vaultPath, "Welcome.md"), "utf8")).toBe("# Changed\n\nNew text with ümlauts.\n");

    const create = await putJson("/api/fs/text", { path: "Notes/Brand-new.md", content: "# New\n" });
    expect(create.statusCode).toBe(200);
    expect(await readFile(path.join(context.vaultPath, "Notes", "Brand-new.md"), "utf8")).toBe("# New\n");

    // Like the desktop's writeTextFile: no implicit parent folders.
    expect((await putJson("/api/fs/text", { path: "Missing/New.md", content: "" })).statusCode).toBe(404);

    // Sidecars the frontend keeps are ordinary files here.
    expect((await post("/api/fs/mkdir", { path: ".scribecat/versions", recursive: true })).statusCode).toBe(204);
    expect((await putJson("/api/fs/text", { path: ".scribecat/versions/index.json", content: "{}" })).statusCode).toBe(200);
    expect((await get(`/api/fs/text?${q(".scribecat/versions/index.json")}`)).json()).toEqual({ content: "{}" });
  });

  it("reads and writes bytes with a content type for images", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

    expect((await post("/api/fs/mkdir", { path: "images", recursive: true })).statusCode).toBe(204);

    const write = await context.app.inject({
      method: "PUT",
      url: `/api/fs/file?${q("images/photo.png")}`,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload: png
    });
    expect(write.statusCode).toBe(200);
    expect(await readFile(path.join(context.vaultPath, "images", "photo.png"))).toEqual(png);

    const read = await get(`/api/fs/file?${q("images/photo.png")}`);
    expect(read.statusCode).toBe(200);
    expect(read.headers["content-type"]).toBe("image/png");
    expect(read.rawPayload).toEqual(png);

    const wrongType = await context.app.inject({
      method: "PUT",
      url: `/api/fs/file?${q("images/photo.png")}`,
      headers: { cookie, "content-type": "text/plain" },
      payload: "not bytes"
    });
    expect(wrongType.statusCode).toBe(415);
  });

  it("creates folders, with and without parents", async () => {
    expect((await post("/api/fs/mkdir", { path: "New", recursive: false })).statusCode).toBe(204);
    expect((await stat(path.join(context.vaultPath, "New"))).isDirectory()).toBe(true);
    expect((await post("/api/fs/mkdir", { path: "New", recursive: false })).statusCode).toBe(409);
    expect((await post("/api/fs/mkdir", { path: "A/B/C", recursive: false })).statusCode).toBe(404);
    expect((await post("/api/fs/mkdir", { path: "A/B/C", recursive: true })).statusCode).toBe(204);
    expect((await stat(path.join(context.vaultPath, "A", "B", "C"))).isDirectory()).toBe(true);
  });

  // The frontend ensures a note's parent exists before writing it, and for a
  // note at the top level that parent is the vault root: a no-op, like the
  // desktop's mkdir on a folder that is already there.
  it("accepts the root for a recursive mkdir and refuses it otherwise", async () => {
    expect((await post("/api/fs/mkdir", { path: "", recursive: true })).statusCode).toBe(204);
    expect((await post("/api/fs/mkdir", { path: "", recursive: false })).statusCode).toBe(400);
  });

  it("renames and moves files and folders", async () => {
    expect((await post("/api/fs/rename", { from: "Notes/Idea.md", to: "Notes/Plan.md" })).statusCode).toBe(204);
    expect(await readFile(path.join(context.vaultPath, "Notes", "Plan.md"), "utf8")).toBe("# Idea\n");

    expect((await post("/api/fs/rename", { from: "Notes", to: "Archive" })).statusCode).toBe(204);
    expect((await get("/api/files")).json().files.map((f: { relativePath: string }) => f.relativePath)).toEqual([
      "Archive/Plan.md",
      "Welcome.md"
    ]);

    expect((await post("/api/fs/rename", { from: "Nope.md", to: "X.md" })).statusCode).toBe(404);
    expect((await post("/api/fs/rename", { from: "Welcome.md", to: "Missing/X.md" })).statusCode).toBe(404);
  });

  it("removes files and folders", async () => {
    expect((await post("/api/fs/remove", { path: "Welcome.md" })).statusCode).toBe(204);
    expect((await get(`/api/fs/exists?${q("Welcome.md")}`)).json()).toEqual({ exists: false });

    expect((await post("/api/fs/remove", { path: "Notes", recursive: false })).statusCode).toBe(409);
    expect((await post("/api/fs/remove", { path: "Notes", recursive: true })).statusCode).toBe(204);
    expect((await get(`/api/fs/exists?${q("Notes")}`)).json()).toEqual({ exists: false });

    expect((await post("/api/fs/remove", { path: "Nope.md" })).statusCode).toBe(404);
  });

  it("never lets the root or the metadata directory be renamed or removed", async () => {
    for (const target of ["", ".scribecat", ".SCRIBECAT"]) {
      expect((await post("/api/fs/remove", { path: target, recursive: true })).statusCode, target).toBe(400);
      expect((await post("/api/fs/rename", { from: target, to: "gone" })).statusCode, target).toBe(400);
      expect((await post("/api/fs/rename", { from: "Notes", to: target })).statusCode, target).toBe(400);
    }

    expect(await readFile(path.join(context.vaultPath, ".scribecat", "server", "auth.json"), "utf8")).toContain("passwordHash");
  });

  it("answers 400 for paths outside the rules on every route", async () => {
    for (const bad of ["../x.md", "/etc/passwd", ".scribecat/server/auth.json", ".scribecat/server", "a/../../b"]) {
      expect((await get(`/api/fs/text?${q(bad)}`)).statusCode, bad).toBe(400);
      expect((await get(`/api/fs/file?${q(bad)}`)).statusCode, bad).toBe(400);
      expect((await get(`/api/fs/stat?${q(bad)}`)).statusCode, bad).toBe(400);
      expect((await putJson("/api/fs/text", { path: bad, content: "pwned" })).statusCode, bad).toBe(400);
      expect((await post("/api/fs/mkdir", { path: bad })).statusCode, bad).toBe(400);
      expect((await post("/api/fs/remove", { path: bad })).statusCode, bad).toBe(400);
      expect((await post("/api/fs/rename", { from: bad, to: "x" })).statusCode, bad).toBe(400);
      expect((await post("/api/fs/rename", { from: "Welcome.md", to: bad })).statusCode, bad).toBe(400);
    }

    expect((await get("/api/fs/text")).statusCode).toBe(400);
  });

  it("validates bodies", async () => {
    expect((await putJson("/api/fs/text", { path: "Welcome.md" })).statusCode).toBe(400);
    expect((await putJson("/api/fs/text", { path: "Welcome.md", content: 1 })).statusCode).toBe(400);
    expect((await post("/api/fs/rename", { from: "Welcome.md" })).statusCode).toBe(400);
    expect((await post("/api/fs/mkdir", { path: "x", recursive: "yes" })).statusCode).toBe(400);
  });

  it("requires a session for every file route", async () => {
    const anonymous = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
      context.app.inject({ method, url, payload });

    expect((await anonymous("GET", "/api/files")).statusCode).toBe(401);
    expect((await anonymous("GET", "/api/fs/entries?path=")).statusCode).toBe(401);
    expect((await anonymous("GET", "/api/fs/text?path=Welcome.md")).statusCode).toBe(401);
    expect((await anonymous("GET", "/api/fs/file?path=Welcome.md")).statusCode).toBe(401);
    expect((await anonymous("PUT", "/api/fs/text", { path: "Welcome.md", content: "x" })).statusCode).toBe(401);
    expect((await anonymous("POST", "/api/fs/mkdir", { path: "x" })).statusCode).toBe(401);
    expect((await anonymous("POST", "/api/fs/rename", { from: "a", to: "b" })).statusCode).toBe(401);
    expect((await anonymous("POST", "/api/fs/remove", { path: "Welcome.md" })).statusCode).toBe(401);
  });
});
