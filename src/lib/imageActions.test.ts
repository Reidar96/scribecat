import { describe, expect, it } from "vitest";

import { suggestedImageFileName } from "@/lib/imageActions";

describe("image context actions", () => {
  it("keeps a source filename when it has an image extension", () => {
    expect(
      suggestedImageFileName("../_attachments/Ferie%20bilde.jpg", "Sommer")
    ).toBe("Ferie bilde.jpg");
  });

  it("falls back to a safe alt label for object-like sources", () => {
    expect(
      suggestedImageFileName("blob:https://example.test/1234", "Diagram / utkast")
    ).toBe("Diagram - utkast");
  });

  it("uses a neutral fallback when neither source nor alt has a useful name", () => {
    expect(suggestedImageFileName("blob:", "")).toBe("image");
  });
});
