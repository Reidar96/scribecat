import { describe, expect, it } from "vitest";

import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  isTasksContainerRelativePath,
  normalizeTaskSettings,
  parseTaskMarkdown,
  insertSubtaskInMarkdown,
  moveSiblingTaskInMarkdown,
  moveSubtaskInMarkdown,
  prependTaskToMarkdown,
  removeTaskFromMarkdown,
  renameTaskDocumentHeading,
  setTaskSubtreeCheckedInMarkdown,
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
        priority: "high",
        indent: 0,
        parentLineIndex: null
      },
      {
        lineIndex: 5,
        endLineIndex: 5,
        checked: true,
        text: "Bestill møterom",
        deadline: null,
        note: "",
        tags: [],
        priority: null,
        indent: 0,
        parentLineIndex: null
      }
    ]);
  });

  it("stores task-level modified time in an invisible Markdown comment", () => {
    const modifiedAt = "2026-09-25T10:15:30.000Z";
    const markdown = createTaskDocument("Jobb", {
      text: "Oppdatert oppgave",
      modifiedAt
    });

    expect(markdown).toContain(
      "<!-- scribecat:modified=2026-09-25T10:15:30.000Z -->"
    );
    expect(parseTaskMarkdown(markdown)[0]).toMatchObject({
      text: "Oppdatert oppgave",
      modifiedAt
    });
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
        priority: null,
        indent: 0,
        parentLineIndex: null
      }
    ]);
  });

  it("parses one-level subtasks and keeps them as portable indented Markdown", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Hovedoppgave",
      "  - [ ] Første underoppgave",
      "  - [x] Andre underoppgave",
      "- [ ] Neste hovedoppgave"
    ].join("\n");

    expect(parseTaskMarkdown(markdown)).toEqual([
      {
        lineIndex: 2,
        endLineIndex: 2,
        checked: false,
        text: "Hovedoppgave",
        deadline: null,
        note: "",
        tags: [],
        priority: null,
        indent: 0,
        parentLineIndex: null
      },
      {
        lineIndex: 3,
        endLineIndex: 3,
        checked: false,
        text: "Første underoppgave",
        deadline: null,
        note: "",
        tags: [],
        priority: null,
        indent: 2,
        parentLineIndex: 2
      },
      {
        lineIndex: 4,
        endLineIndex: 4,
        checked: true,
        text: "Andre underoppgave",
        deadline: null,
        note: "",
        tags: [],
        priority: null,
        indent: 2,
        parentLineIndex: 2
      },
      {
        lineIndex: 5,
        endLineIndex: 5,
        checked: false,
        text: "Neste hovedoppgave",
        deadline: null,
        note: "",
        tags: [],
        priority: null,
        indent: 0,
        parentLineIndex: null
      }
    ]);

    const inserted = insertSubtaskInMarkdown(markdown, 2, {
      text: "Tredje underoppgave",
      note: "Kort notat"
    });

    expect(inserted).toContain("  - [ ] Tredje underoppgave\n    > Kort notat");

    const insertedFirst = insertSubtaskInMarkdown(
      markdown,
      2,
      { text: "Ny først" },
      "first"
    );
    expect(insertedFirst.indexOf("Ny først")).toBeLessThan(
      insertedFirst.indexOf("Første underoppgave")
    );
    expect(
      parseTaskMarkdown(inserted).find((task) => task.text === "Tredje underoppgave")
        ?.parentLineIndex
    ).toBe(2);
  });

  it("reorders sibling subtasks while keeping their Markdown blocks intact", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Hovedoppgave",
      "  - [ ] Første",
      "    > Notat til første",
      "  - [ ] Andre",
      "  - [ ] Tredje",
      "- [ ] Neste"
    ].join("\n");

    const parsed = parseTaskMarkdown(markdown);
    const first = parsed.find((task) => task.text === "Første");
    const third = parsed.find((task) => task.text === "Tredje");
    expect(first).toBeDefined();
    expect(third).toBeDefined();

    const moved = moveSubtaskInMarkdown(
      markdown,
      first?.lineIndex ?? -1,
      third?.lineIndex ?? -1,
      "after"
    );

    expect(moved.indexOf("Andre")).toBeLessThan(moved.indexOf("Tredje"));
    expect(moved.indexOf("Tredje")).toBeLessThan(moved.indexOf("Første"));
    expect(moved).toContain("    > Notat til første");
  });

  it("prepends a new root task ahead of the existing Markdown tasks", () => {
    const markdown = "# Jobb\n\n- [ ] Andre\n- [ ] Tredje\n";
    const next = prependTaskToMarkdown(markdown, { text: "Første" });

    expect(next.indexOf("- [ ] Første")).toBeLessThan(next.indexOf("- [ ] Andre"));
    expect(parseTaskMarkdown(next).map((task) => task.text)).toEqual([
      "Første",
      "Andre",
      "Tredje"
    ]);
  });

  it("reorders sibling root tasks without moving their subtasks away", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Første",
      "  - [ ] Barn",
      "- [ ] Andre",
      "- [ ] Tredje"
    ].join("\n");

    const parsed = parseTaskMarkdown(markdown);
    const first = parsed.find((task) => task.text === "Første");
    const third = parsed.find((task) => task.text === "Tredje");

    const moved = moveSiblingTaskInMarkdown(
      markdown,
      first?.lineIndex ?? -1,
      third?.lineIndex ?? -1,
      "after"
    );

    expect(moved.indexOf("Andre")).toBeLessThan(moved.indexOf("Tredje"));
    expect(moved.indexOf("Tredje")).toBeLessThan(moved.indexOf("Første"));
    expect(moved.indexOf("Første")).toBeLessThan(moved.indexOf("Barn"));
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

  it("removes a parent task together with its subtasks", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Hovedoppgave",
      "  - [ ] Underoppgave A",
      "  - [ ] Underoppgave B",
      "- [ ] Behold meg"
    ].join("\n");

    const removed = removeTaskFromMarkdown(markdown, 2);

    expect(removed).not.toContain("Hovedoppgave");
    expect(removed).not.toContain("Underoppgave A");
    expect(removed).not.toContain("Underoppgave B");
    expect(removed).toContain("Behold meg");
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
    expect(taskRelativePath("Jobb", "Oppgaver/Privat")).toBe("Oppgaver/Privat/Jobb.md");
    expect(taskCategoryFromRelativePath("Gjøremål/Fritid.md")).toBe("Fritid");
    expect(taskCategoryFromRelativePath("Oppgaver/Privat/Fritid.md", "Oppgaver/Privat")).toBe("Fritid");
    expect(taskCategoryFromRelativePath("Notater/Fritid.md")).toBeNull();
    expect(sanitizeTaskCategory("  ")).toBe(UNCATEGORIZED_TASK_CATEGORY);
    expect(taskRelativePath("Kunde / salg")).toBe("Gjøremål/Kunde - salg.md");
    expect(isTasksContainerRelativePath("Gjøremål")).toBe(true);
    expect(isTasksContainerRelativePath("Gjøremål/Jobb.md")).toBe(true);
    expect(isTasksContainerRelativePath("Notater/Gjøremål.md")).toBe(false);
    expect(isTasksContainerRelativePath("Oppgaver/Privat/Jobb.md", "Oppgaver/Privat")).toBe(true);
  });

  it("marks a completed parent and all of its subtasks together", () => {
    const markdown = [
      "# Jobb",
      "",
      "- [ ] Hovedoppgave",
      "  - [x] Ferdig fra før",
      "  - [ ] Ikke ferdig",
      "- [ ] Neste"
    ].join("\n");

    const completed = setTaskSubtreeCheckedInMarkdown(
      markdown,
      2,
      true,
      "2026-09-25T10:20:00.000Z"
    );
    expect(completed).toContain(
      "- [x] Hovedoppgave <!-- scribecat:modified=2026-09-25T10:20:00.000Z -->"
    );
    expect(completed).toContain(
      "  - [x] Ferdig fra før <!-- scribecat:modified=2026-09-25T10:20:00.000Z -->"
    );
    expect(completed).toContain(
      "  - [x] Ikke ferdig <!-- scribecat:modified=2026-09-25T10:20:00.000Z -->"
    );
    expect(completed).toContain("- [ ] Neste");
  });

  it("normalizes vault task settings with folder and hidden storage defaults", () => {
    expect(normalizeTaskSettings(undefined)).toEqual({
      folder: "Gjøremål",
      hideFromSidebar: true,
      sortMode: "manual"
    });
    expect(
      normalizeTaskSettings({
        folder: "Oppgaver / Privat",
        hideFromSidebar: false,
        sortMode: "modified"
      })
    ).toEqual({
      folder: "Oppgaver / Privat",
      hideFromSidebar: false,
      sortMode: "modified"
    });
  });

  it("renames the category heading without changing the task body", () => {
    expect(renameTaskDocumentHeading("# Jobb\n\n- [ ] Lever\n", "Kunder")).toBe(
      "# Kunder\n\n- [ ] Lever\n"
    );
  });
});
