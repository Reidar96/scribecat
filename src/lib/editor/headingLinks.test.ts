import { describe, expect, it } from "vitest";
import { headingLinkHref, parseHeadingLink, pastedHeadingHref } from "./headingLinks";

describe("heading links", () => {
  it("keeps the vault-relative destination when copied across documents", () => {
    const href = headingLinkHref("/vault", "/vault/Notater/Min bok.md", "#kapittel-2");
    expect(href).toBe("scribecat://note/Notater/Min%20bok.md#kapittel-2");
    expect(parseHeadingLink(href)).toEqual({ relativePath: "Notater/Min bok.md", anchor: "#kapittel-2" });
    expect(pastedHeadingHref(`[Kapittel 2](${href})`, "")).toBe(href);
  });
  it("rejects paths that escape the vault", () => {
    expect(parseHeadingLink("scribecat://note/../Hemmelig.md#x")).toBeNull();
    expect(parseHeadingLink("scribecat://note/%2Fetc/passwd.md#x")).toBeNull();
    expect(parseHeadingLink("https://example.org/#x")).toBeNull();
  });
});
