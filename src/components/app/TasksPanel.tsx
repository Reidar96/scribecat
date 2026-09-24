import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ListTodo,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import {
  UNCATEGORIZED_TASK_CATEGORY,
  appendTaskToMarkdown,
  createTaskDocument,
  parseTaskMarkdown,
  removeTaskFromMarkdown,
  sanitizeTaskCategory,
  taskCategoryFromRelativePath,
  taskRelativePath,
  updateTaskInMarkdown,
  type MarkdownTask
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { join } from "@/platform/paths";

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
};

const ALL_CATEGORIES = "__all__";

function deadlineSortValue(deadline: string | null): string {
  return deadline ?? "9999-99-99";
}

function TaskRow({
  task,
  onToggle,
  onTextChange,
  onDeadlineChange,
  onDelete
}: {
  task: TaskItem;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDeadlineChange: (deadline: string | null) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [textDraft, setTextDraft] = useState(task.text);

  useEffect(() => {
    setTextDraft(task.text);
  }, [task.text]);

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
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

  return (
    <article
      className={cn(
        "tasks-item",
        task.checked && "tasks-item--checked",
        overdue && "tasks-item--overdue"
      )}
    >
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

        <div className="tasks-item__meta">
          <span className="tasks-item__category">{task.category}</span>
          <label className="tasks-item__deadline">
            <CalendarClock aria-hidden="true" />
            <input
              type="date"
              value={task.deadline ?? ""}
              onChange={(event) =>
                onDeadlineChange(event.target.value || null)
              }
              aria-label={t("tasks.deadline")}
            />
          </label>
        </div>
      </div>

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
  onPersistTaskFile
}: TasksPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const [documents, setDocuments] = useState<Record<string, TaskDocument>>({});
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [textDraft, setTextDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const taskFiles = filePaths.flatMap((filePath) => {
      const relativePath = getRelativeDisplayPath(folderPath, filePath);
      const category = taskCategoryFromRelativePath(relativePath);
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
  }, [filePaths, folderPath]);

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

  const allTasks = useMemo<TaskItem[]>(() => {
    return Object.values(documents)
      .flatMap((document) =>
        document.tasks.map((task) => ({
          ...task,
          category: document.category,
          filePath: document.filePath
        }))
      )
      .sort((left, right) => {
        if (left.checked !== right.checked) return left.checked ? 1 : -1;
        const deadlineCompare = deadlineSortValue(left.deadline).localeCompare(
          deadlineSortValue(right.deadline)
        );
        if (deadlineCompare !== 0) return deadlineCompare;
        return left.text.localeCompare(
          right.text,
          i18n.resolvedLanguage ?? i18n.language,
          { sensitivity: "base" }
        );
      });
  }, [documents, i18n.language, i18n.resolvedLanguage]);

  const visibleTasks =
    selectedCategory === ALL_CATEGORIES
      ? allTasks
      : allTasks.filter((task) => task.category === selectedCategory);

  const categoryCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of allTasks) {
      result.set(task.category, (result.get(task.category) ?? 0) + 1);
    }
    return result;
  }, [allTasks]);

  const resolveFilePath = async (category: string): Promise<string> => {
    const existing = documents[category]?.filePath;
    if (existing) return existing;

    return join(
      folderPath,
      ...taskRelativePath(category).split("/").filter(Boolean)
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

    const category = sanitizeTaskCategory(
      categoryDraft ||
        (selectedCategory !== ALL_CATEGORIES ? selectedCategory : "")
    );
    const existing = documents[category]?.markdown;
    const markdown = existing
      ? appendTaskToMarkdown(existing, {
          text,
          deadline: deadlineDraft || null
        })
      : createTaskDocument(category, {
          text,
          deadline: deadlineDraft || null
        });

    setSaving(true);
    try {
      if (await persistCategory(category, markdown)) {
        setTextDraft("");
        setDeadlineDraft("");
        if (selectedCategory !== ALL_CATEGORIES) {
          setSelectedCategory(category);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const mutateTask = async (
    task: TaskItem,
    mutation: "toggle" | "delete" | "text" | "deadline",
    value?: string | null
  ) => {
    const document = documents[task.category];
    if (!document) return;

    const markdown =
      mutation === "delete"
        ? removeTaskFromMarkdown(document.markdown, task.lineIndex)
        : updateTaskInMarkdown(document.markdown, task.lineIndex, {
            checked: mutation === "toggle" ? !task.checked : task.checked,
            text: mutation === "text" ? value ?? task.text : task.text,
            deadline:
              mutation === "deadline"
                ? value || null
                : task.deadline
          });

    await persistCategory(task.category, markdown);
  };

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
            <ListTodo aria-hidden="true" />
            <h2>{t("tasks.title")}</h2>
          </div>
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label={t("tasks.close")}
          title={t("tasks.close")}
        >
          <X />
        </Button>
      </header>

      <div className="tasks-view__layout">
        <aside className="tasks-categories">
          <button
            type="button"
            className={cn(
              "tasks-category",
              selectedCategory === ALL_CATEGORIES && "tasks-category--active"
            )}
            onClick={() => {
              setSelectedCategory(ALL_CATEGORIES);
              setCategoryDraft("");
            }}
          >
            <span>{t("tasks.all")}</span>
            <small>{allTasks.length}</small>
          </button>

          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={cn(
                "tasks-category",
                selectedCategory === category && "tasks-category--active"
              )}
              onClick={() => {
                setSelectedCategory(category);
                setCategoryDraft(
                  category === UNCATEGORIZED_TASK_CATEGORY ? "" : category
                );
              }}
            >
              <span>{category}</span>
              <small>{categoryCounts.get(category) ?? 0}</small>
            </button>
          ))}
        </aside>

        <main className="tasks-main">
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
            <Button
              type="submit"
              disabled={!textDraft.trim() || saving}
              className="tasks-create__button"
            >
              <Plus />
              {t("tasks.add")}
            </Button>
          </form>

          <div className="tasks-main__heading">
            <div>
              <h3>
                {selectedCategory === ALL_CATEGORIES
                  ? t("tasks.all")
                  : selectedCategory}
              </h3>
              <p>{t("tasks.count", { count: visibleTasks.length })}</p>
            </div>
            <CheckCircle2 aria-hidden="true" />
          </div>

          {visibleTasks.length === 0 ? (
            <div className="tasks-empty">
              <ListTodo aria-hidden="true" />
              <p>{t("tasks.empty")}</p>
            </div>
          ) : (
            <div className="tasks-list">
              {visibleTasks.map((task) => (
                <TaskRow
                  key={`${task.filePath}:${task.lineIndex}`}
                  task={task}
                  onToggle={() => void mutateTask(task, "toggle")}
                  onTextChange={(text) =>
                    void mutateTask(task, "text", text)
                  }
                  onDeadlineChange={(deadline) =>
                    void mutateTask(task, "deadline", deadline)
                  }
                  onDelete={() => void mutateTask(task, "delete")}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
