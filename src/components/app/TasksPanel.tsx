import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
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
import {
  Menu,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  insertSubtaskInMarkdown,
  moveSiblingTaskInMarkdown,
  moveSubtaskInMarkdown,
  normalizeTaskTags,
  parseTaskMarkdown,
  prependTaskToMarkdown,
  removeTaskFromMarkdown,
  renameTaskDocumentHeading,
  setTaskSubtreeCheckedInMarkdown,
  sanitizeTaskCategory,
  taskCategoryFromRelativePath,
  taskRelativePath,
  updateTaskInMarkdown,
  type MarkdownTask,
  type TaskPriority,
  type TaskSortMode
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
  fileMtimeMs: Record<string, number>;
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
const TASK_SUBTASK_DRAG_MIME = "application/x-scribecat-subtask";

function categoryView(category: string): string {
  return `${CATEGORY_PREFIX}${category}`;
}

function tagView(tag: string): string {
  return `${TAG_PREFIX}${tag}`;
}

function deadlineSortValue(deadline: string | null): string {
  return deadline ?? "9999-99-99";
}

function taskItemKey(task: Pick<TaskItem, "filePath" | "lineIndex">): string {
  return `${task.filePath}:${task.lineIndex}`;
}

function compareRootTasks(
  left: TaskItem,
  right: TaskItem,
  sortMode: TaskSortMode,
  fileMtimeMs: Record<string, number>,
  locale: string,
  keepDateGroups: boolean
): number {
  if (keepDateGroups) {
    const deadlineCompare = deadlineSortValue(left.deadline).localeCompare(
      deadlineSortValue(right.deadline)
    );
    if (deadlineCompare !== 0) return deadlineCompare;
  }

  if (sortMode === "name") {
    const nameCompare = left.text.localeCompare(right.text, locale, {
      sensitivity: "base",
      numeric: true
    });
    if (nameCompare !== 0) return nameCompare;
  } else if (sortMode === "modified") {
    const modifiedCompare =
      (fileMtimeMs[right.filePath] ?? 0) - (fileMtimeMs[left.filePath] ?? 0);
    if (modifiedCompare !== 0) return modifiedCompare;
  }

  const categoryCompare = left.category.localeCompare(right.category, locale, {
    sensitivity: "base",
    numeric: true
  });
  if (categoryCompare !== 0) return categoryCompare;

  return left.lineIndex - right.lineIndex;
}

function orderTaskGroups(
  roots: TaskItem[],
  childrenByParent: Map<string, TaskItem[]>,
  compareRoots: (left: TaskItem, right: TaskItem) => number
): TaskItem[] {
  const orderedRoots = [...roots].sort(compareRoots);

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
  autoFocusText = false,
  onAutoFocusHandled,
  onToggle,
  onTextChange,
  onDeadlineChange,
  onNoteChange,
  onTagsChange,
  onPriorityChange,
  onAddSubtask,
  onSubtaskDrop,
  rootDropAllowed = false,
  rootDropBlocked = false,
  isDragSource = false,
  onRootDrop,
  onDragStartTask,
  onDragEndTask,
  onDelete
}: {
  task: TaskItem;
  isSubtask: boolean;
  autoFocusText?: boolean;
  onAutoFocusHandled?: () => void;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDeadlineChange: (deadline: string | null) => void;
  onNoteChange: (note: string) => void;
  onTagsChange: (tags: string[]) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onAddSubtask?: () => void;
  onSubtaskDrop?: (
    event: DragEvent<HTMLElement>,
    placement: "before" | "after"
  ) => void;
  rootDropAllowed?: boolean;
  rootDropBlocked?: boolean;
  isDragSource?: boolean;
  onRootDrop?: (
    event: DragEvent<HTMLElement>,
    placement: "before" | "after"
  ) => void;
  onDragStartTask?: () => void;
  onDragEndTask?: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [textDraft, setTextDraft] = useState(task.text);
  const [noteDraft, setNoteDraft] = useState(task.note);
  const [tagsDraft, setTagsDraft] = useState(
    task.tags.map((tag) => `#${tag}`).join(" ")
  );
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(
    null
  );
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTextDraft(task.text);
  }, [task.text]);

  useEffect(() => {
    setNoteDraft(task.note);
  }, [task.note]);

  useEffect(() => {
    setTagsDraft(task.tags.map((tag) => `#${tag}`).join(" "));
  }, [task.tags]);

  useEffect(() => {
    if (!autoFocusText || !textInputRef.current) return;
    textInputRef.current.focus();
    textInputRef.current.select();
    onAutoFocusHandled?.();
  }, [autoFocusText, onAutoFocusHandled]);

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

  const startDrag = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      TASK_DRAG_MIME,
      JSON.stringify({ filePath: task.filePath, lineIndex: task.lineIndex })
    );
    if (isSubtask) {
      event.dataTransfer.setData(TASK_SUBTASK_DRAG_MIME, "1");
    }
    event.dataTransfer.setData("text/plain", task.text);
    onDragStartTask?.();
  };

  const updateDropPosition = (event: DragEvent<HTMLElement>) => {
    const isSubtaskDrag = event.dataTransfer.types.includes(TASK_SUBTASK_DRAG_MIME);

    if (isSubtask) {
      if (!onSubtaskDrop || !isSubtaskDrag) return null;
    } else {
      if (!onRootDrop || isSubtaskDrag || !rootDropAllowed) return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropPosition(placement);
    return placement;
  };

  const dropProps =
    (isSubtask && onSubtaskDrop) || (!isSubtask && onRootDrop && rootDropAllowed)
      ? {
          onDragOver: (event: DragEvent<HTMLElement>) => {
            updateDropPosition(event);
          },
          onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropPosition(null);
            }
          },
          onDrop: (event: DragEvent<HTMLElement>) => {
            const placement = updateDropPosition(event);
            setDropPosition(null);
            if (!placement) return;

            if (isSubtask) {
              onSubtaskDrop?.(event, placement);
            } else {
              onRootDrop?.(event, placement);
            }
          }
        }
      : {};

  if (isSubtask && task.checked) {
    return (
      <article
        className={cn(
          "tasks-item tasks-item--subtask tasks-item--subtask-completed",
          isDragSource && "tasks-item--drag-source",
          dropPosition === "before" && "tasks-item--drop-before",
          dropPosition === "after" && "tasks-item--drop-after"
        )}
        draggable
        onDragStart={startDrag}
        onDragEnd={onDragEndTask}
        {...dropProps}
      >
        <label className="tasks-item__check tasks-item__check--compact">
          <input
            type="checkbox"
            checked
            onChange={onToggle}
            aria-label={t("tasks.toggle", { task: task.text })}
          />
          <span aria-hidden="true" />
        </label>
        <span className="tasks-item__completed-title">{task.text}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="tasks-item__delete tasks-item__delete--compact"
          onClick={onDelete}
          aria-label={t("tasks.delete")}
          title={t("tasks.delete")}
        >
          <Trash2 />
        </Button>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "tasks-item",
        isSubtask && "tasks-item--subtask",
        task.checked && "tasks-item--checked",
        !isSubtask && overdue && "tasks-item--overdue",
        !isSubtask && task.priority && `tasks-item--priority-${task.priority}`,
        isDragSource && "tasks-item--drag-source",
        rootDropBlocked && "tasks-item--drop-blocked",
        dropPosition === "before" && "tasks-item--drop-before",
        dropPosition === "after" && "tasks-item--drop-after"
      )}
      {...dropProps}
    >
      <button
        type="button"
        className="tasks-item__drag"
        draggable
        onDragStart={startDrag}
        onDragEnd={onDragEndTask}
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
          ref={textInputRef}
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

        <textarea
          className="tasks-item__note"
          value={noteDraft}
          rows={noteDraft ? 2 : 1}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={commitNote}
          placeholder={t("tasks.notePlaceholder")}
          aria-label={t("tasks.note")}
        />

        {!isSubtask ? (
          <div className="tasks-item__meta">
            <span className="tasks-item__category">{task.category}</span>

            <label
              className="tasks-item__deadline"
              data-empty={task.deadline ? "false" : "true"}
              data-placeholder={t("tasks.noDate")}
            >
              <CalendarClock aria-hidden="true" />
              <input
                type="date"
                value={task.deadline ?? ""}
                onChange={(event) => onDeadlineChange(event.target.value || null)}
                aria-label={task.deadline ? t("tasks.deadline") : t("tasks.noDate")}
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
        ) : null}
      </div>

      <div className="tasks-item__actions">
        {onAddSubtask ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onAddSubtask}
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
  fileMtimeMs,
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
  const setTaskSettings = useEditorSettingsStore((state) => state.setTaskSettings);
  const [documents, setDocuments] = useState<Record<string, TaskDocument>>({});
  const [selectedView, setSelectedView] = useState(ALL_TASKS);
  const [saving, setSaving] = useState(false);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [categoryDelete, setCategoryDelete] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [focusTaskKey, setFocusTaskKey] = useState<string | null>(null);
  const [recentlyCreatedRootKey, setRecentlyCreatedRootKey] = useState<string | null>(null);
  const [draggedRootKey, setDraggedRootKey] = useState<string | null>(null);
  const pendingMarkdownByPathRef = useRef(new Map<string, string>());

  useEffect(() => {
    setRecentlyCreatedRootKey(null);
  }, [selectedView]);

  const taskFiles = useMemo(
    () =>
      filePaths.flatMap((filePath) => {
        const relativePath = getRelativeDisplayPath(folderPath, filePath);
        const category = taskCategoryFromRelativePath(
          relativePath,
          taskSettings.folder
        );
        return category ? [{ category, filePath }] : [];
      }),
    [filePaths, folderPath, taskSettings.folder]
  );

  const taskFileSignature = useMemo(
    () =>
      taskFiles
        .map(
          ({ filePath }) =>
            `${filePath}\u0000${fileMtimeMs[filePath] ?? 0}`
        )
        .join("\u0001"),
    [fileMtimeMs, taskFiles]
  );

  useEffect(() => {
    let active = true;
    const expectedPaths = new Set(taskFiles.map(({ filePath }) => filePath));

    // Keep already loaded task documents visible while refreshing them and
    // only discard categories whose Markdown file no longer exists.
    setDocuments((current) => {
      const entries = Object.entries(current).filter(([, document]) =>
        expectedPaths.has(document.filePath)
      );
      if (entries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(entries);
    });

    // Load each category independently instead of waiting for the slowest
    // Markdown file. This makes the Tasks view populate progressively.
    for (const { category, filePath } of taskFiles) {
      void readMarkdownFile(filePath)
        .then((markdown) => {
          if (!active) return;

          const pendingMarkdown = pendingMarkdownByPathRef.current.get(filePath);
          if (pendingMarkdown && markdown !== pendingMarkdown) {
            return;
          }
          if (pendingMarkdown === markdown) {
            pendingMarkdownByPathRef.current.delete(filePath);
          }

          const document = {
            category,
            filePath,
            markdown,
            tasks: parseTaskMarkdown(markdown)
          } satisfies TaskDocument;

          setDocuments((current) => {
            const existing = current[category];
            if (
              existing?.filePath === document.filePath &&
              existing.markdown === document.markdown
            ) {
              return current;
            }
            return { ...current, [category]: document };
          });
        })
        .catch(() => {
          if (!active) return;
          setDocuments((current) => {
            if (current[category]?.filePath !== filePath) return current;
            const next = { ...current };
            delete next[category];
            return next;
          });
        });
    }

    return () => {
      active = false;
    };
  }, [taskFileSignature]);

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
  const timeBasedView =
    selectedView === TODAY_TASKS ||
    selectedView === WEEK_TASKS ||
    selectedView === MONTH_TASKS ||
    selectedView === NEXT_MONTH_TASKS;
  const compareVisibleRoots = useMemo(
    () => (left: TaskItem, right: TaskItem) => {
      if (taskSettings.sortMode === "manual" && recentlyCreatedRootKey) {
        const leftIsNew = taskItemKey(left) === recentlyCreatedRootKey;
        const rightIsNew = taskItemKey(right) === recentlyCreatedRootKey;
        if (leftIsNew !== rightIsNew) return leftIsNew ? -1 : 1;
      }

      return compareRootTasks(
        left,
        right,
        taskSettings.sortMode,
        fileMtimeMs,
        locale,
        timeBasedView
      );
    },
    [
      fileMtimeMs,
      locale,
      recentlyCreatedRootKey,
      taskSettings.sortMode,
      timeBasedView
    ]
  );
  const visibleActiveTasks = useMemo(
    () => orderTaskGroups(visibleActiveRoots, childrenByParent, compareVisibleRoots),
    [childrenByParent, compareVisibleRoots, visibleActiveRoots]
  );
  const visibleCompletedTasks = useMemo(
    () => orderTaskGroups(visibleCompletedRoots, childrenByParent, compareVisibleRoots),
    [childrenByParent, compareVisibleRoots, visibleCompletedRoots]
  );
  const draggedRootTask = useMemo(
    () =>
      draggedRootKey
        ? allTasks.find(
            (task) =>
              task.parentLineIndex === null &&
              taskItemKey(task) === draggedRootKey
          ) ?? null
        : null,
    [allTasks, draggedRootKey]
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
    const previous = documents[category];
    const nextDocument = {
      category,
      filePath,
      markdown,
      tasks: parseTaskMarkdown(markdown)
    } satisfies TaskDocument;

    // The Markdown file remains the source of truth, but mirror the pending
    // write immediately so checking/editing a task does not wait on disk I/O.
    // Keep the expected Markdown around until the watcher reads it back, so
    // a stale intermediate read cannot briefly flip a checkbox back.
    pendingMarkdownByPathRef.current.set(filePath, markdown);
    setDocuments((current) => ({
      ...current,
      [category]: nextDocument
    }));

    const ok = await onPersistTaskFile(filePath, markdown);
    if (!ok) {
      if (pendingMarkdownByPathRef.current.get(filePath) === markdown) {
        pendingMarkdownByPathRef.current.delete(filePath);
      }
      setDocuments((current) => {
        if (current[category]?.markdown !== markdown) {
          return current;
        }

        if (previous) {
          return { ...current, [category]: previous };
        }

        const next = { ...current };
        delete next[category];
        return next;
      });
    }

    return ok;
  };

  const addTask = async () => {
    if (saving) return;

    let category = UNCATEGORIZED_TASK_CATEGORY;
    let deadline: string | null = null;
    let tags: string[] = [];

    if (selectedView.startsWith(CATEGORY_PREFIX)) {
      category = sanitizeTaskCategory(
        selectedView.slice(CATEGORY_PREFIX.length)
      );
    } else if (selectedView === TODAY_TASKS || selectedView === WEEK_TASKS) {
      deadline = todayKey;
    } else if (selectedView === MONTH_TASKS) {
      deadline = todayKey;
    } else if (selectedView === NEXT_MONTH_TASKS) {
      deadline = dateKey(nextMonthDate);
    } else if (selectedView.startsWith(TAG_PREFIX)) {
      tags = [selectedView.slice(TAG_PREFIX.length)];
    }

    const task = {
      text: t("tasks.newTask"),
      deadline,
      note: "",
      tags,
      priority: null as TaskPriority
    };
    const existing = documents[category]?.markdown;
    const markdown = existing
      ? prependTaskToMarkdown(existing, task)
      : createTaskDocument(category, task);
    const inserted = parseTaskMarkdown(markdown).find(
      (candidate) => candidate.parentLineIndex === null
    );
    const filePath = await resolveFilePath(category);

    if (inserted) {
      const key = `${filePath}:${inserted.lineIndex}`;
      setFocusTaskKey(key);
      setRecentlyCreatedRootKey(key);
    }

    setSaving(true);
    try {
      if (!(await persistCategory(category, markdown))) {
        setFocusTaskKey(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const addSubtask = async (parent: TaskItem): Promise<void> => {
    if (parent.parentLineIndex !== null || saving) return;

    const document = documents[parent.category];
    if (!document) return;

    const markdown = insertSubtaskInMarkdown(
      document.markdown,
      parent.lineIndex,
      {
        text: t("tasks.newSubtask"),
        deadline: null,
        note: "",
        tags: [],
        priority: null
      },
      "first"
    );
    const inserted = parseTaskMarkdown(markdown).find(
      (candidate) =>
        candidate.parentLineIndex === parent.lineIndex &&
        candidate.lineIndex === parent.endLineIndex + 1
    );

    if (inserted) {
      setFocusTaskKey(`${parent.filePath}:${inserted.lineIndex}`);
    }

    setSaving(true);
    try {
      if (!(await persistCategory(parent.category, markdown))) {
        setFocusTaskKey(null);
      }
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

  const reorderRootTask = async (
    source: TaskItem,
    target: TaskItem,
    placement: "before" | "after"
  ) => {
    if (
      saving ||
      taskSettings.sortMode !== "manual" ||
      source.parentLineIndex !== null ||
      target.parentLineIndex !== null ||
      source.filePath !== target.filePath ||
      source.lineIndex === target.lineIndex ||
      (timeBasedView && source.deadline !== target.deadline)
    ) {
      return;
    }

    const document = documents[source.category];
    if (!document) return;

    const markdown = moveSiblingTaskInMarkdown(
      document.markdown,
      source.lineIndex,
      target.lineIndex,
      placement
    );
    if (markdown === document.markdown) return;

    setSaving(true);
    try {
      await persistCategory(source.category, markdown);
    } finally {
      setSaving(false);
      setDraggedRootKey(null);
    }
  };

  const reorderSubtask = async (
    source: TaskItem,
    target: TaskItem,
    placement: "before" | "after"
  ) => {
    if (
      saving ||
      source.filePath !== target.filePath ||
      source.parentLineIndex === null ||
      target.parentLineIndex === null ||
      source.parentLineIndex !== target.parentLineIndex ||
      source.lineIndex === target.lineIndex
    ) {
      return;
    }

    const document = documents[source.category];
    if (!document) return;

    const markdown = moveSubtaskInMarkdown(
      document.markdown,
      source.lineIndex,
      target.lineIndex,
      placement
    );
    if (markdown === document.markdown) return;

    setSaving(true);
    try {
      await persistCategory(source.category, markdown);
    } finally {
      setSaving(false);
    }
  };

  const moveTask = async (task: TaskItem, targetCategory: string) => {
    if (
      task.parentLineIndex !== null ||
      task.category === targetCategory ||
      saving
    ) {
      return;
    }

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
      setDraggedRootKey(null);
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
              variant="outline"
              className="tasks-new-trigger"
              aria-label={t("tasks.newTask")}
              title={t("tasks.newTask")}
              disabled={saving}
              onClick={() => void addTask()}
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
              onClick={() => setSelectedView(ALL_TASKS)}
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
                onClick={() => setSelectedView(String(view))}
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
                    if (event.dataTransfer.types.includes(TASK_SUBTASK_DRAG_MIME)) return;
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
                    if (task?.parentLineIndex === null) {
                      void moveTask(task, category);
                    }
                  }}
                >
                  <button
                    type="button"
                    className={cn(
                      "tasks-category tasks-category--managed",
                      active && "tasks-category--active"
                    )}
                    onClick={() => setSelectedView(categoryView(category))}
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
                  onClick={() => setSelectedView(tagView(label.toLocaleLowerCase()))}
                >
                  <span>#{label}</span>
                  <small>{count}</small>
                </button>
              ))}
            </div>
          ) : null}

        </aside>

        <main className="tasks-main">
          <div className="tasks-main__heading">
            <div>
              <h3>{heading}</h3>
              <p>{t("tasks.count", { count: visibleActiveRoots.length })}</p>
            </div>
            <div className="tasks-main__heading-actions">
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("sidebar.sortMode")}
                      title={t("sidebar.sortMode")}
                    >
                      <ArrowUpDown />
                    </Button>
                  }
                />
                <MenuPortal>
                  <MenuPositioner align="end">
                    <MenuPopup>
                      <MenuRadioGroup
                        value={taskSettings.sortMode}
                        onValueChange={(value) =>
                          setTaskSettings({ sortMode: value as TaskSortMode })
                        }
                      >
                        <MenuRadioItem value="name">
                          <ArrowDownAZ className="size-4" aria-hidden="true" />
                          {t("sidebar.sortModeName")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                        <MenuRadioItem value="modified">
                          <Clock className="size-4" aria-hidden="true" />
                          {t("sidebar.sortModeModified")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                        <MenuRadioItem value="manual">
                          <GripVertical className="size-4" aria-hidden="true" />
                          {t("sidebar.sortModeManual")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                      </MenuRadioGroup>
                    </MenuPopup>
                  </MenuPositioner>
                </MenuPortal>
              </Menu>
              <CheckCircle2 aria-hidden="true" />
            </div>
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
                const key = taskItemKey(task);
                const rootDropAllowed =
                  !isSubtask &&
                  draggedRootTask !== null &&
                  key !== taskItemKey(draggedRootTask) &&
                  taskSettings.sortMode === "manual" &&
                  draggedRootTask.filePath === task.filePath &&
                  (!timeBasedView || draggedRootTask.deadline === task.deadline);
                const rootDropBlocked =
                  !isSubtask &&
                  draggedRootTask !== null &&
                  key !== taskItemKey(draggedRootTask) &&
                  !rootDropAllowed;

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
                    autoFocusText={focusTaskKey === taskItemKey(task)}
                    onAutoFocusHandled={() => setFocusTaskKey(null)}
                    onAddSubtask={
                      task.parentLineIndex === null
                        ? () => void addSubtask(task)
                        : undefined
                    }
                    onSubtaskDrop={
                      isSubtask
                        ? (event, placement) => {
                            const source = taskFromDrop(event);
                            if (source) {
                              void reorderSubtask(source, task, placement);
                            }
                          }
                        : undefined
                    }
                    rootDropAllowed={rootDropAllowed}
                    rootDropBlocked={rootDropBlocked}
                    isDragSource={
                      !isSubtask &&
                      draggedRootTask !== null &&
                      key === taskItemKey(draggedRootTask)
                    }
                    onRootDrop={
                      rootDropAllowed
                        ? (event, placement) => {
                            const source = taskFromDrop(event);
                            if (source) {
                              void reorderRootTask(source, task, placement);
                            }
                          }
                        : undefined
                    }
                    onDragStartTask={
                      !isSubtask ? () => setDraggedRootKey(key) : undefined
                    }
                    onDragEndTask={
                      !isSubtask ? () => setDraggedRootKey(null) : undefined
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
                    const key = taskItemKey(task);
                    const rootDropAllowed =
                      !isSubtask &&
                      draggedRootTask !== null &&
                      key !== taskItemKey(draggedRootTask) &&
                      taskSettings.sortMode === "manual" &&
                      draggedRootTask.filePath === task.filePath &&
                      (!timeBasedView || draggedRootTask.deadline === task.deadline);
                    const rootDropBlocked =
                      !isSubtask &&
                      draggedRootTask !== null &&
                      key !== taskItemKey(draggedRootTask) &&
                      !rootDropAllowed;

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
                        onSubtaskDrop={
                          isSubtask
                            ? (event, placement) => {
                                const source = taskFromDrop(event);
                                if (source) {
                                  void reorderSubtask(source, task, placement);
                                }
                              }
                            : undefined
                        }
                        rootDropAllowed={rootDropAllowed}
                        rootDropBlocked={rootDropBlocked}
                        isDragSource={
                          !isSubtask &&
                          draggedRootTask !== null &&
                          key === taskItemKey(draggedRootTask)
                        }
                        onRootDrop={
                          rootDropAllowed
                            ? (event, placement) => {
                                const source = taskFromDrop(event);
                                if (source) {
                                  void reorderRootTask(source, task, placement);
                                }
                              }
                            : undefined
                        }
                        onDragStartTask={
                          !isSubtask ? () => setDraggedRootKey(key) : undefined
                        }
                        onDragEndTask={
                          !isSubtask ? () => setDraggedRootKey(null) : undefined
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
