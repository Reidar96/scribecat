import { describe, expect, it } from "vitest";

import { rewriteMovedMarkdownLinks } from "@/lib/editor/documentLinks";

describe("rewriteMovedMarkdownLinks", () => {
  const vault = ["/vault/a.md", "/vault/folder/b.md", "/vault/notes/source.md"];

  it("updates incoming links when a note moves", () => {
    expect(rewriteMovedMarkdownLinks(
      "[B](../folder/b.md#section)",
      "/vault/notes/source.md",
      "/vault/notes/source.md",
      vault,
      { sourcePath: "/vault/folder/b.md", targetPath: "/vault/b.md" }
    )).toBe("[B](../b.md#section)");
  });

  it("rebases links from documents moved with their folder", () => {
    expect(rewriteMovedMarkdownLinks(
      "[A](../a.md)",
      "/vault/folder/b.md",
      "/vault/archive/b.md",
      vault,
      { sourcePath: "/vault/folder", targetPath: "/vault/archive" }
    )).toBe("[A](../a.md)");
  });

  it("updates transclusion targets when their source note moves", () => {
    expect(rewriteMovedMarkdownLinks(
      "![[../folder/b.md]]",
      "/vault/notes/source.md",
      "/vault/notes/source.md",
      vault,
      { sourcePath: "/vault/folder/b.md", targetPath: "/vault/archive/b.md" }
    )).toBe("![[../archive/b.md]]");
  });
});
