// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { getLastOpenedRelativePath, setLastOpenedRelativePath } from "./lastOpenedFile";

describe("last opened note per vault", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("remembers one note per vault", () => {
    setLastOpenedRelativePath("/vault", "Projects/Roadmap.md");
    setLastOpenedRelativePath("C:\\Notes", "Daily.md");

    expect(getLastOpenedRelativePath("/vault")).toBe("Projects/Roadmap.md");
    expect(getLastOpenedRelativePath("C:\\Notes")).toBe("Daily.md");
    expect(getLastOpenedRelativePath("/other")).toBeNull();
  });

  it("forgets a note on null", () => {
    setLastOpenedRelativePath("/vault", "Projects/Roadmap.md");
    setLastOpenedRelativePath("/vault", null);

    expect(getLastOpenedRelativePath("/vault")).toBeNull();
  });
});
