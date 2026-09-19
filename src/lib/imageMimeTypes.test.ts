import { describe, expect, it } from "vitest";

import { guessImageMimeType } from "./imageMimeTypes";

describe("guessImageMimeType", () => {
  it("maps the extension regardless of case and path shape", () => {
    expect(guessImageMimeType("images/photo.PNG")).toBe("image/png");
    expect(guessImageMimeType("C:\vault\images\a.b.JpEg")).toBe("image/jpeg");
    expect(guessImageMimeType("diagram.svg")).toBe("image/svg+xml");
  });

  it("falls back to a generic type for anything it does not know", () => {
    expect(guessImageMimeType("photo.heic")).toBe("application/octet-stream");
    expect(guessImageMimeType("no-extension")).toBe("application/octet-stream");
  });
});
