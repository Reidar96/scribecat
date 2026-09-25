import { describe, expect, it } from "vitest";

import {
  parseTaskMetadataSuffix,
  setTaskMetadataValue,
  taskMetadataIsoDate
} from "@/lib/taskMetadata";

describe("task metadata", () => {
  it("parses multiple internal metadata suffixes without exposing them as task text", () => {
    expect(
      parseTaskMetadataSuffix(
        "Skriv rapport <!-- scribecat:created=2026-09-24T08:00:00.000Z --> <!-- scribecat:modified=2026-09-25T10:15:30.000Z -->"
      )
    ).toEqual({
      content: "Skriv rapport",
      metadata: {
        created: "2026-09-24T08:00:00.000Z",
        modified: "2026-09-25T10:15:30.000Z"
      }
    });
  });

  it("updates one metadata value while preserving the others", () => {
    expect(
      setTaskMetadataValue(
        "Oppgave <!-- scribecat:created=2026-09-24T08:00:00.000Z -->",
        "modified",
        "2026-09-25T11:00:00.000Z"
      )
    ).toBe(
      "Oppgave <!-- scribecat:created=2026-09-24T08:00:00.000Z --> <!-- scribecat:modified=2026-09-25T11:00:00.000Z -->"
    );
  });

  it("normalizes valid ISO timestamps and ignores invalid dates", () => {
    expect(
      taskMetadataIsoDate(
        { modified: "2026-09-25T12:00:00+02:00" },
        "modified"
      )
    ).toBe("2026-09-25T10:00:00.000Z");

    expect(
      taskMetadataIsoDate({ modified: "ikke-en-dato" }, "modified")
    ).toBeUndefined();
  });
});
