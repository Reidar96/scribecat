import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { addArchiveEntry, buildZipArchive, createArchive, mimeTypeFor } from "./zipArchive";

describe("mimeTypeFor", () => {
  it("knows the export formats and falls back to opaque bytes", () => {
    expect(mimeTypeFor("Note.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("Note.DOCX")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeTypeFor("Note.md")).toBe("text/markdown");
    expect(mimeTypeFor("Notes.zip")).toBe("application/zip");
    expect(mimeTypeFor("Note.xyz")).toBe("application/octet-stream");
  });
});

describe("export archive", () => {
  it("packs entries under their paths, text and bytes alike", () => {
    const entries = createArchive();
    addArchiveEntry(entries, "Note.html", "<p>hi</p>");
    addArchiveEntry(entries, "Sub/Deep.pdf", new Uint8Array([1, 2, 3]));

    const unpacked = unzipSync(buildZipArchive(entries));

    expect(Object.keys(unpacked).sort()).toEqual(["Note.html", "Sub/Deep.pdf"]);
    expect(strFromU8(unpacked["Note.html"])).toBe("<p>hi</p>");
    expect(Array.from(unpacked["Sub/Deep.pdf"])).toEqual([1, 2, 3]);
  });

  // A multi-selection may pick two notes of the same name from different
  // folders; the folder export would ask about the conflict, the archive
  // keeps both under distinct names instead.
  it("gives a second file with the same path the next free name", () => {
    const entries = createArchive();

    expect(addArchiveEntry(entries, "Idea.pdf", "a")).toBe("Idea.pdf");
    expect(addArchiveEntry(entries, "Idea.pdf", "b")).toBe("Idea (2).pdf");
    expect(addArchiveEntry(entries, "Idea.pdf", "c")).toBe("Idea (3).pdf");
    expect(addArchiveEntry(entries, "Sub/Idea.pdf", "d")).toBe("Sub/Idea.pdf");
    expect(addArchiveEntry(entries, "Sub/Idea.pdf", "e")).toBe("Sub/Idea (2).pdf");
    expect(addArchiveEntry(entries, "README", "f")).toBe("README");
    expect(addArchiveEntry(entries, "README", "g")).toBe("README (2)");
    expect(entries.size).toBe(7);
  });
});
