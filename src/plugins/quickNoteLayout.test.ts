import { describe, expect, it } from "vitest";
import { insertNote, moveNoteColumns, nextNoteTopOrder, noteColumns, noteCreatedAt, noteDropPlacement, noteManualPosition } from "./quickNoteLayout";

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
  it("puts a new note ahead of numbered and legacy notes", () => {
    const items: { metadata: Record<string, string> }[] = [{ metadata: { order: "1024" } }, { metadata: { created: "2026-10-01T10:00:00Z" } }];
    const next = nextNoteTopOrder(items);
    expect(next).toBeLessThan(noteManualPosition(items[0].metadata));
    expect(next).toBeLessThan(noteManualPosition(items[1].metadata));
  });
  it("keeps cards in their assigned column when moving one to the other", () => {
    const rows = ["a", "b", "c", "d"];
    const columns = new Map([["a", 0], ["b", 1], ["c", 0], ["d", 1]]);
    expect(noteColumns(rows, 2, (path) => columns.get(path)!)).toEqual([["a", "c"], ["b", "d"]]);
    columns.set("a", 1);
    expect(noteColumns(["b", "c", "a", "d"], 2, (path) => columns.get(path)!)).toEqual([["c"], ["b", "a", "d"]]);
  });
  it("indicates and saves the same position in either column, including the gap", () => {
    const left = [{ path: "a", midpoint: 100 }, { path: "c", midpoint: 400 }];
    const right = [{ path: "b", midpoint: 130 }, { path: "d", midpoint: 320 }];
    expect(noteDropPlacement(left, 250, "b")).toEqual({ path: "c", edge: "before" });
    expect(moveNoteColumns([["a", "c"], ["b", "d"]], "b", "c", "before")).toEqual([["a", "b", "c"], ["d"]]);
    expect(noteDropPlacement(right, 500, "a")).toEqual({ path: "d", edge: "after" });
    expect(moveNoteColumns([["a", "c"], ["b", "d"]], "a", "d", "after")).toEqual([["c"], ["b", "d", "a"]]);
  });
});
