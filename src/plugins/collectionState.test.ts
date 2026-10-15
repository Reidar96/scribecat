import { expect, it } from "vitest";
import { quickNoteBody, retainCollectionEntries, updateQuickNoteBody } from "./collectionState";

it("keeps cards visible during an mtime refresh and drops only removed paths", () => {
  const before = [{ path: "a.md", markdown: "old" }, { path: "b.md", markdown: "other" }];
  expect(retainCollectionEntries(["a.md", "b.md"], before, [])).toEqual(before);
  expect(retainCollectionEntries(["a.md"], before, [{ path: "a.md", markdown: "new" }]))
    .toEqual([{ path: "a.md", markdown: "new" }]);
});

it("updates a note body without reverting its current frontmatter", () => {
  expect(updateQuickNoteBody('---\ncategory: "Hjem"\npinned: true\n---\n\nOld\n', "New"))
    .toBe('---\ncategory: "Hjem"\npinned: true\n---\n\nNew\n');
  expect(quickNoteBody(updateQuickNoteBody('---\ncreated: today\n---\n\n', "To linjer\n\n")))
    .toBe("To linjer\n\n");
});
