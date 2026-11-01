import { describe, expect, it } from "vitest";
import { insertNote, noteColumns } from "./quickNoteLayout";

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
});
