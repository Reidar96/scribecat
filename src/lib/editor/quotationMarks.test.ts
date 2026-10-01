import { describe, expect, it } from "vitest";
import { angleQuoteFor } from "./quotationMarks";

describe("angle quotation marks", () => {
  it("opens at a word boundary and closes after text", () => {
    expect(angleQuoteFor("")).toBe("«");
    expect(angleQuoteFor(" ")).toBe("«");
    expect(angleQuoteFor("(")).toBe("«");
    expect(angleQuoteFor("t")).toBe("»");
  });
});
