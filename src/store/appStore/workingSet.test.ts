import { describe, expect, it } from "vitest";

import {
  addWorkingSetEntry,
  closableWorkingSetEntries,
  normalizeStoredWorkingSet,
  pruneWorkingSet,
  remapWorkingSetPaths,
  removeWorkingSetEntry,
  resolveStoredWorkingSet,
  setWorkingSetPinned,
  toStoredWorkingSet,
  type WorkingSetEntry
} from "./workingSet";

const A = "D:\\Vault\\A.md";
const B = "D:\\Vault\\Notes\\B.md";

const relativeOf = (filePath: string) => filePath.replace(/\\/g, "/").replace("D:/Vault/", "");

describe("addWorkingSetEntry", () => {
  it("appends a new note at the end and keeps an existing one in place", () => {
    const entries = addWorkingSetEntry(addWorkingSetEntry([], A), B);
    expect(entries.map((entry) => entry.filePath)).toEqual([A, B]);

    // Typing into A again, or the same path spelled differently.
    expect(addWorkingSetEntry(entries, "d:/vault/a.md").map((entry) => entry.filePath)).toEqual([A, B]);
  });

  it("pins an existing entry but never unpins one by re-admitting it", () => {
    const pinned = addWorkingSetEntry([{ filePath: A, pinned: false }], A, true);
    expect(pinned[0].pinned).toBe(true);

    expect(addWorkingSetEntry(pinned, A)[0].pinned).toBe(true);
  });
});

describe("setWorkingSetPinned / removeWorkingSetEntry", () => {
  it("pins an absent note by admitting it, unpins without removing", () => {
    const entries = setWorkingSetPinned([], A, true);
    expect(entries).toEqual([{ filePath: A, pinned: true }]);

    expect(setWorkingSetPinned(entries, A, false)).toEqual([{ filePath: A, pinned: false }]);
    expect(setWorkingSetPinned([], A, false)).toEqual([]);
  });

  it("removes regardless of separators and case", () => {
    expect(removeWorkingSetEntry([{ filePath: A, pinned: false }], "d:/vault/A.MD")).toEqual([]);
  });
});

describe("remap and prune", () => {
  it("follows a folder rename and keeps untouched entries by identity", () => {
    const entries: WorkingSetEntry[] = [
      { filePath: A, pinned: false },
      { filePath: B, pinned: true }
    ];
    const remapped = remapWorkingSetPaths(entries, (path) => path.replace("\\Notes\\", "\\Archive\\"));

    expect(remapped[0]).toBe(entries[0]);
    expect(remapped[1]).toEqual({ filePath: "D:\\Vault\\Archive\\B.md", pinned: true });
  });

  it("drops entries whose note is gone", () => {
    const entries: WorkingSetEntry[] = [
      { filePath: A, pinned: false },
      { filePath: B, pinned: true }
    ];

    expect(pruneWorkingSet(entries, (path) => path === B)).toEqual([entries[1]]);
  });
});

describe("closableWorkingSetEntries", () => {
  // "Close saved" tidies up what the user has already dealt with, and only
  // that: a pinned note was put there on purpose, a dirty one is in progress.
  it("returns clean, unpinned entries only", () => {
    const entries: WorkingSetEntry[] = [
      { filePath: A, pinned: false },
      { filePath: B, pinned: true },
      { filePath: "D:\\Vault\\C.md", pinned: false }
    ];

    expect(closableWorkingSetEntries(entries, (path) => path === A)).toEqual([entries[2]]);
  });
});

describe("stored form", () => {
  it("round-trips through vault-relative paths", () => {
    const entries: WorkingSetEntry[] = [
      { filePath: A, pinned: true },
      { filePath: B, pinned: false }
    ];

    const stored = toStoredWorkingSet(entries, relativeOf);
    expect(stored).toEqual({
      version: 1,
      entries: [
        { path: "A.md", pinned: true },
        { path: "Notes/B.md", pinned: false }
      ]
    });

    expect(resolveStoredWorkingSet(stored, [A, B], relativeOf)).toEqual(entries);
  });

  it("resolves against the file list's spelling and drops missing notes silently", () => {
    const stored = normalizeStoredWorkingSet({
      entries: [
        { path: "notes\\b.md", pinned: true },
        { path: "Gone.md", pinned: false }
      ]
    });

    expect(resolveStoredWorkingSet(stored, [A, B], relativeOf)).toEqual([{ filePath: B, pinned: true }]);
  });

  it("tolerates garbage, duplicates and missing flags", () => {
    expect(normalizeStoredWorkingSet(null)).toEqual({ version: 1, entries: [] });
    expect(normalizeStoredWorkingSet({ entries: "x" })).toEqual({ version: 1, entries: [] });
    expect(
      normalizeStoredWorkingSet({
        entries: [{ path: "A.md" }, { path: "a.md", pinned: true }, { pinned: true }, 7, { path: "" }]
      })
    ).toEqual({ version: 1, entries: [{ path: "A.md", pinned: false }] });
  });
});
