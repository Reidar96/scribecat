export const TASKS_FOLDER_NAME = "Gjøremål";
export const UNCATEGORIZED_TASK_CATEGORY = "Uten kategori";

export type TaskDeadline = string | null;

export type MarkdownTask = {
  lineIndex: number;
  checked: boolean;
  text: string;
  deadline: TaskDeadline;
};

export type NewMarkdownTask = {
  checked?: boolean;
  text: string;
  deadline?: TaskDeadline;
};

const TASK_LINE_PATTERN = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const DEADLINE_SUFFIX_PATTERN = /^(.*?)(?:\s+📅\s+(\d{4}-\d{2}-\d{2}))\s*$/;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function sanitizeTaskCategory(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();

  return cleaned || UNCATEGORIZED_TASK_CATEGORY;
}

export function taskRelativePath(category: string): string {
  return `${TASKS_FOLDER_NAME}/${sanitizeTaskCategory(category)}.md`;
}

export function taskCategoryFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  const prefix = `${TASKS_FOLDER_NAME}/`;

  if (!normalized.startsWith(prefix) || !normalized.toLowerCase().endsWith(".md")) {
    return null;
  }

  const tail = normalized.slice(prefix.length);
  if (!tail || tail.includes("/")) {
    return null;
  }

  return sanitizeTaskCategory(tail);
}

export function isTaskRelativePath(relativePath: string): boolean {
  return taskCategoryFromRelativePath(relativePath) !== null;
}

export function parseTaskMarkdown(markdown: string): MarkdownTask[] {
  return markdown.split(/\r?\n/).flatMap((line, lineIndex) => {
    const match = TASK_LINE_PATTERN.exec(line);
    if (!match) {
      return [];
    }

    const rawContent = match[3].trim();
    const deadlineMatch = DEADLINE_SUFFIX_PATTERN.exec(rawContent);
    const text = (deadlineMatch?.[1] ?? rawContent).trim();
    const deadline = deadlineMatch?.[2] ?? null;

    if (!text) {
      return [];
    }

    return [
      {
        lineIndex,
        checked: match[2].toLowerCase() === "x",
        text,
        deadline
      }
    ];
  });
}

export function formatTaskLine(task: NewMarkdownTask): string {
  const text = task.text.trim();
  const deadline = task.deadline?.trim();

  return `- [${task.checked ? "x" : " "}] ${text}${deadline ? ` 📅 ${deadline}` : ""}`;
}

export function createTaskDocument(
  category: string,
  task?: NewMarkdownTask
): string {
  const heading = `# ${sanitizeTaskCategory(category)}`;
  return task
    ? `${heading}\n\n${formatTaskLine(task)}\n`
    : `${heading}\n`;
}

export function appendTaskToMarkdown(
  markdown: string,
  task: NewMarkdownTask
): string {
  const trimmedEnd = markdown.replace(/\s+$/g, "");
  const separator = trimmedEnd ? "\n\n" : "";
  return `${trimmedEnd}${separator}${formatTaskLine(task)}\n`;
}

export function updateTaskInMarkdown(
  markdown: string,
  lineIndex: number,
  task: NewMarkdownTask
): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return markdown;
  }

  const existing = TASK_LINE_PATTERN.exec(lines[lineIndex]);
  if (!existing) {
    return markdown;
  }

  lines[lineIndex] = `${existing[1]}${formatTaskLine(task)}`;
  return lines.join("\n");
}

export function removeTaskFromMarkdown(
  markdown: string,
  lineIndex: number
): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length || !TASK_LINE_PATTERN.test(lines[lineIndex])) {
    return markdown;
  }

  lines.splice(lineIndex, 1);

  while (lines.length > 1 && lines[lines.length - 1] === "" && lines[lines.length - 2] === "") {
    lines.pop();
  }

  return lines.join("\n").replace(/\n?$/, "\n");
}
