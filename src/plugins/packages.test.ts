import { describe, expect, it } from "vitest";
import { parsePackageManifest } from "./packages";

describe("custom package manifest trust boundary", () => {
  const valid = { schemaVersion: 1, id: "mine-planter", name: "Mine planter", folder: "Planter", fields: [{ key: "stell", label: "Stell", multiline: true }] };
  it("accepts a declarative Markdown app", () => {
    expect(parsePackageManifest(valid).fields).toEqual([{ key: "stell", label: "Stell", multiline: true }]);
  });
  it("rejects traversal, duplicate field names and unsupported formats", () => {
    expect(() => parsePackageManifest({ ...valid, folder: "../private" })).toThrow();
    expect(() => parsePackageManifest({ ...valid, id: "../../tasks" })).toThrow();
    expect(() => parsePackageManifest({ ...valid, fields: [valid.fields[0], valid.fields[0]] })).toThrow();
    expect(() => parsePackageManifest({ ...valid, schemaVersion: 2 })).toThrow();
  });
});
