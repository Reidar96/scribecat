import { describe, expect, it } from "vitest";

import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  isTasksContainerRelativePath,
  parseTaskMarkdown,
  removeTaskFromMarkdown,
  renameTaskDocumentHeading,
  sanitizeTaskCategory,
  taskCategoryFromRelativePath,
  taskRelativePath,
  updateTaskInMarkdown
} from "@/lib/tasks";

describe("tasks markdown", () => {
  it("parses portable checkbox tasks with deadline, priority, tags and notes", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Send rapport 🔴 📅 2026-10-01 🏷️ #jobb #kunde",
      "  > Husk vedlegget",
      "  > Ring Kari først",
      "- [x] Bestill møterom",
      "",
      "Vanlig tekst beholdes."
    ].join("\n");

    expect(parseTaskMarkdown(markdown)).toEqual([
      {
        lineIndex: 2,
        endLineIndex: 4,
        checked: false,
        text: "Send rapport",
        deadline: "2026-10-01",
        note: "Husk vedlegget\nRing Kari først",
        tags: ["jobb", "kunde"],
        priority: "high"
      },
      {
        lineIndex: 5,
        endLineIndex: 5,
        checked: true,
        text: "Bestill møterom",
        deadline: null,
        note: "",
        tags: [],
        priority: null
      }
    ]);
  });

  it("keeps old checkbox-only markdown compatible", () => {
    expect(parseTaskMarkdown("- [ ] Første\n")).toEqual([
      {
        lineIndex: 0,
        endLineIndex: 0,
        checked: false,
        text: "Første",
        deadline: null,
        note: "",
        tags: [],
        priority: null
      }
    ]);
  });

  it("updates and removes task blocks without replacing unrelated markdown", () => {
    const markdown = "# Jobb\n\nIntro\n\n- [ ] Første\n  > Gammel note\n- [ ] Andre\n";

    const updated = updateTaskInMarkdown(markdown, 4, {
      checked: true,
      text: "Første oppdatert",
      deadline: "2026-12-24",
      note: "Ny note",
      tags: ["viktig"],
      priority: "medium"
    });

    expect(updated).toContain("Intro");
    expect(updated).toContain("- [x] Første oppdatert 🟡 📅 2026-12-24 🏷️ #viktig");
    expect(updated).toContain("  > Ny note");
    expect(updated).not.toContain("Gammel note");

    const second = parseTaskMarkdown(updated).find((task) => task.text === "Andre");
    expect(second).toBeDefined();

    const removed = removeTaskFromMarkdown(updated, second?.lineIndex ?? -1);
    expect(removed).not.toContain("Andre");
    expect(removed).toContain("Intro");
  });

  it("appends to an existing document and creates a category document", () => {
    expect(
      appendTaskToMarkdown("# Fritid\n", {
        text: "Bestill billetter",
        deadline: null,
        note: "Sjekk pris",
        tags: ["reise"],
        priority: "low"
      })
    ).toContain("- [ ] Bestill billetter 🟢 🏷️ #reise\n  > Sjekk pris");

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
    expect(isTasksContainerRelativePath("Gjøremål")).toBe(true);
    expect(isTasksContainerRelativePath("Gjøremål/Jobb.md")).toBe(true);
    expect(isTasksContainerRelativePath("Notater/Gjøremål.md")).toBe(false);
  });

  it("renames the category heading without changing the task body", () => {
    expect(renameTaskDocumentHeading("# Jobb\n\n- [ ] Lever\n", "Kunder")).toBe(
      "# Kunder\n\n- [ ] Lever\n"
    );
  });
});
