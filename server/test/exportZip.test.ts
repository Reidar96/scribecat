import { lstat, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers.js";

describe("export API: folder as ZIP", () => {
  let context: TestContext;
  let cookie: string;

  const get = (url: string, headers: Record<string, string> = { cookie }) =>
    context.app.inject({ method: "GET", url, headers });
  const zipUrl = (relativePath: string) => `/api/export/zip?path=${encodeURIComponent(relativePath)}`;
  const unpack = (payload: Buffer) => unzipSync(new Uint8Array(payload));

  beforeEach(async () => {
    context = await createTestContext();
    cookie = await context.login();

    // The temp vault has Welcome.md, Notes/Idea.md, Notes/not-markdown.txt
    // and .scribedog/secret.md; add the server's own files, an image and an
    // empty folder to see what the archive does with each.
    await mkdir(path.join(context.vaultPath, ".scribedog", "server"), { recursive: true });
    await writeFile(path.join(context.vaultPath, ".scribedog", "server", "auth.json"), "{}");
    await mkdir(path.join(context.vaultPath, "Notes", ".scribedog", "versions"), { recursive: true });
    await writeFile(path.join(context.vaultPath, "Notes", ".scribedog", "versions", "Idea.md.1"), "old");
    await mkdir(path.join(context.vaultPath, "images"), { recursive: true });
    await writeFile(path.join(context.vaultPath, "images", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await mkdir(path.join(context.vaultPath, "Empty"), { recursive: true });
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("packs the whole vault without any .scribedog directory", async () => {
    const response = await get(zipUrl(""));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toContain('filename="vault.zip"');

    const files = unpack(response.rawPayload);
    expect(Object.keys(files).sort()).toEqual(["Notes/Idea.md", "Notes/not-markdown.txt", "Welcome.md", "images/pic.png"]);
    expect(strFromU8(files["Notes/Idea.md"])).toBe("# Idea\n");
    expect(Array.from(files["images/pic.png"])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("packs a subfolder with paths relative to it and names the archive after it", async () => {
    const response = await get(zipUrl("Notes"));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain('filename="Notes.zip"');
    expect(Object.keys(unpack(response.rawPayload)).sort()).toEqual(["Idea.md", "not-markdown.txt"]);
  });

  it("spells non-ASCII folder names for both kinds of client", async () => {
    await mkdir(path.join(context.vaultPath, "Café & Ideen"), { recursive: true });
    await writeFile(path.join(context.vaultPath, "Café & Ideen", "A.md"), "# A\n");

    const response = await get(zipUrl("Café & Ideen"));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="Caf_ & Ideen.zip"; filename*=UTF-8''${encodeURIComponent("Café & Ideen.zip")}`
    );
  });

  it("refuses the metadata directory in every spelling, and paths that are no folder", async () => {
    for (const relativePath of [".scribedog", ".scribedog/server", ".SCRIBEDOG/versions", "Notes/.scribedog"]) {
      const response = await get(zipUrl(relativePath));
      expect(response.statusCode, relativePath).toBe(400);
      expect(response.json().error).toBe("invalid_path");
    }

    expect((await get(zipUrl("Welcome.md"))).statusCode).toBe(400);
    expect((await get(zipUrl("../elsewhere"))).statusCode).toBe(400);
    expect((await get(zipUrl("Nope"))).statusCode).toBe(400);
    expect((await get("/api/export/zip")).statusCode).toBe(400);
  });

  it("leaves symlinks out, wherever they point", async () => {
    const outside = path.join(path.dirname(context.vaultPath), `outside-${path.basename(context.vaultPath)}`);
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.md"), "# secret\n");

    try {
      await symlink(path.join(outside, "secret.md"), path.join(context.vaultPath, "link.md"), "file");
      await symlink(outside, path.join(context.vaultPath, "linked-dir"), "dir");
      await symlink(path.join(context.vaultPath, "Notes"), path.join(context.vaultPath, "linked-inside"), "dir");
      await lstat(path.join(context.vaultPath, "linked-dir"));
    } catch {
      // Symlink creation needs privileges on Windows; nothing to check then.
      return;
    }

    const files = unpack((await get(zipUrl(""))).rawPayload);
    expect(Object.keys(files).some((name) => name.startsWith("link"))).toBe(false);

    // A symlinked folder cannot be the export root either.
    expect((await get(zipUrl("linked-dir"))).statusCode).toBe(400);
  });

  it("needs a session", async () => {
    expect((await get(zipUrl(""), {})).statusCode).toBe(401);
  });

  it("packs an empty folder into an empty archive", async () => {
    const response = await get(zipUrl("Empty"));

    expect(response.statusCode).toBe(200);
    expect(Object.keys(unpack(response.rawPayload))).toEqual([]);
  });
});
