import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertMarkdownPath, assertVaultPath, resolveVaultEntry, VaultPathError } from "../src/vault/paths.js";

describe("assertVaultPath", () => {
  it("accepts plain vault-relative paths and normalizes them", () => {
    expect(assertVaultPath("Welcome.md")).toBe("Welcome.md");
    expect(assertVaultPath("Notes/Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("./Notes/Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("Notes\\Idea.md")).toBe("Notes/Idea.md");
    expect(assertVaultPath("  Notes/Idea.md  ")).toBe("Notes/Idea.md");
    expect(assertVaultPath("Notes/")).toBe("Notes");
    expect(assertVaultPath("images/photo.png")).toBe("images/photo.png");
    expect(assertVaultPath("Ideen/Über ß und Emoji 🐶.md")).toBe("Ideen/Über ß und Emoji 🐶.md");
  });

  it("lets the frontend reach its own sidecars, but never the server's", () => {
    expect(assertVaultPath(".scribecat")).toBe(".scribecat");
    expect(assertVaultPath(".scribecat/order.json")).toBe(".scribecat/order.json");
    expect(assertVaultPath(".scribecat/versions/abc.md")).toBe(".scribecat/versions/abc.md");

    for (const bad of [".scribecat/server", ".scribecat/server/auth.json", ".SCRIBECAT/Server/session-secret", ".scribecat/server/"]) {
      expect(() => assertVaultPath(bad), bad).toThrow(VaultPathError);
    }
  });

  it("accepts the root only when asked to", () => {
    expect(assertVaultPath("", { allowRoot: true })).toBe("");
    expect(assertVaultPath("/", { allowRoot: true })).toBe("");
    expect(assertVaultPath(".", { allowRoot: true })).toBe("");
    expect(() => assertVaultPath("")).toThrow(VaultPathError);
    expect(() => assertVaultPath("/")).toThrow(VaultPathError);
  });

  it.each([
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
    ["Notes/Idea.md\u0000.txt", "null byte"],
    ["Notes/Idea\n.md", "newline"]
  ])("rejects %j (%s)", (input) => {
    expect(() => assertVaultPath(input)).toThrow(VaultPathError);
  });
});

describe("assertMarkdownPath", () => {
  it("adds the .md requirement on top", () => {
    expect(assertMarkdownPath("Notes/Idea.MD")).toBe("Notes/Idea.MD");

    for (const bad of ["Notes/not-markdown.txt", "Notes/Idea.md.bak", "Notes", "images/x.png"]) {
      expect(() => assertMarkdownPath(bad), bad).toThrow(VaultPathError);
    }
  });
});

describe("resolveVaultEntry", () => {
  let vaultPath: string;
  let outsidePath: string;

  beforeAll(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "scribecat-paths-test-"));
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
      await symlink(path.join(vaultPath, "Notes"), path.join(vaultPath, "linked-inside"), "dir");
      await symlink(path.join(outsidePath, "never-created.md"), path.join(vaultPath, "dangling.md"), "file");
    } catch {
      // handled per test via canSymlink()
    }
  });

  afterAll(async () => {
    await rm(path.dirname(vaultPath), { recursive: true, force: true });
  });

  async function canSymlink(): Promise<boolean> {
    try {
      await lstat(path.join(vaultPath, "linked-dir"));
      return true;
    } catch {
      return false;
    }
  }

  it("resolves the root, existing entries and not-yet-existing ones", async () => {
    expect(await resolveVaultEntry(vaultPath, "")).toBe(vaultPath);
    expect(await resolveVaultEntry(vaultPath, "Notes")).toBe(path.join(vaultPath, "Notes"));
    expect(await resolveVaultEntry(vaultPath, "Notes/Idea.md")).toBe(path.join(vaultPath, "Notes", "Idea.md"));
    expect(await resolveVaultEntry(vaultPath, "Notes/New.md")).toBe(path.join(vaultPath, "Notes", "New.md"));
  });

  it("resolves a path whose folders do not exist yet (mkdir -p territory)", async () => {
    expect(await resolveVaultEntry(vaultPath, "Missing/Deeper/New.md")).toBe(path.join(vaultPath, "Missing", "Deeper", "New.md"));
  });

  it("rejects a symlinked file that points outside the vault", async () => {
    if (!(await canSymlink())) {
      return;
    }

    await expect(resolveVaultEntry(vaultPath, "link-to-secret.md")).rejects.toThrow(VaultPathError);
  });

  it("rejects entries reached through a symlinked directory that points outside the vault", async () => {
    if (!(await canSymlink())) {
      return;
    }

    await expect(resolveVaultEntry(vaultPath, "linked-dir")).rejects.toThrow(VaultPathError);
    await expect(resolveVaultEntry(vaultPath, "linked-dir/secret.md")).rejects.toThrow(VaultPathError);
    await expect(resolveVaultEntry(vaultPath, "linked-dir/new.md")).rejects.toThrow(VaultPathError);
    await expect(resolveVaultEntry(vaultPath, "linked-dir/deeper/new.md")).rejects.toThrow(VaultPathError);
  });

  it("rejects a dangling symlink, which a write would otherwise follow", async () => {
    if (!(await canSymlink())) {
      return;
    }

    await expect(resolveVaultEntry(vaultPath, "dangling.md")).rejects.toThrow(VaultPathError);
  });

  it("allows a symlink that stays inside the vault", async () => {
    if (!(await canSymlink())) {
      return;
    }

    expect(await resolveVaultEntry(vaultPath, "linked-inside/Idea.md")).toBe(path.join(vaultPath, "linked-inside", "Idea.md"));
  });
});
