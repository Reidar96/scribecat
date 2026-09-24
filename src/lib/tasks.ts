export const TASKS_FOLDER_NAME = "Gjøremål";
export const UNCATEGORIZED_TASK_CATEGORY = "Uten kategori";

export type TaskSettings = {
  hideFromSidebar: boolean;
};

export const DEFAULT_TASK_SETTINGS: TaskSettings = {
  hideFromSidebar: true
};

export function normalizeTaskSettings(value: unknown): TaskSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_TASK_SETTINGS;
  }

  return {
    hideFromSidebar: (value as { hideFromSidebar?: unknown }).hideFromSidebar !== false
  };
}

export type TaskDeadline = string | null;
export type TaskPriority = "high" | "medium" | "low" | null;

export type MarkdownTask = {
  lineIndex: number;
  endLineIndex: number;
  checked: boolean;
  text: string;
  deadline: TaskDeadline;
  note: string;
  tags: string[];
  priority: TaskPriority;
};

export type NewMarkdownTask = {
  checked?: boolean;
  text: string;
  deadline?: TaskDeadline;
  note?: string;
  tags?: string[];
  priority?: TaskPriority;
};

const TASK_LINE_PATTERN = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const TASK_NOTE_PATTERN = /^\s{2,}>\s?(.*)$/;
const TAGS_SUFFIX_PATTERN = /^(.*?)(?:\s+🏷️\s+(.+))\s*$/;
const DEADLINE_SUFFIX_PATTERN = /^(.*?)(?:\s+📅\s+(\d{4}-\d{2}-\d{2}))\s*$/;
const PRIORITY_SUFFIX_PATTERN = /^(.*?)(?:\s+(🔴|🟡|🟢))\s*$/;

const PRIORITY_TO_MARKER: Record<Exclude<TaskPriority, null>, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢"
};

const MARKER_TO_PRIORITY: Record<string, Exclude<TaskPriority, null>> = {
  "🔴": "high",
  "🟡": "medium",
  "🟢": "low"
};

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/g, "");
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

export function normalizeTaskTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tags) {
    const cleaned = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}_\-/]/gu, "")
      .replace(/^-+|-+$/g, "");

    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
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

export function isTasksContainerRelativePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return normalized === TASKS_FOLDER_NAME || normalized.startsWith(`${TASKS_FOLDER_NAME}/`);
}

function parseTaskContent(rawContent: string): {
  text: string;
  deadline: TaskDeadline;
  tags: string[];
  priority: TaskPriority;
} {
  let remainder = rawContent.trim();
  let tags: string[] = [];
  let deadline: TaskDeadline = null;
  let priority: TaskPriority = null;

  const tagsMatch = TAGS_SUFFIX_PATTERN.exec(remainder);
  if (tagsMatch) {
    remainder = tagsMatch[1].trim();
    tags = normalizeTaskTags(tagsMatch[2].split(/[\s,]+/g));
  }

  const deadlineMatch = DEADLINE_SUFFIX_PATTERN.exec(remainder);
  if (deadlineMatch) {
    remainder = deadlineMatch[1].trim();
    deadline = deadlineMatch[2];
  }

  const priorityMatch = PRIORITY_SUFFIX_PATTERN.exec(remainder);
  if (priorityMatch) {
    remainder = priorityMatch[1].trim();
    priority = MARKER_TO_PRIORITY[priorityMatch[2]] ?? null;
  }

  return {
    text: remainder,
    deadline,
    tags,
    priority
  };
}

function taskNoteEndIndex(lines: string[], lineIndex: number): number {
  let end = lineIndex;

  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (!TASK_NOTE_PATTERN.test(lines[index])) break;
    end = index;
  }

  return end;
}

function parseTaskNote(lines: string[], lineIndex: number, endLineIndex: number): string {
  if (endLineIndex <= lineIndex) return "";

  return lines
    .slice(lineIndex + 1, endLineIndex + 1)
    .map((line) => TASK_NOTE_PATTERN.exec(line)?.[1] ?? "")
    .join("\n")
    .trimEnd();
}

export function parseTaskMarkdown(markdown: string): MarkdownTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: MarkdownTask[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = TASK_LINE_PATTERN.exec(lines[lineIndex]);
    if (!match) continue;

    const parsed = parseTaskContent(match[3]);
    if (!parsed.text) continue;

    const endLineIndex = taskNoteEndIndex(lines, lineIndex);
    tasks.push({
      lineIndex,
      endLineIndex,
      checked: match[2].toLowerCase() === "x",
      text: parsed.text,
      deadline: parsed.deadline,
      note: parseTaskNote(lines, lineIndex, endLineIndex),
      tags: parsed.tags,
      priority: parsed.priority
    });

    lineIndex = endLineIndex;
  }

  return tasks;
}

export function formatTaskLine(task: NewMarkdownTask): string {
  const text = task.text.trim();
  const deadline = task.deadline?.trim();
  const tags = normalizeTaskTags(task.tags ?? []);
  const priority = task.priority ? PRIORITY_TO_MARKER[task.priority] : "";

  return [
    `- [${task.checked ? "x" : " "}] ${text}`,
    priority,
    deadline ? `📅 ${deadline}` : "",
    tags.length > 0 ? `🏷️ ${tags.map((tag) => `#${tag}`).join(" ")}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTaskBlock(task: NewMarkdownTask): string {
  const note = (task.note ?? "").replace(/\r\n/g, "\n").trim();
  if (!note) return formatTaskLine(task);

  return [
    formatTaskLine(task),
    ...note.split("\n").map((line) => `  > ${line}`)
  ].join("\n");
}

export function createTaskDocument(
  category: string,
  task?: NewMarkdownTask
): string {
  const heading = `# ${sanitizeTaskCategory(category)}`;
  return task
    ? `${heading}\n\n${formatTaskBlock(task)}\n`
    : `${heading}\n`;
}

export function appendTaskToMarkdown(
  markdown: string,
  task: NewMarkdownTask
): string {
  const trimmedEnd = markdown.replace(/\s+$/g, "");
  const separator = trimmedEnd ? "\n\n" : "";
  return `${trimmedEnd}${separator}${formatTaskBlock(task)}\n`;
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

  const endLineIndex = taskNoteEndIndex(lines, lineIndex);
  const replacement = formatTaskBlock(task).split("\n");
  replacement[0] = `${existing[1]}${replacement[0]}`;

  lines.splice(lineIndex, endLineIndex - lineIndex + 1, ...replacement);
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

  const endLineIndex = taskNoteEndIndex(lines, lineIndex);
  lines.splice(lineIndex, endLineIndex - lineIndex + 1);

  while (lines.length > 1 && lines[lines.length - 1] === "" && lines[lines.length - 2] === "") {
    lines.pop();
  }

  return lines.join("\n").replace(/\n?$/, "\n");
}

export function renameTaskDocumentHeading(markdown: string, category: string): string {
  const heading = `# ${sanitizeTaskCategory(category)}`;
  if (/^#\s+.*$/m.test(markdown)) {
    return markdown.replace(/^#\s+.*$/m, heading);
  }

  const trimmedStart = markdown.replace(/^\s+/, "");
  return `${heading}\n\n${trimmedStart}`;
}
