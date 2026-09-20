import { describe, expect, it } from "vitest";

import { findCodeLinks } from "./codeBlockLinks";

describe("findCodeLinks", () => {
  it("finds http and https URLs with their offsets", () => {
    const text = "see https://example.com/a and http://foo.bar";

    expect(findCodeLinks(text)).toEqual([
      { from: 4, to: 25, href: "https://example.com/a" },
      { from: 30, to: 44, href: "http://foo.bar" }
    ]);
  });

  it("keeps the URL up to the next whitespace or comment", () => {
    const text = "https://open.spotify.com/playlist/49B9nXpw8kvWQ2Rguwk7Ru # Top 100";

    expect(findCodeLinks(text)).toEqual([
      { from: 0, to: 56, href: "https://open.spotify.com/playlist/49B9nXpw8kvWQ2Rguwk7Ru" }
    ]);
  });

  it("drops trailing punctuation and quotes", () => {
    expect(findCodeLinks('url = "https://example.com/path".')).toEqual([
      { from: 7, to: 31, href: "https://example.com/path" }
    ]);
    expect(findCodeLinks("fetch('https://example.com/x');")).toEqual([
      { from: 7, to: 28, href: "https://example.com/x" }
    ]);
    expect(findCodeLinks("curl https://example.com/x,")).toEqual([
      { from: 5, to: 26, href: "https://example.com/x" }
    ]);
  });

  it("drops an unbalanced closing bracket but keeps a balanced one", () => {
    expect(findCodeLinks("(https://example.com/x)")).toEqual([
      { from: 1, to: 22, href: "https://example.com/x" }
    ]);
    expect(findCodeLinks("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      { from: 0, to: 39, href: "https://en.wikipedia.org/wiki/Foo_(bar)" }
    ]);
    expect(findCodeLinks("[https://example.com/x]")).toEqual([
      { from: 1, to: 22, href: "https://example.com/x" }
    ]);
  });

  it("ignores a bare scheme and non-http schemes", () => {
    expect(findCodeLinks("https:// and ftp://host/file and mailto:x@y.z")).toEqual([]);
  });

  it("returns nothing for text without URLs", () => {
    expect(findCodeLinks("const x = 1;")).toEqual([]);
  });
});
