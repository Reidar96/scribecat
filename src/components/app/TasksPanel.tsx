import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Home,
  PanelLeft,
  PanelLeftOpen,
  Pencil,
  Plus,
  SquareCheck,
  Tag,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  insertSubtaskInMarkdown,
  normalizeTaskTags,
  parseTaskMarkdown,
  removeTaskFromMarkdown,
  renameTaskDocumentHeading,
  setTaskSubtreeCheckedInMarkdown,
  sanitizeTaskCategory,
  taskCategoryFromRelativePath,
  taskRelativePath,
  updateTaskInMarkdown,
  type MarkdownTask,
  type TaskPriority
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { join } from "@/platform/paths";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

type TaskDocument = {
  category: string;
  filePath: string;
  markdown: string;
  tasks: MarkdownTask[];
};

type TaskItem = MarkdownTask & {
  category: string;
  filePath: string;
};

type TasksPanelProps = {
  folderPath: string;
  filePaths: string[];
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onOpenSidebar: () => void;
  onClose: () => void;
  onPersistTaskFile: (filePath: string, markdown: string) => Promise<boolean>;
  onRenameTaskFile: (filePath: string, newBaseName: string) => Promise<boolean>;
  onDeleteTaskFile: (filePath: string) => Promise<boolean>;
};

const ALL_TASKS = "__all__";
const TODAY_TASKS = "__today__";
const WEEK_TASKS = "__week__";
const MONTH_TASKS = "__month__";
const NEXT_MONTH_TASKS = "__next-month__";
const CATEGORY_PREFIX = "category:";
const TAG_PREFIX = "tag:";
const TASK_DRAG_MIME = "application/x-scribecat-task";

function categoryView(category: string): string {
  return `${CATEGORY_PREFIX}${category}`;
}

function tagView(tag: string): string {
  return `${TAG_PREFIX}${tag}`;
}

function deadlineSortValue(deadline: string | null): string {
  return deadline ?? "9999-99-99";
}

function prioritySortValue(priority: TaskPriority): number {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  if (priority === "low") return 2;
  return 3;
}

function compareTaskItems(left: TaskItem, right: TaskItem, locale: string): number {
  const priorityCompare =
    prioritySortValue(left.priority) - prioritySortValue(right.priority);
  if (priorityCompare !== 0) return priorityCompare;

  const deadlineCompare = deadlineSortValue(left.deadline).localeCompare(
    deadlineSortValue(right.deadline)
  );
  if (deadlineCompare !== 0) return deadlineCompare;

  return left.text.localeCompare(right.text, locale, { sensitivity: "base" });
}

function taskItemKey(task: Pick<TaskItem, "filePath" | "lineIndex">): string {
  return `${task.filePath}:${task.lineIndex}`;
}

function orderTaskGroups(
  roots: TaskItem[],
  childrenByParent: Map<string, TaskItem[]>,
  locale: string
): TaskItem[] {
  const orderedRoots = [...roots].sort((left, right) =>
    compareTaskItems(left, right, locale)
  );

  return orderedRoots.flatMap((root) => [
    root,
    ...(childrenByParent.get(taskItemKey(root)) ?? [])
      .slice()
      .sort((left, right) => left.lineIndex - right.lineIndex)
  ]);
}

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function currentWeekRange(now: Date): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return { start: dateKey(start), end: dateKey(end) };
}

function tagsFromInput(value: string): string[] {
  return normalizeTaskTags(value.split(/[\s,]+/g));
}

function TaskRow({
  task,
  isSubtask,
  onToggle,
  onTextChange,
  onDeadlineChange,
  onNoteChange,
  onTagsChange,
  onPriorityChange,
  onAddSubtask,
  onDelete
}: {
  task: TaskItem;
  isSubtask: boolean;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDeadlineChange: (deadline: string | null) => void;
  onNoteChange: (note: string) => void;
  onTagsChange: (tags: string[]) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onAddSubtask?: (text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [textDraft, setTextDraft] = useState(task.text);
  const [noteDraft, setNoteDraft] = useState(task.note);
  const [tagsDraft, setTagsDraft] = useState(
    task.tags.map((tag) => `#${tag}`).join(" ")
  );
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  useEffect(() => {
    setTextDraft(task.text);
  }, [task.text]);

  useEffect(() => {
    setNoteDraft(task.note);
  }, [task.note]);

  useEffect(() => {
    setTagsDraft(task.tags.map((tag) => `#${tag}`).join(" "));
  }, [task.tags]);

  const todayKey = dateKey(new Date());
  const overdue = Boolean(!task.checked && task.deadline && task.deadline < todayKey);

  const commitText = () => {
    const next = textDraft.trim();
    if (!next) {
      setTextDraft(task.text);
      return;
    }
    if (next !== task.text) {
      onTextChange(next);
    }
  };

  const commitNote = () => {
    const next = noteDraft.trim();
    if (next !== task.note) {
      onNoteChange(next);
    }
  };

  const commitTags = () => {
    const next = tagsFromInput(tagsDraft);
    const current = task.tags.join("\u0000");
    if (next.join("\u0000") !== current) {
      onTagsChange(next);
    }
    setTagsDraft(next.map((tag) => `#${tag}`).join(" "));
  };

  const startDrag = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      TASK_DRAG_MIME,
      JSON.stringify({ filePath: task.filePath, lineIndex: task.lineIndex })
    );
    event.dataTransfer.setData("text/plain", task.text);
  };

  const submitSubtask = async () => {
    const text = subtaskDraft.trim();
    if (!text || !onAddSubtask || addingSubtask) return;

    setAddingSubtask(true);
    try {
      if (await onAddSubtask(text)) {
        setSubtaskDraft("");
        setSubtaskOpen(false);
      }
    } finally {
      setAddingSubtask(false);
    }
  };

  if (isSubtask && task.checked) {
    return (
      <article className="tasks-item tasks-item--subtask tasks-item--subtask-completed">
        <span className="tasks-item__completed-title">{task.text}</span>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "tasks-item",
        isSubtask && "tasks-item--subtask",
        task.checked && "tasks-item--checked",
        overdue && "tasks-item--overdue",
        task.priority && `tasks-item--priority-${task.priority}`
      )}
    >
      <button
        type="button"
        className="tasks-item__drag"
        draggable={!isSubtask}
        disabled={isSubtask}
        onDragStart={startDrag}
        aria-label={t("tasks.dragTask")}
        title={t("tasks.dragTask")}
      >
        <GripVertical aria-hidden="true" />
      </button>

      <label className="tasks-item__check">
        <input
          type="checkbox"
          checked={task.checked}
          onChange={onToggle}
          aria-label={t("tasks.toggle", { task: task.text })}
        />
        <span aria-hidden="true" />
      </label>

      <div className="tasks-item__content">
        <input
          className="tasks-item__text"
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setTextDraft(task.text);
              event.currentTarget.blur();
            }
          }}
          aria-label={t("tasks.taskText")}
        />

        {!isSubtask || !task.checked ? (
          !isSubtask ? (
            <>
              <textarea
                className="tasks-item__note"
                value={noteDraft}
                rows={noteDraft ? 2 : 1}
                onChange={(event) => setNoteDraft(event.target.value)}
                onBlur={commitNote}
                placeholder={t("tasks.notePlaceholder")}
                aria-label={t("tasks.note")}
              />

              <div className="tasks-item__meta">
                <span className="tasks-item__category">{task.category}</span>

                <label className="tasks-item__deadline">
                  <CalendarClock aria-hidden="true" />
                  <input
                    type="date"
                    value={task.deadline ?? ""}
                    onChange={(event) => onDeadlineChange(event.target.value || null)}
                    aria-label={t("tasks.deadline")}
                  />
                </label>

                <label className="tasks-item__tags">
                  <Tag aria-hidden="true" />
                  <input
                    value={tagsDraft}
                    onChange={(event) => setTagsDraft(event.target.value)}
                    onBlur={commitTags}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder={t("tasks.tagsPlaceholder")}
                    aria-label={t("tasks.tags")}
                  />
                </label>

                <div className="tasks-priority" aria-label={t("tasks.priority")}>
                  {(["high", "medium", "low"] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      className={cn(
                        "tasks-priority__dot",
                        `tasks-priority__dot--${priority}`,
                        task.priority === priority && "tasks-priority__dot--active"
                      )}
                      aria-pressed={task.priority === priority}
                      aria-label={t(`tasks.priority${priority[0].toUpperCase()}${priority.slice(1)}`)}
                      title={t(`tasks.priority${priority[0].toUpperCase()}${priority.slice(1)}`)}
                      onClick={() =>
                        onPriorityChange(task.priority === priority ? null : priority)
                      }
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null
        ) : null}

        {subtaskOpen && onAddSubtask ? (
          <form
            className="tasks-item__subtask-create"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSubtask();
            }}
          >
            <input
              autoFocus
              value={subtaskDraft}
              onChange={(event) => setSubtaskDraft(event.target.value)}
              placeholder={t("tasks.newSubtask")}
              aria-label={t("tasks.newSubtask")}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSubtaskDraft("");
                  setSubtaskOpen(false);
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!subtaskDraft.trim() || addingSubtask}
            >
              <Plus />
              {t("tasks.add")}
            </Button>
          </form>
        ) : null}
      </div>

      <div className="tasks-item__actions">
        {onAddSubtask ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setSubtaskOpen((open) => !open)}
            aria-label={t("tasks.addSubtask")}
            title={t("tasks.addSubtask")}
          >
            <Plus />
          </Button>
        ) : null}

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="tasks-item__delete"
          onClick={onDelete}
          aria-label={t("tasks.delete")}
          title={t("tasks.delete")}
        >
          <Trash2 />
        </Button>
      </div>
    </article>
  );
}

export function TasksPanel({
  folderPath,
  filePaths,
  sidebarVisible,
  onSidebarVisibilityToggle,
  onOpenSidebar,
  onClose,
  onPersistTaskFile,
  onRenameTaskFile,
  onDeleteTaskFile
}: TasksPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const taskSettings = useEditorSettingsStore((state) => state.taskSettings);
  const [documents, setDocuments] = useState<Record<string, TaskDocument>>({});
  const [selectedView, setSelectedView] = useState(ALL_TASKS);
  const [textDraft, setTextDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<TaskPriority>(null);
  const [saving, setSaving] = useState(false);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [categoryDelete, setCategoryDelete] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const taskFiles = filePaths.flatMap((filePath) => {
      const relativePath = getRelativeDisplayPath(folderPath, filePath);
      const category = taskCategoryFromRelativePath(relativePath, taskSettings.folder);
      return category ? [{ category, filePath }] : [];
    });

    void Promise.all(
      taskFiles.map(async ({ category, filePath }) => {
        try {
          const markdown = await readMarkdownFile(filePath);
          return {
            category,
            filePath,
            markdown,
            tasks: parseTaskMarkdown(markdown)
          } satisfies TaskDocument;
        } catch {
          return null;
        }
      })
    ).then((loaded) => {
      if (!active) return;

      const next: Record<string, TaskDocument> = {};
      for (const document of loaded) {
        if (document) next[document.category] = document;
      }
      setDocuments(next);
    });

    return () => {
      active = false;
    };
  }, [filePaths, folderPath, taskSettings.folder]);

  const categories = useMemo(
    () =>
      Object.values(documents)
        .map((document) => document.category)
        .sort((left, right) =>
          left.localeCompare(right, i18n.resolvedLanguage ?? i18n.language, {
            sensitivity: "base"
          })
        ),
    [documents, i18n.language, i18n.resolvedLanguage]
  );

  const allTasks = useMemo<TaskItem[]>(
    () =>
      Object.values(documents).flatMap((document) =>
        document.tasks.map((task) => ({
          ...task,
          category: document.category,
          filePath: document.filePath
        }))
      ),
    [documents]
  );

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const rootTasks = useMemo(
    () => allTasks.filter((task) => task.parentLineIndex === null),
    [allTasks]
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of allTasks) {
      if (task.parentLineIndex === null) continue;
      const key = `${task.filePath}:${task.parentLineIndex}`;
      const current = map.get(key) ?? [];
      current.push(task);
      map.set(key, current);
    }
    return map;
  }, [allTasks]);
  const activeRootTasks = useMemo(
    () => rootTasks.filter((task) => !task.checked),
    [rootTasks]
  );

  const now = new Date();
  const todayKey = dateKey(now);
  const weekRange = currentWeekRange(now);
  const monthKey = todayKey.slice(0, 7);
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthKey = dateKey(nextMonthDate).slice(0, 7);

  const filteredRootTasks = useMemo(() => {
    if (selectedView === TODAY_TASKS) {
      return rootTasks.filter((task) => task.deadline === todayKey);
    }

    if (selectedView === WEEK_TASKS) {
      return rootTasks.filter(
        (task) =>
          task.deadline !== null &&
          task.deadline >= weekRange.start &&
          task.deadline <= weekRange.end
      );
    }

    if (selectedView === MONTH_TASKS) {
      return rootTasks.filter((task) => task.deadline?.startsWith(monthKey));
    }

    if (selectedView === NEXT_MONTH_TASKS) {
      return rootTasks.filter((task) => task.deadline?.startsWith(nextMonthKey));
    }

    if (selectedView.startsWith(CATEGORY_PREFIX)) {
      const category = selectedView.slice(CATEGORY_PREFIX.length);
      return rootTasks.filter((task) => task.category === category);
    }

    if (selectedView.startsWith(TAG_PREFIX)) {
      const tag = selectedView.slice(TAG_PREFIX.length).toLocaleLowerCase();
      return rootTasks.filter((task) => {
        const group = [task, ...(childrenByParent.get(taskItemKey(task)) ?? [])];
        return group.some((item) =>
          item.tags.some((candidate) => candidate.toLocaleLowerCase() === tag)
        );
      });
    }

    return rootTasks;
  }, [
    childrenByParent,
    monthKey,
    nextMonthKey,
    rootTasks,
    selectedView,
    todayKey,
    weekRange.end,
    weekRange.start
  ]);

  const visibleActiveRoots = useMemo(
    () => filteredRootTasks.filter((task) => !task.checked),
    [filteredRootTasks]
  );
  const visibleCompletedRoots = useMemo(
    () => filteredRootTasks.filter((task) => task.checked),
    [filteredRootTasks]
  );
  const visibleActiveTasks = useMemo(
    () => orderTaskGroups(visibleActiveRoots, childrenByParent, locale),
    [childrenByParent, locale, visibleActiveRoots]
  );
  const visibleCompletedTasks = useMemo(
    () => orderTaskGroups(visibleCompletedRoots, childrenByParent, locale),
    [childrenByParent, locale, visibleCompletedRoots]
  );

  const categoryCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of activeRootTasks) {
      result.set(task.category, (result.get(task.category) ?? 0) + 1);
    }
    return result;
  }, [activeRootTasks]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const root of rootTasks) {
      const group = [root, ...(childrenByParent.get(taskItemKey(root)) ?? [])];
      const seen = new Set<string>();
      for (const task of group) {
        for (const tag of task.tags) {
          const key = tag.toLocaleLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const current = map.get(key);
          if (current) {
            if (!root.checked) current.count += 1;
          } else {
            map.set(key, { label: tag, count: root.checked ? 0 : 1 });
          }
        }
      }
    }

    return [...map.values()].sort((left, right) =>
      left.label.localeCompare(
        right.label,
        i18n.resolvedLanguage ?? i18n.language,
        { sensitivity: "base" }
      )
    );
  }, [childrenByParent, i18n.language, i18n.resolvedLanguage, rootTasks]);

  const todayCount = activeRootTasks.filter((task) => task.deadline === todayKey).length;
  const weekCount = activeRootTasks.filter(
    (task) =>
      task.deadline !== null &&
      task.deadline >= weekRange.start &&
      task.deadline <= weekRange.end
  ).length;
  const monthCount = activeRootTasks.filter((task) => task.deadline?.startsWith(monthKey)).length;
  const nextMonthCount = activeRootTasks.filter((task) => task.deadline?.startsWith(nextMonthKey)).length;

  const resolveFilePath = async (category: string): Promise<string> => {
    const existing = documents[category]?.filePath;
    if (existing) return existing;

    return join(
      folderPath,
      ...taskRelativePath(category, taskSettings.folder).split("/").filter(Boolean)
    );
  };

  const persistCategory = async (
    category: string,
    markdown: string
  ): Promise<boolean> => {
    const filePath = await resolveFilePath(category);
    const ok = await onPersistTaskFile(filePath, markdown);

    if (ok) {
      setDocuments((current) => ({
        ...current,
        [category]: {
          category,
          filePath,
          markdown,
          tasks: parseTaskMarkdown(markdown)
        }
      }));
    }

    return ok;
  };

  const addTask = async () => {
    const text = textDraft.trim();
    if (!text || saving) return;

    const selectedCategory =
      selectedView.startsWith(CATEGORY_PREFIX)
        ? selectedView.slice(CATEGORY_PREFIX.length)
        : "";

    const category = sanitizeTaskCategory(categoryDraft || selectedCategory);
    const task = {
      text,
      deadline: deadlineDraft || null,
      note: noteDraft.trim(),
      tags: tagsFromInput(tagsDraft),
      priority: priorityDraft
    };
    const existing = documents[category]?.markdown;
    const markdown = existing
      ? appendTaskToMarkdown(existing, task)
      : createTaskDocument(category, task);

    setSaving(true);
    try {
      if (await persistCategory(category, markdown)) {
        setTextDraft("");
        setDeadlineDraft("");
        setNoteDraft("");
        setTagsDraft("");
        setPriorityDraft(null);
        setCreateOpen(false);

        if (selectedView.startsWith(CATEGORY_PREFIX)) {
          setSelectedView(categoryView(category));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const addSubtask = async (parent: TaskItem, text: string): Promise<boolean> => {
    if (parent.parentLineIndex !== null || saving) return false;

    const document = documents[parent.category];
    if (!document) return false;

    const markdown = insertSubtaskInMarkdown(document.markdown, parent.lineIndex, {
      text,
      deadline: null,
      note: "",
      tags: [],
      priority: null
    });

    setSaving(true);
    try {
      return await persistCategory(parent.category, markdown);
    } finally {
      setSaving(false);
    }
  };

  const mutateTask = async (
    task: TaskItem,
    mutation: "toggle" | "delete" | "text" | "deadline" | "note" | "tags" | "priority",
    value?: string | string[] | TaskPriority
  ) => {
    const document = documents[task.category];
    if (!document) return;

    const markdown =
      mutation === "delete"
        ? removeTaskFromMarkdown(document.markdown, task.lineIndex)
        : mutation === "toggle" && task.parentLineIndex === null && !task.checked
          ? setTaskSubtreeCheckedInMarkdown(document.markdown, task.lineIndex, true)
          : updateTaskInMarkdown(document.markdown, task.lineIndex, {
            checked: mutation === "toggle" ? !task.checked : task.checked,
            text: mutation === "text" ? String(value ?? task.text) : task.text,
            deadline:
              mutation === "deadline"
                ? typeof value === "string" && value
                  ? value
                  : null
                : task.deadline,
            note: mutation === "note" ? String(value ?? "") : task.note,
            tags:
              mutation === "tags" && Array.isArray(value)
                ? value
                : task.tags,
            priority:
              mutation === "priority"
                ? (value as TaskPriority)
                : task.priority
          });

    await persistCategory(task.category, markdown);
  };

  const moveTask = async (task: TaskItem, targetCategory: string) => {
    if (task.category === targetCategory || saving) return;

    const sourceDocument = documents[task.category];
    if (!sourceDocument) return;

    const targetDocument = documents[targetCategory];
    const taskData = {
      checked: task.checked,
      text: task.text,
      deadline: task.deadline,
      note: task.note,
      tags: task.tags,
      priority: task.priority
    };

    let targetMarkdown = targetDocument
      ? appendTaskToMarkdown(targetDocument.markdown, taskData)
      : createTaskDocument(targetCategory, taskData);

    if (task.parentLineIndex === null) {
      const directChildren = sourceDocument.tasks
        .filter((candidate) => candidate.parentLineIndex === task.lineIndex)
        .sort((left, right) => left.lineIndex - right.lineIndex);
      const insertedParents = parseTaskMarkdown(targetMarkdown).filter(
        (candidate) => candidate.parentLineIndex === null
      );
      const insertedParent = insertedParents[insertedParents.length - 1];

      if (insertedParent) {
        for (const child of directChildren) {
          targetMarkdown = insertSubtaskInMarkdown(
            targetMarkdown,
            insertedParent.lineIndex,
            {
              checked: child.checked,
              text: child.text,
              deadline: child.deadline,
              note: child.note,
              tags: child.tags,
              priority: child.priority
            }
          );
        }
      }
    }

    const sourceMarkdown = removeTaskFromMarkdown(
      sourceDocument.markdown,
      task.lineIndex
    );

    setSaving(true);
    try {
      if (!(await persistCategory(targetCategory, targetMarkdown))) return;
      await persistCategory(task.category, sourceMarkdown);
    } finally {
      setSaving(false);
      setDragOverCategory(null);
    }
  };

  const taskFromDrop = (event: DragEvent): TaskItem | null => {
    const raw = event.dataTransfer.getData(TASK_DRAG_MIME);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { filePath?: unknown; lineIndex?: unknown };
      if (typeof parsed.filePath !== "string" || typeof parsed.lineIndex !== "number") {
        return null;
      }

      return (
        allTasks.find(
          (task) =>
            task.filePath === parsed.filePath &&
            task.lineIndex === parsed.lineIndex
        ) ?? null
      );
    } catch {
      return null;
    }
  };

  const renameCategory = async (category: string) => {
    const document = documents[category];
    if (!document || saving) return;

    const entered = window.prompt(t("tasks.renameCategoryPrompt"), category);
    if (entered === null) return;

    const nextCategory = sanitizeTaskCategory(entered);
    if (nextCategory === category) return;

    if (documents[nextCategory]) {
      window.alert(t("tasks.categoryExists", { category: nextCategory }));
      return;
    }

    setSaving(true);
    try {
      const renamed = await onRenameTaskFile(
        document.filePath,
        `${nextCategory}.md`
      );
      if (!renamed) return;

      const nextFilePath = await join(
        folderPath,
        ...taskRelativePath(nextCategory, taskSettings.folder).split("/").filter(Boolean)
      );
      const nextMarkdown = renameTaskDocumentHeading(
        document.markdown,
        nextCategory
      );

      await onPersistTaskFile(nextFilePath, nextMarkdown);

      setDocuments((current) => {
        const next = { ...current };
        delete next[category];
        next[nextCategory] = {
          category: nextCategory,
          filePath: nextFilePath,
          markdown: nextMarkdown,
          tasks: parseTaskMarkdown(nextMarkdown)
        };
        return next;
      });

      if (selectedView === categoryView(category)) {
        setSelectedView(categoryView(nextCategory));
      }
      if (categoryDraft === category) {
        setCategoryDraft(nextCategory);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = (category: string) => {
    if (!documents[category] || saving) return;
    setCategoryDelete(category);
  };

  const confirmDeleteCategory = async () => {
    if (!categoryDelete || saving) return;
    const document = documents[categoryDelete];
    if (!document) {
      setCategoryDelete(null);
      return;
    }

    setSaving(true);
    try {
      if (!(await onDeleteTaskFile(document.filePath))) return;

      setDocuments((current) => {
        const next = { ...current };
        delete next[categoryDelete];
        return next;
      });

      if (selectedView === categoryView(categoryDelete)) {
        setSelectedView(ALL_TASKS);
      }
      if (categoryDraft === categoryDelete) {
        setCategoryDraft("");
      }
      setCategoryDelete(null);
    } finally {
      setSaving(false);
    }
  };

  const heading = useMemo(() => {
    if (selectedView === TODAY_TASKS) return t("tasks.today");
    if (selectedView === WEEK_TASKS) return t("tasks.week");
    if (selectedView === MONTH_TASKS) return t("tasks.month");
    if (selectedView === NEXT_MONTH_TASKS) return t("tasks.nextMonth");
    if (selectedView.startsWith(CATEGORY_PREFIX)) {
      return selectedView.slice(CATEGORY_PREFIX.length);
    }
    if (selectedView.startsWith(TAG_PREFIX)) {
      return `#${selectedView.slice(TAG_PREFIX.length)}`;
    }
    return t("tasks.all");
  }, [selectedView, t]);

  const categoryDatalistId = "tasks-category-options";

  return (
    <section className="tasks-view" aria-label={t("tasks.label")}>
      <header className="tasks-view__header">
        <div className="tasks-view__header-leading">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t(
              layout === "phone"
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            title={t(
              layout === "phone"
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            onClick={
              layout === "phone" ? onOpenSidebar : onSidebarVisibilityToggle
            }
          >
            {layout === "phone" || sidebarVisible ? (
              <PanelLeft />
            ) : (
              <PanelLeftOpen />
            )}
          </Button>
          <div className="tasks-view__title">
            <SquareCheck aria-hidden="true" />
            <h2>{t("tasks.title")}</h2>
          </div>
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label={t("common.goHome")}
          title={t("common.goHome")}
        >
          <Home />
        </Button>
      </header>

      <div className="tasks-view__layout">
        <aside className="tasks-categories">
          <div className="tasks-filter-section">
            <Button
              type="button"
              variant={createOpen ? "default" : "outline"}
              className="tasks-new-trigger"
              aria-pressed={createOpen}
              aria-label={t("tasks.newTask")}
              title={t("tasks.newTask")}
              onClick={() => setCreateOpen((open) => !open)}
            >
              <Plus />
              <span className="tasks-new-trigger__label">{t("tasks.newTask")}</span>
            </Button>

            <button
              type="button"
              className={cn(
                "tasks-category",
                selectedView === ALL_TASKS && "tasks-category--active"
              )}
              onClick={() => {
                setSelectedView(ALL_TASKS);
                setCategoryDraft("");
              }}
            >
              <span>{t("tasks.all")}</span>
              <small>{activeRootTasks.length}</small>
            </button>

            {[
              [TODAY_TASKS, t("tasks.today"), todayCount],
              [WEEK_TASKS, t("tasks.week"), weekCount],
              [MONTH_TASKS, t("tasks.month"), monthCount],
              [NEXT_MONTH_TASKS, t("tasks.nextMonth"), nextMonthCount]
            ].map(([view, label, count]) => (
              <button
                key={String(view)}
                type="button"
                className={cn(
                  "tasks-category",
                  selectedView === view && "tasks-category--active"
                )}
                onClick={() => {
                  setSelectedView(String(view));
                  setCategoryDraft("");
                }}
              >
                <span className="tasks-category__label">
                  <CalendarClock aria-hidden="true" />
                  {String(label)}
                </span>
                <small>{Number(count)}</small>
              </button>
            ))}
          </div>

          <div className="tasks-filter-section">
            <div className="tasks-filter-section__heading">
              <span>{t("tasks.categories")}</span>
            </div>

            {categories.map((category) => {
              const active = selectedView === categoryView(category);
              const dropActive = dragOverCategory === category;

              return (
                <div
                  key={category}
                  className={cn(
                    "tasks-category-row",
                    dropActive && "tasks-category-row--drop"
                  )}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverCategory(category);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverCategory(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const task = taskFromDrop(event);
                    setDragOverCategory(null);
                    if (task) void moveTask(task, category);
                  }}
                >
                  <button
                    type="button"
                    className={cn(
                      "tasks-category tasks-category--managed",
                      active && "tasks-category--active"
                    )}
                    onClick={() => {
                      setSelectedView(categoryView(category));
                      setCategoryDraft(
                        category === UNCATEGORIZED_TASK_CATEGORY ? "" : category
                      );
                    }}
                  >
                    <span>{category}</span>
                    <small>{categoryCounts.get(category) ?? 0}</small>
                  </button>

                  <div className="tasks-category-row__actions">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => void renameCategory(category)}
                      aria-label={t("tasks.renameCategory", { category })}
                      title={t("tasks.renameCategory", { category })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => void deleteCategory(category)}
                      aria-label={t("tasks.deleteCategory", { category })}
                      title={t("tasks.deleteCategory", { category })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {tagCounts.length > 0 ? (
            <div className="tasks-filter-section">
              <div className="tasks-filter-section__heading">
                <Tag aria-hidden="true" />
                <span>{t("tasks.tags")}</span>
              </div>

              {tagCounts.map(({ label, count }) => (
                <button
                  key={label.toLocaleLowerCase()}
                  type="button"
                  className={cn(
                    "tasks-category",
                    selectedView === tagView(label.toLocaleLowerCase()) &&
                      "tasks-category--active"
                  )}
                  onClick={() => {
                    setSelectedView(tagView(label.toLocaleLowerCase()));
                    setCategoryDraft("");
                  }}
                >
                  <span>#{label}</span>
                  <small>{count}</small>
                </button>
              ))}
            </div>
          ) : null}

        </aside>

        <main className="tasks-main">
          {createOpen ? (
            <form
              className="tasks-create"
              onSubmit={(event) => {
                event.preventDefault();
                void addTask();
              }}
            >
            <input
              className="tasks-create__text"
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              placeholder={t("tasks.newTask")}
              aria-label={t("tasks.newTask")}
            />
            <input
              className="tasks-create__category"
              value={categoryDraft}
              list={categoryDatalistId}
              onChange={(event) => setCategoryDraft(event.target.value)}
              placeholder={t("tasks.categoryOptional")}
              aria-label={t("tasks.categoryOptional")}
            />
            <datalist id={categoryDatalistId}>
              {categories
                .filter((category) => category !== UNCATEGORIZED_TASK_CATEGORY)
                .map((category) => (
                  <option key={category} value={category} />
                ))}
            </datalist>
            <input
              className="tasks-create__deadline"
              type="date"
              value={deadlineDraft}
              onChange={(event) => setDeadlineDraft(event.target.value)}
              aria-label={t("tasks.deadline")}
            />
            <input
              className="tasks-create__tags"
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              placeholder={t("tasks.tagsPlaceholder")}
              aria-label={t("tasks.tags")}
            />
            <textarea
              className="tasks-create__note"
              value={noteDraft}
              rows={1}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder={t("tasks.notePlaceholder")}
              aria-label={t("tasks.note")}
            />
            <div className="tasks-create__priority" aria-label={t("tasks.priority")}>
              {(["high", "medium", "low"] as const).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  className={cn(
                    "tasks-priority__dot",
                    `tasks-priority__dot--${priority}`,
                    priorityDraft === priority && "tasks-priority__dot--active"
                  )}
                  aria-pressed={priorityDraft === priority}
                  aria-label={t(`tasks.priority${priority[0].toUpperCase()}${priority.slice(1)}`)}
                  title={t(`tasks.priority${priority[0].toUpperCase()}${priority.slice(1)}`)}
                  onClick={() =>
                    setPriorityDraft((current) =>
                      current === priority ? null : priority
                    )
                  }
                />
              ))}
            </div>
            <Button
              type="submit"
              disabled={!textDraft.trim() || saving}
              className="tasks-create__button"
            >
              <Plus />
              {t("tasks.add")}
            </Button>
            </form>
          ) : null}

          <div className="tasks-main__heading">
            <div>
              <h3>{heading}</h3>
              <p>{t("tasks.count", { count: visibleActiveRoots.length })}</p>
            </div>
            <CheckCircle2 aria-hidden="true" />
          </div>

          {visibleActiveTasks.length === 0 ? (
            <div className="tasks-empty tasks-empty--active">
              <SquareCheck aria-hidden="true" />
              <p>
                {visibleCompletedTasks.length > 0
                  ? t("tasks.emptyActive")
                  : t("tasks.empty")}
              </p>
            </div>
          ) : (
            <div className="tasks-list">
              {visibleActiveTasks.map((task) => {
                const isSubtask =
                  task.parentLineIndex !== null &&
                  visibleActiveTasks.some(
                    (candidate) =>
                      candidate.filePath === task.filePath &&
                      candidate.lineIndex === task.parentLineIndex
                  );

                return (
                  <TaskRow
                    key={`${task.filePath}:${task.lineIndex}`}
                    task={task}
                    isSubtask={isSubtask}
                    onToggle={() => void mutateTask(task, "toggle")}
                    onTextChange={(text) => void mutateTask(task, "text", text)}
                    onDeadlineChange={(deadline) =>
                      void mutateTask(task, "deadline", deadline ?? "")
                    }
                    onNoteChange={(note) => void mutateTask(task, "note", note)}
                    onTagsChange={(tags) => void mutateTask(task, "tags", tags)}
                    onPriorityChange={(priority) =>
                      void mutateTask(task, "priority", priority)
                    }
                    onAddSubtask={
                      task.parentLineIndex === null
                        ? (text) => addSubtask(task, text)
                        : undefined
                    }
                    onDelete={() => void mutateTask(task, "delete")}
                  />
                );
              })}
            </div>
          )}

          {visibleCompletedTasks.length > 0 ? (
            <section className="tasks-completed">
              <button
                type="button"
                className="tasks-completed__trigger"
                aria-expanded={completedOpen}
                onClick={() => setCompletedOpen((open) => !open)}
              >
                {completedOpen ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
                <span>{t("tasks.completed")}</span>
                <small>{visibleCompletedRoots.length}</small>
              </button>

              {completedOpen ? (
                <div className="tasks-list tasks-completed__list">
                  {visibleCompletedTasks.map((task) => {
                    const isSubtask =
                      task.parentLineIndex !== null &&
                      visibleCompletedTasks.some(
                        (candidate) =>
                          candidate.filePath === task.filePath &&
                          candidate.lineIndex === task.parentLineIndex
                      );

                    return (
                      <TaskRow
                        key={`${task.filePath}:${task.lineIndex}`}
                        task={task}
                        isSubtask={isSubtask}
                        onToggle={() => void mutateTask(task, "toggle")}
                        onTextChange={(text) => void mutateTask(task, "text", text)}
                        onDeadlineChange={(deadline) =>
                          void mutateTask(task, "deadline", deadline ?? "")
                        }
                        onNoteChange={(note) => void mutateTask(task, "note", note)}
                        onTagsChange={(tags) => void mutateTask(task, "tags", tags)}
                        onPriorityChange={(priority) =>
                          void mutateTask(task, "priority", priority)
                        }
                        onDelete={() => void mutateTask(task, "delete")}
                      />
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>

      <DeleteFileDialog
        open={categoryDelete !== null}
        kind="category"
        fileLabel={categoryDelete}
        isDeleting={saving}
        onConfirm={() => void confirmDeleteCategory()}
        onCancel={() => {
          if (!saving) setCategoryDelete(null);
        }}
      />
    </section>
  );
}
