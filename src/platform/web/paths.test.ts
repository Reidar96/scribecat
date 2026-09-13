import { describe, expect, it } from "vitest";

import { joinPosixPath, normalizePosixPath, posixDirname, posixPaths } from "./paths";

describe("posix paths (web platform)", () => {
  it("joins and normalizes like the store expects from Tauri's join", () => {
    expect(joinPosixPath("/vault", "Notes", "Idea.md")).toBe("/vault/Notes/Idea.md");
    expect(joinPosixPath("/vault/Notes", "../images/x.png")).toBe("/vault/images/x.png");
    expect(joinPosixPath("/vault", "./a/./b.md")).toBe("/vault/a/b.md");
    expect(joinPosixPath("/vault", "a//b.md")).toBe("/vault/a/b.md");
    expect(joinPosixPath("/vault", "")).toBe("/vault");
  });

  it("resolves '..' above an absolute root to the root, so the vault check catches it", () => {
    expect(joinPosixPath("/vault", "../../etc/passwd")).toBe("/etc/passwd");
    expect(normalizePosixPath("/vault/../..")).toBe("/");
  });

  it("keeps leading '..' segments of a relative path", () => {
    expect(normalizePosixPath("../images/x.png")).toBe("../images/x.png");
    expect(normalizePosixPath("a/../../b")).toBe("../b");
  });

  it("takes the directory like Tauri's dirname", () => {
    expect(posixDirname("/vault/Notes/Idea.md")).toBe("/vault/Notes");
    expect(posixDirname("/vault/Idea.md")).toBe("/vault");
    expect(posixDirname("/vault")).toBe("/");
    expect(posixDirname("Idea.md")).toBe(".");
  });

  it("exposes the async PathApi", async () => {
    await expect(posixPaths.join("/vault", "a.md")).resolves.toBe("/vault/a.md");
    await expect(posixPaths.dirname("/vault/a.md")).resolves.toBe("/vault");
    await expect(posixPaths.normalize("/vault/./a.md")).resolves.toBe("/vault/a.md");
  });
});
