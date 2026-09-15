import { describe, expect, it, vi } from "vitest";

import type { MarkdownFileRecord } from "@/lib/fileSystem";

// exporter.ts reaches the filesystem through the Tauri plugins; none of that
// is touched by the ordering under test.
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => false,
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  writeTextFile: async () => undefined
}));
vi.mock("@/lib/fileSystem", () => ({
  allowMarkdownFolderAccess: async () => undefined,
  listMarkdownFiles: async () => []
}));

const { collectOrderedRecords, getDefaultExportBaseName } = await import("./exporter");

function record(relativePath: string): MarkdownFileRecord {
  return { filePath: `/vault/${relativePath}`, relativePath, mtimeMs: 0 };
}

describe("collectOrderedRecords with folder notes", () => {
  // A folder note is attached to its folder in the tree rather than listed as
  // a child, so the walk has to pick it up explicitly — and as the folder's
  // introduction it comes before the folder's own notes.
  it("exports a folder note first inside its folder", () => {
    const ordered = collectOrderedRecords(
      [
        record("Rezepte/Suppen.md"),
        record("Rezepte/.scribedog-foldernote.md"),
        record("Rezepte/Kuchen/Marmor.md"),
        record("Start.md")
      ],
      "name",
      {}
    );

    expect(ordered.map((entry) => entry.relativePath)).toEqual([
      "Rezepte/.scribedog-foldernote.md",
      "Rezepte/Kuchen/Marmor.md",
      "Rezepte/Suppen.md",
      "Start.md"
    ]);
  });
});

describe("getDefaultExportBaseName", () => {
  it("names a folder note's export after its folder", () => {
    expect(getDefaultExportBaseName("C:\\vault\\Rezepte\\.scribedog-foldernote.md")).toBe("Rezepte");
    expect(getDefaultExportBaseName("/vault/Rezepte/Kuchen.md")).toBe("Kuchen");
    expect(getDefaultExportBaseName("/vault/Rezepte/")).toBe("Rezepte");
  });
});
