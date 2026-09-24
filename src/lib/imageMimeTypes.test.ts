import { describe, expect, it } from "vitest";

import { guessImageMimeType } from "./imageMimeTypes";

describe("guessImageMimeType", () => {
  it("maps the extension regardless of case and path shape", () => {
    expect(guessImageMimeType("images/photo.PNG")).toBe("image/png");
    expect(guessImageMimeType("C:\vault\images\a.b.JpEg")).toBe("image/jpeg");
    expect(guessImageMimeType("diagram.svg")).toBe("image/svg+xml");
  });

  it("recognizes modern phone photo formats", () => {
    expect(guessImageMimeType("photo.HEIC")).toBe("image/heic");
    expect(guessImageMimeType("photo.heif")).toBe("image/heif");
    expect(guessImageMimeType("photo.avif")).toBe("image/avif");
  });

  it("falls back to a generic type for anything it does not know", () => {
    expect(guessImageMimeType("no-extension")).toBe("application/octet-stream");
  });
});
