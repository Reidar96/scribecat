import { describe, expect, it } from "vitest";
import { parseReceiptReferences, receiptDisplayName, receiptReferencesMarkdown } from "../src/public/receiptModel.js";

describe("inventory receipt names", () => {
  it("keeps paths fixed while saving a readable download name", () => {
    const old = parseReceiptReferences("- _attachments/kvittering-1.pdf");
    expect(old).toEqual([{ path: "_attachments/kvittering-1.pdf", name: "kvittering-1.pdf" }]);
    const renamed = [{ ...old[0], name: receiptDisplayName("Elkjøp", old[0].path)! }];
    expect(renamed[0].name).toBe("Elkjøp.pdf");
    expect(parseReceiptReferences(receiptReferencesMarkdown(renamed), old[0].path)).toEqual(renamed);
  });
  it("rejects paths and names that could escape the attachment folder", () => {
    expect(parseReceiptReferences("- [bad](_attachments/../private.pdf)\n- _attachments/ok.pdf")).toHaveLength(1);
    expect(receiptDisplayName("../../secret", "_attachments/ok.pdf")).toBeNull();
  });
});
