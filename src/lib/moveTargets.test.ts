import { describe, expect, it } from "vitest";

import { listMoveTargets } from "./moveTargets";

const FILES = ["Welcome.md", "Projects/Roadmap.md", "Projects/Ideas/Big.md", "Notes/Daily.md"];

describe("listMoveTargets", () => {
  it("lists the root and every folder in tree order, derived from the note paths", () => {
    const targets = listMoveTargets(FILES, [], [{ kind: "file", relativePath: "Welcome.md" }]);

    expect(targets.map((target) => target.relativePath)).toEqual([
      "",
      "Notes",
      "Projects",
      "Projects/Ideas"
    ]);
    expect(targets.map((target) => target.depth)).toEqual([0, 1, 1, 2]);
    expect(targets[3].name).toBe("Ideas");
  });

  it("includes empty folders and their ancestors", () => {
    const targets = listMoveTargets(["A.md"], ["Archive/2025"], [{ kind: "file", relativePath: "A.md" }]);

    expect(targets.map((target) => target.relativePath)).toEqual(["", "Archive", "Archive/2025"]);
  });

  it("disables the folder the entries are already in", () => {
    const targets = listMoveTargets(FILES, [], [{ kind: "file", relativePath: "Projects/Roadmap.md" }]);

    expect(targets.find((target) => target.relativePath === "Projects")?.disabled).toBe(true);
    expect(targets.find((target) => target.relativePath === "")?.disabled).toBe(false);
  });

  it("disables a folder itself and everything inside it when that folder moves", () => {
    const targets = listMoveTargets(FILES, [], [{ kind: "folder", relativePath: "Projects" }]);

    expect(targets.find((target) => target.relativePath === "Projects")?.disabled).toBe(true);
    expect(targets.find((target) => target.relativePath === "Projects/Ideas")?.disabled).toBe(true);
    // Its parent is where it already is.
    expect(targets.find((target) => target.relativePath === "")?.disabled).toBe(true);
    expect(targets.find((target) => target.relativePath === "Notes")?.disabled).toBe(false);
  });

  it("keeps a shared parent enabled when the entries come from different folders", () => {
    const targets = listMoveTargets(FILES, [], [
      { kind: "file", relativePath: "Projects/Roadmap.md" },
      { kind: "file", relativePath: "Notes/Daily.md" }
    ]);

    expect(targets.find((target) => target.relativePath === "Projects")?.disabled).toBe(false);
    expect(targets.find((target) => target.relativePath === "Notes")?.disabled).toBe(false);
  });
});
