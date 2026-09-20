import { describe, expect, it } from "vitest";

import { getPathCrumbs } from "./breadcrumbPath";

describe("getPathCrumbs", () => {
  it("returns a single leaf crumb for a note in the vault root", () => {
    expect(getPathCrumbs("Hallo Neue Datei Super.md")).toEqual([
      { name: "Hallo Neue Datei Super.md", folderRelativePath: null }
    ]);
  });

  it("accumulates the folder path for every crumb but the last", () => {
    expect(getPathCrumbs("Ideas/Neuer Ordner Test 1234/Hallo Neue Datei Super")).toEqual([
      { name: "Ideas", folderRelativePath: "Ideas" },
      { name: "Neuer Ordner Test 1234", folderRelativePath: "Ideas/Neuer Ordner Test 1234" },
      { name: "Hallo Neue Datei Super", folderRelativePath: null }
    ]);
  });

  it("drops empty segments so a trailing slash does not add a blank crumb", () => {
    expect(getPathCrumbs("Ideas/Notes/")).toEqual([
      { name: "Ideas", folderRelativePath: "Ideas" },
      { name: "Notes", folderRelativePath: null }
    ]);
  });

  it("returns nothing for an empty label", () => {
    expect(getPathCrumbs("")).toEqual([]);
  });
});
