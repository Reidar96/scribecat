import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertVaultPath, resolveVaultFile, VaultPathError } from "../src/vault/paths.js";

describe("assertVaultPath", () => {
  it("accepts plain vault-relative markdown paths and normalizes them", () => {
    expect(assertVaultPath("Welcome.md")).toBe("Welcome.md");
    expect(assertVaultPath("Notes/Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("./Notes/Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("Notes\\Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("  Notes/Idea.md  ")).toBe("Notes/Idea.md");
    expect(assertVaultPath("Notes/Idea.MD")).toBe("Notes/Idea.MD");
    expect(assertVaultPath("Ideen/Über ß und Emoji 🐶.md")).toBe("Ideen/Über ß und Emoji 🐶.md");
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace"],
    [42, "not a string"],
    [null, "null"],
    [undefined, "undefined"],
    ["/etc/passwd.md", "absolute unix path"],
    ["C:/Users/x.md", "windows drive"],
    ["c:\\Users\\x.md", "windows drive with backslashes"],
    ["\\\\server\\share\\x.md", "UNC path"],
    ["../outside.md", "parent segment at the start"],
    ["Notes/../../outside.md", "parent segment in the middle"],
    ["Notes/./Idea.md", "dot segment"],
    ["Notes//Idea.md", "empty segment"],
    [".scribedog/server/auth.json", "metadata directory"],
    [".scribedog/secret.md", "markdown inside the metadata directory"],
    [".SCRIBEDOG/secret.md", "metadata directory, different case"],
    ["Notes/not-markdown.txt", "not markdown"],
    ["Notes/Idea.md.bak", "wrong extension"],
    ["Notes", "no extension"],
    ["Notes/Idea.md\u0000.txt", "null byte"],
    ["Notes/Idea\n.md", "newline"]
  ])("rejects %j (%s)", (input) => {
    expect(() => assertVaultPath(input)).toThrow(VaultPathError);
  });
});

describe("resolveVaultFile", () => {
  let vaultPath: string;
  let outsidePath: string;

  beforeAll(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "scribedog-paths-test-"));
    vaultPath = path.join(root, "vault");
    outsidePath = path.join(root, "outside");
    await mkdir(path.join(vaultPath, "Notes"), { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await writeFile(path.join(vaultPath, "Notes", "Idea.md"), "# Idea\n");
    await writeFile(path.join(outsidePath, "secret.md"), "# secret\n");

    // Symlink creation needs privileges on Windows; skip those cases there.
    try {
      await symlink(path.join(outsidePath, "secret.md"), path.join(vaultPath, "link-to-secret.md"), "file");
      await symlink(outsidePath, path.join(vaultPath, "linked-dir"), "dir");
    } catch {
      // handled per test via canSymlink()
    }
  });

  afterAll(async () => {
    await rm(path.dirname(vaultPath), { recursive: true, force: true });
  });

  async function canSymlink(): Promise<boolean> {
    try {
      await import("node:fs/promises").then((fs) => fs.lstat(path.join(vaultPath, "linked-dir")));
      return true;
    } catch {
      return false;
    }
  }

  it("resolves an existing file inside the vault", async () => {
    const resolved = await resolveVaultFile(vaultPath, "Notes/Idea.md");
    expect(resolved).toBe(path.join(vaultPath, "Notes", "Idea.md"));
  });

  it("resolves a not-yet-existing file whose directory is inside the vault", async () => {
    const resolved = await resolveVaultFile(vaultPath, "Notes/New.md");
    expect(resolved).toBe(path.join(vaultPath, "Notes", "New.md"));
  });

  it("rejects a file whose directory does not exist", async () => {
    await expect(resolveVaultFile(vaultPath, "Missing/New.md")).rejects.toThrow();
  });

  it("rejects a symlinked file that points outside the vault", async () => {
    if (!(await canSymlink())) {
      return;
    }

    await expect(resolveVaultFile(vaultPath, "link-to-secret.md")).rejects.toThrow(VaultPathError);
  });

  it("rejects files reached through a symlinked directory that points outside the vault", async () => {
    if (!(await canSymlink())) {
      return;
    }

    await expect(resolveVaultFile(vaultPath, "linked-dir/secret.md")).rejects.toThrow(VaultPathError);
    await expect(resolveVaultFile(vaultPath, "linked-dir/new.md")).rejects.toThrow(VaultPathError);
  });
});
