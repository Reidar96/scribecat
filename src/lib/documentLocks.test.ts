import { describe, expect, it } from "vitest";

import {
  isDocumentLocked,
  normalizeDocumentLocks,
  removeDocumentLockPath,
  renameDocumentLockPath,
  setDocumentLock
} from "@/lib/documentLocks";

describe("document locks", () => {
  it("normalizes paths and ignores invalid lock values", () => {
    expect(normalizeDocumentLocks({ "Folder\\Note.md": true, "bad.md": false })).toEqual({
      "folder/note.md": true
    });
  });

  it("sets and clears a note lock", () => {
    const locked = setDocumentLock({}, "Folder/Note.md", true);
    expect(isDocumentLocked(locked, "folder/note.md")).toBe(true);
    expect(setDocumentLock(locked, "Folder/Note.md", false)).toEqual({});
  });

  it("moves a folder's locks with the folder", () => {
    const locks = {
      "old/a.md": true as const,
      "old/sub/b.md": true as const,
      "other.md": true as const
    };

    expect(renameDocumentLockPath(locks, "old", "New")).toEqual({
      "new/a.md": true,
      "new/sub/b.md": true,
      "other.md": true
    });
  });

  it("removes a folder's whole lock subtree", () => {
    expect(
      removeDocumentLockPath(
        { "folder/a.md": true, "folder/sub/b.md": true, "other.md": true },
        "folder"
      )
    ).toEqual({ "other.md": true });
  });
});
