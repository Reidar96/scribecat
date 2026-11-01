import { describe, expect, it } from "vitest";
import { insertNote, noteColumns, noteCreatedAt, noteManualPosition } from "./quickNoteLayout";

describe("Quick Notes layout", () => {
  it("keeps existing cards in their columns as one grows or a new card is appended", () => {
    const before = noteColumns(["a", "b", "c", "d"], 2);
    expect(before).toEqual([["a", "c"], ["b", "d"]]);
    expect(noteColumns(["a", "b", "c", "d", "new"], 2)).toEqual([["a", "c", "new"], ["b", "d"]]);
  });
  it("inserts on the indicated side even when the source was before the target", () => {
    expect(insertNote(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
    expect(insertNote(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  });
  it("does not move a card when its body or file modification time changes", () => {
    const before = { created: "2026-10-01T10:00:00Z" };
    const edited = { ...before, body: "more text", mtime: "2026-11-01T10:00:00Z" };
    expect(noteManualPosition(before)).toBe(noteManualPosition(edited));
    expect(noteCreatedAt(before)).toBe(noteCreatedAt(edited));
    expect(noteManualPosition({ ...before, order: "2048" })).toBe(2048);
  });
});
