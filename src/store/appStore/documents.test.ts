import { describe, expect, it } from "vitest";

import { pruneDocumentsToCurrentFolder } from "./documents";

const OPEN = "D:/Vault/Misc/Lavendel.md";

describe("pruneDocumentsToCurrentFolder", () => {
  it("drops a clean document whose file is gone from disk", () => {
    const documents = { [OPEN]: { content: "text", baseContent: "text" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual({});
  });

  it("keeps a document with unsaved edits even when its file is gone", () => {
    const documents = { [OPEN]: { content: "neu", baseContent: "alt" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], OPEN)).toEqual(documents);
  });







  it("still keeps documents whose file is present", () => {
    const documents = { [OPEN]: { content: "text", baseContent: "text" } };

    expect(pruneDocumentsToCurrentFolder(documents, [OPEN], OPEN)).toEqual(documents);
  });



  it("keeps an unwritten folder note while it is the open document", () => {
    const note = "D:/Vault/Misc/.scribecat-foldernote.md";
    const documents = { [note]: { content: "", baseContent: "" } };

    expect(pruneDocumentsToCurrentFolder(documents, [], note)).toEqual(documents);
  });

  it("drops a clean unwritten folder note once another document is open", () => {
    const note = "D:/Vault/Misc/.scribecat-foldernote.md";
    const documents = {
      [note]: { content: "", baseContent: "" },
      [OPEN]: { content: "text", baseContent: "text" }
    };

    expect(pruneDocumentsToCurrentFolder(documents, [OPEN], OPEN)).toEqual({
      [OPEN]: { content: "text", baseContent: "text" }
    });
  });
});
