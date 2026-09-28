import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  FolderInput,
  GripVertical,
  Home,
  ListPlus,
  PanelLeft,
  PanelLeftOpen,
  Pencil,
  Plus,
  SquareCheck,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  appendTaskToSection,
  createTaskDocument,
  insertSubtaskInMarkdown,
  mergeTaskDocuments,
  moveTaskToSection,
  moveTaskSection,
  renameTaskSection,
  removeTaskSection,
  transferTaskSection,
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
  taskSections,
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
const SECTION_PREFIX = "section:";
const TAG_PREFIX = "tag:";
const TASK_DRAG_MIME = "application/x-scribecat-task";
const CATEGORY_DRAG_MIME = "application/x-scribecat-category";
const SECTION_DRAG_MIME = "application/x-scribecat-section";
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
  locale: string,
  keepDateGroups: boolean
): number {
  if (keepDateGroups || sortMode === "date") {
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
  }

  // Date ties and Manual both fall back to the actual Markdown order inside
  // each category. Across category files categories stay stable; this avoids
  // inventing a global manual order that cannot be represented in Markdown.
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
  categories,
  sectionsByCategory,
  onCategoryChange,
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
  categories: string[];
  sectionsByCategory: Record<string, string[]>;
  onCategoryChange: (category: string) => void;
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
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
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

  useLayoutEffect(() => {
    const input = noteInputRef.current;
    if (!input) return;
    let previousWidth = -1;
    const resizeToContent = () => {
      const width = input.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    resizeToContent();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(input.parentElement ?? input);
    return () => observer.disconnect();
  }, [noteDraft]);

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
  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      (event.currentTarget.querySelector(".tasks-item__text, .tasks-item__check input") as HTMLElement | null)?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = Array.from(event.currentTarget.closest(".tasks-list")?.querySelectorAll<HTMLElement>(".tasks-item") ?? []);
      const next = rows[rows.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) { event.preventDefault(); next.focus(); }
    } else if (event.key === "Escape") {
      event.preventDefault();
      (event.currentTarget.closest(".tasks-view")?.querySelector(".tasks-new-trigger") as HTMLElement | null)?.focus();
    }
  };
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
      <article tabIndex={0} onKeyDown={handleRowKeyDown}
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
    <article tabIndex={0} onKeyDown={handleRowKeyDown}
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
          ref={noteInputRef}
          className="tasks-item__note"
          value={noteDraft}
          rows={1}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={commitNote}
          placeholder={t("tasks.notePlaceholder")}
          aria-label={t("tasks.note")}
        />

        {!isSubtask ? (
          <div className="tasks-item__meta">
            <Menu>
              <MenuTrigger render={<button type="button" className="tasks-item__category" aria-label={t("tasks.categories")}><span>{task.category}{task.section ? ` / ${task.section}` : ""}</span><ChevronDown aria-hidden="true" /></button>} />
              <MenuPortal><MenuPositioner align="start"><MenuPopup>
                <MenuRadioGroup value={JSON.stringify([task.category, task.section ?? null])} onValueChange={onCategoryChange}>
                  {[...new Set([UNCATEGORIZED_TASK_CATEGORY, ...categories])].flatMap((category) => [
                    <MenuRadioItem key={category} value={JSON.stringify([category, null])}>{category}<MenuRadioItemIndicator /></MenuRadioItem>,
                    ...(sectionsByCategory[category] ?? []).map((section) => <MenuRadioItem key={`${category}/${section}`} value={JSON.stringify([category, section])} className="tasks-category-picker__section">{category} / {section}<MenuRadioItemIndicator /></MenuRadioItem>)
                  ])}
                </MenuRadioGroup>
              </MenuPopup></MenuPositioner></MenuPortal>
            </Menu>

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
  const [categoryDropPlacement, setCategoryDropPlacement] = useState<"before" | "after">("before");
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [reorderingCategories, setReorderingCategories] = useState(false);
  const [pointerDraggedCategory, setPointerDraggedCategory] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [dragOverSectionPosition, setDragOverSectionPosition] = useState<"before" | "after" | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<{ original: string | null; value: string } | null>(null);
  const [sectionDraft, setSectionDraft] = useState<{ original: string | null; value: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const skipNameBlurRef = useRef(false);
  const [categoryDelete, setCategoryDelete] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [focusTaskKey, setFocusTaskKey] = useState<string | null>(null);
  const [recentlyCreatedRootKey, setRecentlyCreatedRootKey] = useState<string | null>(null);
  const [draggedRootKey, setDraggedRootKey] = useState<string | null>(null);
  const { contextMenu: categoryContextMenu, setContextMenu: setCategoryContextMenu } =
    useContextMenuState<{ category: string; x: number; y: number }>();
  const { contextMenu: sectionContextMenu, setContextMenu: setSectionContextMenu } =
    useContextMenuState<{ category: string; section: string; x: number; y: number }>();
  const { getLongPressProps: getCategoryLongPressProps } =
    useLongPressContextMenu<string>((category, x, y) =>
      setCategoryContextMenu({ category, x, y })
    );
  const { getLongPressProps: getSectionLongPressProps } =
    useLongPressContextMenu<{ category: string; section: string }>((target, x, y) =>
      setSectionContextMenu({ ...target, x, y })
    );
  const pendingMarkdownByPathRef = useRef(new Map<string, string>());
  const lastPointerOrderTargetRef = useRef<string | null>(null);

  useEffect(() => {
    setRecentlyCreatedRootKey(null);
    setSectionDraft(null);
    setNameError(null);
  }, [selectedView]);

  const taskFiles = useMemo(
    () =>
      filePaths.flatMap((filePath) => {
        const relativePath = getRelativeDisplayPath(folderPath, filePath);
        const category = taskCategoryFromRelativePath(
          relativePath,
          taskSettings.folder,
          taskSettings.uncategorizedFileName
        );
        return category ? [{ category, filePath }] : [];
      }),
    [filePaths, folderPath, taskSettings.folder, taskSettings.uncategorizedFileName]
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
        .sort((left, right) => {
          const leftIndex = taskSettings.categoryOrder.indexOf(left);
          const rightIndex = taskSettings.categoryOrder.indexOf(right);
          if (leftIndex !== rightIndex && (leftIndex >= 0 || rightIndex >= 0)) return leftIndex < 0 ? 1 : rightIndex < 0 ? -1 : leftIndex - rightIndex;
          return left.localeCompare(right, i18n.resolvedLanguage ?? i18n.language, {
            sensitivity: "base"
          });
        }),
    [documents, i18n.language, i18n.resolvedLanguage, taskSettings.categoryOrder]
  );
  const sectionsByCategory = useMemo(() => Object.fromEntries(
    Object.values(documents).map((document) => [document.category, taskSections(document.markdown)])
  ) as Record<string, string[]>, [documents]);

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
    if (selectedView.startsWith(SECTION_PREFIX)) {
      try {
        const [category, section] = JSON.parse(selectedView.slice(SECTION_PREFIX.length)) as [string, string];
        return rootTasks.filter((task) => task.category === category && task.section === section);
      } catch { return rootTasks; }
    }
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

    if (selectedView.startsWith(SECTION_PREFIX)) {
      try {
        const [category, section] = JSON.parse(selectedView.slice(SECTION_PREFIX.length)) as [string, string];
        return rootTasks.filter((task) => task.category === category && task.section === section);
      } catch { return rootTasks; }
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
      if (recentlyCreatedRootKey) {
        const leftIsNew = taskItemKey(left) === recentlyCreatedRootKey;
        const rightIsNew = taskItemKey(right) === recentlyCreatedRootKey;
        if (leftIsNew !== rightIsNew) return leftIsNew ? -1 : 1;
      }

      return compareRootTasks(
        left,
        right,
        taskSettings.sortMode,
        locale,
        timeBasedView
      );
    },
    [
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
      ...taskRelativePath(category, taskSettings.folder, taskSettings.uncategorizedFileName).split("/").filter(Boolean)
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
    } else if (selectedView.startsWith(SECTION_PREFIX)) {
      category = (JSON.parse(selectedView.slice(SECTION_PREFIX.length)) as [string, string])[0];
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
      priority: null as TaskPriority,
      modifiedAt: new Date().toISOString()
    };
    const existing = documents[category]?.markdown;
    let markdown = existing
      ? prependTaskToMarkdown(existing, task)
      : createTaskDocument(category, task);
    if (selectedView.startsWith(SECTION_PREFIX) && existing) {
      const section = JSON.parse(selectedView.slice(SECTION_PREFIX.length))[1] as string;
      const insertedTask = parseTaskMarkdown(markdown).find((candidate) => candidate.parentLineIndex === null);
      if (insertedTask) markdown = moveTaskToSection(markdown, insertedTask.lineIndex, section);
    }
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

  const beginCategoryName = (original: string | null = null) => {
    if (saving) return;
    skipNameBlurRef.current = false;
    setNameError(null);
    setSectionDraft(null);
    setCategoryDraft({ original, value: original ?? "" });
  };
  const beginSectionName = (original: string | null = null) => {
    if (saving) return;
    skipNameBlurRef.current = false;
    setNameError(null);
    setCategoryDraft(null);
    setSectionDraft({ original, value: original ?? "" });
  };
  const cancelCategoryName = () => {
    skipNameBlurRef.current = true;
    setCategoryDraft(null);
    setNameError(null);
  };
  const commitCategoryName = async () => {
    if (!categoryDraft || saving || skipNameBlurRef.current) return;
    const { original } = categoryDraft;
    const name = sanitizeTaskCategory(categoryDraft.value);
    if (!categoryDraft.value.trim()) { setCategoryDraft(null); return; }
    if (name === original) { setCategoryDraft(null); return; }
    if (documents[name] || name === UNCATEGORIZED_TASK_CATEGORY || name === taskSettings.uncategorizedFileName) {
      setNameError(t("tasks.categoryExists", { category: name }));
      return;
    }
    skipNameBlurRef.current = true;
    try {
      if (original) {
        if (await renameCategory(original, name)) setCategoryDraft(null);
      } else {
        setSaving(true);
        try {
          if (await persistCategory(name, createTaskDocument(name))) {
            setCategoryDraft(null);
            setSelectedView(categoryView(name));
          }
        } finally { setSaving(false); }
      }
    } finally { skipNameBlurRef.current = false; }
  };
  const commitSectionName = async () => {
    if (!sectionDraft || !selectedCategory || saving || skipNameBlurRef.current) return;
    const section = sectionDraft.value.trim().replace(/[\r\n#]+/g, " ").trim();
    const document = documents[selectedCategory];
    if (!section || !document) { setSectionDraft(null); return; }
    if (section === sectionDraft.original) { setSectionDraft(null); return; }
    if (taskSections(document.markdown).includes(section)) { setNameError(t("tasks.sectionExists", { section })); return; }
    const markdown = sectionDraft.original
      ? renameTaskSection(document.markdown, sectionDraft.original, section)
      : `${document.markdown.trimEnd()}\n\n## ${section}\n`;
    skipNameBlurRef.current = true;
    setSaving(true);
    try { if (await persistCategory(selectedCategory, markdown)) setSectionDraft(null); }
    finally { setSaving(false); skipNameBlurRef.current = false; }
  };
  const deleteSection = async (category: string, section: string) => {
    const document = documents[category];
    if (!document || saving) return;
    setSaving(true);
    try { await persistCategory(category, removeTaskSection(document.markdown, section)); }
    finally { setSaving(false); }
  };
  const moveCategoryOrder = (source: string, target: string, placement: "before" | "after") => {
    const order = categories.filter((category) => category !== source);
    const index = order.indexOf(target);
    if (source === target || index < 0 || !categories.includes(source)) return;
    order.splice(index + (placement === "after" ? 1 : 0), 0, source);
    setTaskSettings({ categoryOrder: order });
  };

  useEffect(() => {
    if (!pointerDraggedCategory) return;

    const handlePointerMove = (event: PointerEvent) => {
      const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-task-category]");
      const target = targetRow?.dataset.taskCategory;
      if (!target || target === pointerDraggedCategory || target === lastPointerOrderTargetRef.current) return;
      event.preventDefault();
      const rect = targetRow.getBoundingClientRect();
      const horizontal = window.getComputedStyle(targetRow.parentElement!).display === "flex";
      const placement = (horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2) ? "before" : "after";
      const orderTarget = `${target}:${placement}`;
      if (orderTarget === lastPointerOrderTargetRef.current) return;
      lastPointerOrderTargetRef.current = orderTarget;
      setDragOverCategory(target);
      setCategoryDropPlacement(placement);
      moveCategoryOrder(pointerDraggedCategory, target, placement);
    };
    const finishPointerDrag = () => {
      setPointerDraggedCategory(null);
      lastPointerOrderTargetRef.current = null;
      setDragOverCategory(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishPointerDrag, { once: true });
    window.addEventListener("pointercancel", finishPointerDrag, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", finishPointerDrag);
    };
  }, [pointerDraggedCategory, categories, taskSettings.categoryOrder]);

  useEffect(() => {
    if (!reorderingCategories) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReorderingCategories(false);
        setPointerDraggedCategory(null);
        setDragOverCategory(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reorderingCategories]);
  const moveSection = async (sourceCategory: string, section: string, targetCategory: string, targetSection?: string, placement: "before" | "after" = "before") => {
    const source = documents[sourceCategory];
    const target = documents[targetCategory];
    if (!source || !target || saving) return;
    if (sourceCategory === targetCategory) {
      if (!targetSection) return;
      const markdown = moveTaskSection(source.markdown, section, targetSection, placement);
      if (markdown === source.markdown) return;
      setSaving(true);
      try { await persistCategory(sourceCategory, markdown); } finally { setSaving(false); }
      return;
    }
    const moved = transferTaskSection(source.markdown, target.markdown, section);
    if (!moved) { window.alert(t("tasks.categoryExists", { category: section })); return; }
    setSaving(true);
    try {
      if (await persistCategory(targetCategory, moved.target)) {
        if (!(await persistCategory(sourceCategory, moved.source))) await persistCategory(targetCategory, target.markdown);
        else setSelectedView(categoryView(targetCategory));
      }
    } finally { setSaving(false); setDragOverSection(null); setDragOverCategory(null); }
  };
  const sectionFromDrop = (event: DragEvent): [string, string] | null => {
    try {
      const value = JSON.parse(event.dataTransfer.getData(SECTION_DRAG_MIME)) as unknown;
      return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "string") ? value as [string, string] : null;
    } catch { return null; }
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
        priority: null,
        modifiedAt: new Date().toISOString()
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

    const modifiedAt = new Date().toISOString();
    let markdown: string;

    if (mutation === "delete") {
      markdown = removeTaskFromMarkdown(document.markdown, task.lineIndex);

      // Removing a child is still a modification of the visible parent group.
      // Touch the parent in Markdown so "recently modified" also reflects
      // deleted subtasks instead of only edits to surviving lines.
      if (task.parentLineIndex !== null) {
        const parent = document.tasks.find(
          (candidate) => candidate.lineIndex === task.parentLineIndex
        );
        if (parent) {
          markdown = updateTaskInMarkdown(markdown, parent.lineIndex, {
            checked: parent.checked,
            text: parent.text,
            deadline: parent.deadline,
            note: parent.note,
            tags: parent.tags,
            priority: parent.priority,
            modifiedAt
          });
        }
      }
    } else if (
      mutation === "toggle" &&
      task.parentLineIndex === null &&
      !task.checked
    ) {
      markdown = setTaskSubtreeCheckedInMarkdown(
        document.markdown,
        task.lineIndex,
        true,
        modifiedAt
      );
    } else {
      markdown = updateTaskInMarkdown(document.markdown, task.lineIndex, {
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
            : task.priority,
        modifiedAt
      });
    }

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
      (source.filePath === target.filePath && source.lineIndex === target.lineIndex) ||
      (timeBasedView && source.deadline !== target.deadline)
    ) {
      return;
    }

    if (source.filePath !== target.filePath) {
      await moveTask(source, target.category, target.section ?? null);
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

  const moveTask = async (task: TaskItem, targetCategory: string, targetSection: string | null = null) => {
    if (
      task.parentLineIndex !== null ||
      (task.category === targetCategory && task.section === targetSection) ||
      saving
    ) {
      return;
    }

    const sourceDocument = documents[task.category];
    if (!sourceDocument) return;

    if (task.category === targetCategory) {
      setSaving(true);
      try { await persistCategory(task.category, moveTaskToSection(sourceDocument.markdown, task.lineIndex, targetSection)); }
      finally { setSaving(false); }
      return;
    }

    const targetDocument = documents[targetCategory];
    const taskData = {
      checked: task.checked,
      text: task.text,
      deadline: task.deadline,
      note: task.note,
      tags: task.tags,
      priority: task.priority,
      modifiedAt: task.modifiedAt
    };

    let targetMarkdown = targetDocument
      ? targetSection ? appendTaskToSection(targetDocument.markdown, taskData, targetSection) : appendTaskToMarkdown(targetDocument.markdown, taskData)
      : createTaskDocument(targetCategory, taskData);

    if (task.parentLineIndex === null) {
      const directChildren = sourceDocument.tasks
        .filter((candidate) => candidate.parentLineIndex === task.lineIndex)
        .sort((left, right) => left.lineIndex - right.lineIndex);
      const insertedParents = parseTaskMarkdown(targetMarkdown).filter(
        (candidate) => candidate.parentLineIndex === null && candidate.text === task.text
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
              priority: child.priority,
              modifiedAt: child.modifiedAt
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

  const renameCategory = async (category: string, nextCategory: string): Promise<boolean> => {
    if (category === UNCATEGORIZED_TASK_CATEGORY) return false;
    const document = documents[category];
    if (!document || saving) return false;

    setSaving(true);
    try {
      const renamed = await onRenameTaskFile(
        document.filePath,
        `${nextCategory}.md`
      );
      if (!renamed) return false;

      const nextFilePath = await join(
        folderPath,
        ...taskRelativePath(nextCategory, taskSettings.folder, taskSettings.uncategorizedFileName).split("/").filter(Boolean)
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
      setTaskSettings({ categoryOrder: taskSettings.categoryOrder.map((name) => name === category ? nextCategory : name) });
      return true;
    } finally {
      setSaving(false);
    }
  };

  const duplicateCategory = async (category: string) => {
    const source = documents[category];
    if (!source || saving) return;

    const suffix = t("tasks.categoryCopySuffix");
    let candidate = sanitizeTaskCategory(`${category} (${suffix})`);
    let number = 2;

    while (documents[candidate]) {
      candidate = sanitizeTaskCategory(`${category} (${suffix} ${number})`);
      number += 1;
    }

    const markdown = renameTaskDocumentHeading(source.markdown, candidate);

    setSaving(true);
    try {
      await persistCategory(candidate, markdown);
    } finally {
      setSaving(false);
    }
  };

  const moveCategoryTasks = async (
    sourceCategory: string,
    targetCategory: string
  ): Promise<boolean> => {
    const source = documents[sourceCategory];
    const normalizedTarget = sanitizeTaskCategory(targetCategory);
    if (!source || normalizedTarget === sourceCategory) return false;

    const previousTarget = documents[normalizedTarget];
    const targetPath = await resolveFilePath(normalizedTarget);
    const mergedMarkdown = mergeTaskDocuments(
      normalizedTarget,
      previousTarget?.markdown,
      source.markdown
    );

    if (!(await persistCategory(normalizedTarget, mergedMarkdown))) {
      return false;
    }

    if (!(await onDeleteTaskFile(source.filePath))) {
      if (previousTarget) {
        await persistCategory(normalizedTarget, previousTarget.markdown);
      } else {
        await onDeleteTaskFile(targetPath);
        setDocuments((current) => {
          const next = { ...current };
          delete next[normalizedTarget];
          return next;
        });
      }
      return false;
    }

    pendingMarkdownByPathRef.current.delete(source.filePath);
    setDocuments((current) => {
      const next = { ...current };
      delete next[sourceCategory];
      return next;
    });

    if (selectedView === categoryView(sourceCategory)) {
      setSelectedView(categoryView(normalizedTarget));
    }

    return true;
  };

  const moveCategoryTasksPrompt = async (category: string) => {
    if (!documents[category] || saving) return;

    const entered = window.prompt(
      t("tasks.moveCategoryTasksPrompt", { category }),
      category === UNCATEGORIZED_TASK_CATEGORY ? "" : UNCATEGORIZED_TASK_CATEGORY
    );
    if (entered === null || !entered.trim()) return;

    const target = sanitizeTaskCategory(entered);
    if (target === category) return;

    setSaving(true);
    try {
      await moveCategoryTasks(category, target);
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = (category: string) => {
    if (
      category === UNCATEGORIZED_TASK_CATEGORY ||
      !documents[category] ||
      saving
    ) {
      return;
    }
    setCategoryDelete(category);
  };

  const confirmDeleteCategory = async () => {
    if (!categoryDelete || saving) return;

    setSaving(true);
    try {
      if (
        await moveCategoryTasks(
          categoryDelete,
          UNCATEGORIZED_TASK_CATEGORY
        )
      ) {
        setCategoryDelete(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const heading = useMemo(() => {
    if (selectedView.startsWith(SECTION_PREFIX)) {
      try { return (JSON.parse(selectedView.slice(SECTION_PREFIX.length)) as [string, string])[1]; }
      catch { return t("tasks.all"); }
    }
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

  const selectedCategory = selectedView.startsWith(CATEGORY_PREFIX)
    ? selectedView.slice(CATEGORY_PREFIX.length)
    : null;

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
        <aside className="tasks-categories" onKeyDown={(event) => {
          if (!(event.target instanceof HTMLButtonElement)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>(".tasks-new-trigger")?.focus();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const next = buttons[buttons.indexOf(event.target) + (event.key === "ArrowDown" ? 1 : -1)];
            if (next) { event.preventDefault(); next.focus(); }
          }
        }}>
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
              {reorderingCategories ? <Button type="button" size="icon-xs" variant="ghost" onClick={() => { setReorderingCategories(false); setPointerDraggedCategory(null); setDragOverCategory(null); }} aria-label={t("tasks.finishReorderingCategories")} title={t("tasks.finishReorderingCategories")}><Check aria-hidden="true" /></Button> : null}
              <button type="button" className="tasks-category-add" onClick={() => beginCategoryName()} disabled={saving || categoryDraft !== null} aria-label={t("tasks.newCategory")} title={t("tasks.newCategory")}><Plus aria-hidden="true" /></button>
            </div>

            {categoryDraft?.original === null ? <div className="tasks-category-name-edit">
              <input autoFocus value={categoryDraft.value} placeholder={t("tasks.newCategory")} aria-label={t("tasks.newCategory")}
                onChange={(event) => { setCategoryDraft({ ...categoryDraft, value: event.target.value }); setNameError(null); }}
                onBlur={() => void commitCategoryName()}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitCategoryName(); } else if (event.key === "Escape") { event.preventDefault(); cancelCategoryName(); } }} />
              <div className="tasks-category-name-edit__actions">
                <Button type="button" size="icon-sm" variant="ghost" disabled={saving || !categoryDraft.value.trim()}
                  onPointerDown={(event) => event.preventDefault()} onClick={() => void commitCategoryName()}
                  aria-label={t("common.save")} title={t("common.save")}><Check /></Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={saving}
                  onPointerDown={(event) => event.preventDefault()} onClick={cancelCategoryName}
                  aria-label={t("common.cancel")} title={t("common.cancel")}><X /></Button>
              </div>
              {nameError ? <small role="alert">{nameError}</small> : null}
            </div> : null}

            {categories.map((category) => {
              const active = selectedView === categoryView(category);
              const dropActive = dragOverCategory === category;

              return (
                <div
                  key={category}
                  data-task-category={category}
                  className={cn(
                    "tasks-category-row",
                    reorderingCategories && "tasks-category-row--reorder-mode",
                    dropActive && `tasks-category-row--drop-${categoryDropPlacement}`,
                    pointerDraggedCategory === category && "tasks-category-row--pointer-dragging"
                  )}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setCategoryContextMenu({
                      category,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  {...getCategoryLongPressProps(category)}
                  onDragOver={(event) => {
                    if (!draggedCategory && ![TASK_DRAG_MIME, CATEGORY_DRAG_MIME, SECTION_DRAG_MIME].some((type) => event.dataTransfer.types.includes(type))) return;
                    if (event.dataTransfer.types.includes(TASK_SUBTASK_DRAG_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverCategory(category);
                    const rect = event.currentTarget.getBoundingClientRect();
                    const horizontal = window.getComputedStyle(event.currentTarget.parentElement!).display === "flex";
                    setCategoryDropPlacement((horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2) ? "before" : "after");
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverCategory(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverCategory(null);
                    const sourceCategory = draggedCategory || event.dataTransfer.getData(CATEGORY_DRAG_MIME);
                    if (sourceCategory) { moveCategoryOrder(sourceCategory, category, categoryDropPlacement); setDraggedCategory(null); return; }
                    const sourceSection = sectionFromDrop(event);
                    if (sourceSection) { void moveSection(sourceSection[0], sourceSection[1], category); return; }
                    const task = taskFromDrop(event);
                    if (task?.parentLineIndex === null) {
                      void moveTask(task, category);
                    }
                  }}
                >
                  {categoryDraft?.original === category ? <div className="tasks-category-name-edit">
                    <input autoFocus value={categoryDraft.value} aria-label={t("tasks.renameCategoryAction")}
                      onChange={(event) => { setCategoryDraft({ ...categoryDraft, value: event.target.value }); setNameError(null); }}
                      onBlur={() => void commitCategoryName()}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitCategoryName(); } else if (event.key === "Escape") { event.preventDefault(); cancelCategoryName(); } }} />
                    <div className="tasks-category-name-edit__actions">
                      <Button type="button" size="icon-sm" variant="ghost" disabled={saving || !categoryDraft.value.trim()}
                        onPointerDown={(event) => event.preventDefault()} onClick={() => void commitCategoryName()}
                        aria-label={t("common.save")} title={t("common.save")}><Check /></Button>
                      <Button type="button" size="icon-sm" variant="ghost" disabled={saving}
                        onPointerDown={(event) => event.preventDefault()} onClick={cancelCategoryName}
                        aria-label={t("common.cancel")} title={t("common.cancel")}><X /></Button>
                    </div>
                    {nameError ? <small role="alert">{nameError}</small> : null}
                  </div> : <>
                  {reorderingCategories ? <button type="button" className="tasks-category__reorder" aria-label={t("tasks.dragCategory")} title={t("tasks.dragCategory")} onPointerDown={(event) => {
                    if (event.button !== 0 || saving) return;
                    event.preventDefault();
                    lastPointerOrderTargetRef.current = null;
                    setPointerDraggedCategory(category);
                  }}><GripVertical aria-hidden="true" /></button> : null}
                  <button
                    type="button"
                    className={cn(
                      "tasks-category tasks-category--managed",
                      active && "tasks-category--active",
                      reorderingCategories && "tasks-category--reordering"
                    )}
                    onClick={() => { if (!reorderingCategories) setSelectedView(categoryView(category)); }}
                    draggable={!saving && !reorderingCategories}
                    onDragStart={(event) => { setDraggedCategory(category); event.dataTransfer.setData(CATEGORY_DRAG_MIME, category); event.dataTransfer.setData("text/plain", category); event.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDraggedCategory(null); setDragOverCategory(null); }}
                  >
                    <span>{category}</span>
                    <small>{categoryCounts.get(category) ?? 0}</small>
                  </button>
                  </>}
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
                          {t("tasks.sortName")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                        <MenuRadioItem value="date">
                          <CalendarClock className="size-4" aria-hidden="true" />
                          {t("tasks.sortDate")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                        <MenuRadioItem value="manual">
                          <GripVertical className="size-4" aria-hidden="true" />
                          {t("tasks.sortManual")}
                          <MenuRadioItemIndicator />
                        </MenuRadioItem>
                      </MenuRadioGroup>
                    </MenuPopup>
                  </MenuPositioner>
                </MenuPortal>
              </Menu>
              {selectedCategory ? (
                <>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={saving || sectionDraft !== null}
                    onClick={() => void addTask()} aria-label={t("tasks.newTask")} title={t("tasks.newTask")}>
                    <Plus />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={saving || sectionDraft !== null}
                    onClick={() => beginSectionName()} aria-label={t("tasks.newSection")} title={t("tasks.newSection")}>
                    <ListPlus />
                  </Button>
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="tasks-category-actions__more"
                          disabled={saving}
                          aria-label={t("tasks.categoryMoreActions")}
                          title={t("tasks.categoryMoreActions")}
                        >
                          <Ellipsis />
                        </Button>
                      }
                    />
                    <MenuPortal>
                      <MenuPositioner align="end">
                        <MenuPopup>
                          {selectedCategory !== UNCATEGORIZED_TASK_CATEGORY ? <MenuItem
                            onClick={() => beginCategoryName(selectedCategory)}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            {t("tasks.renameCategoryAction")}
                          </MenuItem> : null}
                          <MenuItem onClick={() => void duplicateCategory(selectedCategory)}>
                            <Copy className="size-4" aria-hidden="true" />
                            {t("tasks.duplicateCategoryAction")}
                          </MenuItem>
                          <MenuItem onClick={() => void moveCategoryTasksPrompt(selectedCategory)}>
                            <FolderInput className="size-4" aria-hidden="true" />
                            {t("tasks.moveCategoryTasksAction")}
                          </MenuItem>
                          {selectedCategory !== UNCATEGORIZED_TASK_CATEGORY ? (
                            <MenuItem
                              className="tasks-category-actions__danger"
                              onClick={() => deleteCategory(selectedCategory)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              {t("tasks.deleteCategoryAction")}
                            </MenuItem>
                          ) : null}
                        </MenuPopup>
                      </MenuPositioner>
                    </MenuPortal>
                  </Menu>
                </>
              ) : null}
            </div>
          </div>

          {visibleActiveTasks.length === 0 && !selectedCategory ? (
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
              {(selectedCategory
                ? [null, ...(sectionsByCategory[selectedCategory] ?? []), ...(sectionDraft?.original === null ? [undefined] : [])].flatMap((section) => [
                    { kind: "heading" as const, section },
                    ...visibleActiveTasks.filter((task) => (task.section ?? null) === section).map((task) => ({ kind: "task" as const, task }))
                  ])
                : visibleActiveTasks.map((task) => ({ kind: "task" as const, task }))).map((entry) => {
                if (entry.kind === "heading") {
                  if (entry.section === null) return null;
                  const section = entry.section;
                  const category = selectedCategory!;
                  if (section === undefined) return <div key="new-section" className="tasks-section-heading tasks-section-heading--editing">
                    <input autoFocus value={sectionDraft?.value ?? ""} placeholder={t("tasks.newSection")} aria-label={t("tasks.newSection")}
                      onChange={(event) => { setSectionDraft({ original: null, value: event.target.value }); setNameError(null); }}
                      onBlur={() => void commitSectionName()}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitSectionName(); } else if (event.key === "Escape") { event.preventDefault(); skipNameBlurRef.current = true; setSectionDraft(null); setNameError(null); } }} />
                    {nameError ? <small role="alert">{nameError}</small> : null}
                  </div>;
                  return <div key={`section:${section}`} className={cn(
                    "tasks-section-heading",
                    dragOverSection === section && "tasks-section-heading--drop",
                    dragOverSection === section && dragOverSectionPosition === "before" && "tasks-item--drop-before",
                    dragOverSection === section && dragOverSectionPosition === "after" && "tasks-item--drop-after"
                  )}
                    onContextMenu={(event) => { event.preventDefault(); setSectionContextMenu({ category, section, x: event.clientX, y: event.clientY }); }}
                    {...getSectionLongPressProps({ category, section })}
                    draggable={!saving && sectionDraft?.original !== section}
                    onDragStart={(event) => { event.dataTransfer.setData(SECTION_DRAG_MIME, JSON.stringify([category, section])); event.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(event) => { if (event.dataTransfer.types.includes(SECTION_DRAG_MIME) || event.dataTransfer.types.includes(TASK_DRAG_MIME)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDragOverSection(section); setDragOverSectionPosition(event.clientY < rect.top + rect.height / 2 ? "before" : "after"); } }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDragOverSection(null); setDragOverSectionPosition(null); } }}
                    onDrop={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after"; setDragOverSection(null); setDragOverSectionPosition(null); const source = sectionFromDrop(event); if (source) { void moveSection(source[0], source[1], category, section, placement); return; } const task = taskFromDrop(event); if (task) void moveTask(task, category, section); }}
                  >{sectionDraft?.original === section ? <input autoFocus value={sectionDraft.value} aria-label={t("tasks.renameSection")}
                    onChange={(event) => { setSectionDraft({ ...sectionDraft, value: event.target.value }); setNameError(null); }}
                    onBlur={() => void commitSectionName()}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitSectionName(); } else if (event.key === "Escape") { event.preventDefault(); skipNameBlurRef.current = true; setSectionDraft(null); setNameError(null); } }} /> : <h4>{section}</h4>}
                    {nameError && sectionDraft?.original === section ? <small role="alert">{nameError}</small> : null}
                    {sectionDraft?.original !== section ? <Menu><MenuTrigger render={<Button type="button" size="icon-xs" variant="ghost" draggable={false} aria-label={t("tasks.sectionMoreActions")} title={t("tasks.sectionMoreActions")} onPointerDown={(event) => event.stopPropagation()}><Ellipsis /></Button>} />
                      <MenuPortal><MenuPositioner align="end"><MenuPopup finalFocus={false}>
                        <MenuItem onClick={() => beginSectionName(section)}><Pencil className="size-4" aria-hidden="true" />{t("tasks.renameCategoryAction")}</MenuItem>
                        <MenuItem className="tasks-category-actions__danger" onClick={() => void deleteSection(category, section)}><Trash2 className="size-4" aria-hidden="true" />{t("tasks.deleteSection")}</MenuItem>
                      </MenuPopup></MenuPositioner></MenuPortal></Menu> : null}</div>;
                }
                const task = entry.task;
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
                    categories={categories}
                    sectionsByCategory={sectionsByCategory}
                    onCategoryChange={(value) => { const [category, section] = JSON.parse(value) as [string, string | null]; void moveTask(task, category, section); }}
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
                        categories={categories}
                        sectionsByCategory={sectionsByCategory}
                        onCategoryChange={(value) => { const [category, section] = JSON.parse(value) as [string, string | null]; void moveTask(task, category, section); }}
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

      {categoryContextMenu ? (
        <ContextMenuSurface
          x={categoryContextMenu.x}
          y={categoryContextMenu.y}
          title={categoryContextMenu.category}
          onClick={(event) => event.stopPropagation()}
        >
          {categoryContextMenu.category !== UNCATEGORIZED_TASK_CATEGORY ? <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              const category = categoryContextMenu.category;
              setCategoryContextMenu(null);
              beginCategoryName(category);
            }}
          >
            <Pencil aria-hidden="true" />
            {t("tasks.renameCategoryAction")}
          </button> : null}
          <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => {
            setCategoryContextMenu(null);
            setReorderingCategories(true);
          }}>
            <ArrowUpDown aria-hidden="true" />
            {t("tasks.reorderCategories")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              const category = categoryContextMenu.category;
              setCategoryContextMenu(null);
              void duplicateCategory(category);
            }}
          >
            <Copy aria-hidden="true" />
            {t("tasks.duplicateCategoryAction")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="file-tree-context-menu__item"
            onClick={() => {
              const category = categoryContextMenu.category;
              setCategoryContextMenu(null);
              void moveCategoryTasksPrompt(category);
            }}
          >
            <FolderInput aria-hidden="true" />
            {t("tasks.moveCategoryTasksAction")}
          </button>
          {categoryContextMenu.category !== UNCATEGORIZED_TASK_CATEGORY ? (
            <button
              type="button"
              role="menuitem"
              className="file-tree-context-menu__item file-tree-context-menu__item--danger"
              onClick={() => {
                const category = categoryContextMenu.category;
                setCategoryContextMenu(null);
                deleteCategory(category);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("tasks.deleteCategoryAction")}
            </button>
          ) : null}
        </ContextMenuSurface>
      ) : null}

      {sectionContextMenu ? (
        <ContextMenuSurface x={sectionContextMenu.x} y={sectionContextMenu.y} title={sectionContextMenu.section} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" className="file-tree-context-menu__item" onClick={() => {
            const { section } = sectionContextMenu;
            setSectionContextMenu(null);
            beginSectionName(section);
          }}>
            <Pencil aria-hidden="true" />
            {t("tasks.renameCategoryAction")}
          </button>
          <button type="button" role="menuitem" className="file-tree-context-menu__item file-tree-context-menu__item--danger" onClick={() => {
            const { category, section } = sectionContextMenu;
            setSectionContextMenu(null);
            void deleteSection(category, section);
          }}>
            <Trash2 aria-hidden="true" />
            {t("tasks.deleteSection")}
          </button>
        </ContextMenuSurface>
      ) : null}

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
