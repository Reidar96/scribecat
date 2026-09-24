import { describe, expect, it } from "vitest";

import {
  extractTags,
  replaceBody,
  setTags,
  splitFrontmatter
} from "@/lib/documentFrontmatter";

describe("document frontmatter", () => {
  it("keeps frontmatter separate from the editor body", () => {
    expect(splitFrontmatter("---\ntitle: Test\n---\n# Hello\n")).toEqual({
      frontmatter: "title: Test",
      body: "# Hello\n"
    });
  });

  it("reads multiple YAML tags", () => {
    expect(extractTags("---\ntags:\n  - jobb\n  - \"viktig\"\n---\nText")).toEqual([
      "jobb",
      "viktig"
    ]);
  });

  it("accepts inline YAML tag lists", () => {
    expect(extractTags("---\ntags: [jobb, \"viktig\"]\n---\nText")).toEqual([
      "jobb",
      "viktig"
    ]);
  });

  it("updates tags without changing other frontmatter", () => {
    expect(
      setTags("---\ntitle: Hello\ntags:\n  - old\nauthor: Reidar\n---\nBody\n", [
        "prosjekt",
        "viktig"
      ])
    ).toBe(
      "---\ntitle: Hello\nauthor: Reidar\ntags:\n  - \"prosjekt\"\n  - \"viktig\"\n---\nBody\n"
    );
  });

  it("adds frontmatter when a note has no metadata", () => {
    expect(setTags("# Hello\n", ["jobb"])).toBe(
      "---\ntags:\n  - \"jobb\"\n---\n# Hello\n"
    );
  });

  it("removes empty tag metadata and keeps the body", () => {
    expect(setTags("---\ntags:\n  - jobb\n---\nBody\n", [])).toBe("Body\n");
  });

  it("replaces the visible body while preserving frontmatter", () => {
    expect(replaceBody("---\ntags: [jobb]\n---\nOld\n", "New\n")).toBe(
      "---\ntags: [jobb]\n---\nNew\n"
    );
  });
});
