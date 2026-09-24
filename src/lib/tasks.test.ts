import { describe, expect, it } from "vitest";

import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  parseTaskMarkdown,
  removeTaskFromMarkdown,
  sanitizeTaskCategory,
  taskCategoryFromRelativePath,
  taskRelativePath,
  updateTaskInMarkdown
} from "@/lib/tasks";

describe("tasks markdown", () => {
  it("parses portable checkbox tasks and optional deadlines", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Send rapport 📅 2026-10-01",
      "- [x] Bestill møterom",
      "",
      "Vanlig tekst beholdes."
    ].join("\n");

    expect(parseTaskMarkdown(markdown)).toEqual([
      {
        lineIndex: 2,
        checked: false,
        text: "Send rapport",
        deadline: "2026-10-01"
      },
      {
        lineIndex: 3,
        checked: true,
        text: "Bestill møterom",
        deadline: null
      }
    ]);
  });

  it("updates and removes task lines without replacing unrelated markdown", () => {
    const markdown = "# Jobb\n\nIntro\n\n- [ ] Første\n- [ ] Andre\n";

    const updated = updateTaskInMarkdown(markdown, 4, {
      checked: true,
      text: "Første oppdatert",
      deadline: "2026-12-24"
    });

    expect(updated).toContain("Intro");
    expect(updated).toContain("- [x] Første oppdatert 📅 2026-12-24");

    const removed = removeTaskFromMarkdown(updated, 5);
    expect(removed).not.toContain("Andre");
    expect(removed).toContain("Intro");
  });

  it("appends to an existing document and creates a category document", () => {
    expect(
      appendTaskToMarkdown("# Fritid\n", {
        text: "Bestill billetter",
        deadline: null
      })
    ).toContain("- [ ] Bestill billetter");

    expect(
      createTaskDocument("Jobb", {
        text: "Send tilbud",
        deadline: "2026-11-01"
      })
    ).toBe("# Jobb\n\n- [ ] Send tilbud 📅 2026-11-01\n");
  });

  it("maps categories to one markdown file per category", () => {
    expect(taskRelativePath("Jobb")).toBe("Gjøremål/Jobb.md");
    expect(taskCategoryFromRelativePath("Gjøremål/Fritid.md")).toBe("Fritid");
    expect(taskCategoryFromRelativePath("Notater/Fritid.md")).toBeNull();
    expect(sanitizeTaskCategory("  ")).toBe(UNCATEGORIZED_TASK_CATEGORY);
    expect(taskRelativePath("Kunde / salg")).toBe("Gjøremål/Kunde - salg.md");
  });
});
