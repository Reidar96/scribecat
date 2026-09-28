import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Home } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { listMoveTargets, type MoveSource } from "@/lib/moveTargets";
import { isJournalRelativePath } from "@/lib/journal";
import { isTasksContainerRelativePath } from "@/lib/tasks";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { cn } from "@/lib/utils";

/** Beyond this many folders the list gets a filter field. */
const FILTER_THRESHOLD = 10;

export type MoveRequest = {
  sources: MoveSource[];
  /** Display name of the single entry, or null for a multi-selection. */
  label: string | null;
};

type MoveToDialogProps = {
  request: MoveRequest | null;
  fileRelativePaths: string[];
  emptyFolderRelativePaths: string[];
  isMoving: boolean;
  onConfirm: (targetRelativePath: string) => void;
  onCancel: () => void;
};

/**
 * Folder picker behind "Move to…" in the tree's context menu. Drag and drop
 * needs a mouse; this is the way a note or folder changes place on a touch
 * screen, and a keyboard-only path on the desktop.
 */
export function MoveToDialog({
  request,
  fileRelativePaths,
  emptyFolderRelativePaths,
  isMoving,
  onConfirm,
  onCancel
}: MoveToDialogProps) {
  const { t } = useTranslation();
  const journalSettings = useEditorSettingsStore((state) => state.journalSettings);
  const taskSettings = useEditorSettingsStore((state) => state.taskSettings);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const targets = useMemo(
    () =>
      request ? listMoveTargets(fileRelativePaths, emptyFolderRelativePaths, request.sources).filter((target) =>
        !(journalSettings.hideFromSidebar && isJournalRelativePath(target.relativePath, journalSettings)) &&
        !(taskSettings.hideFromSidebar && isTasksContainerRelativePath(target.relativePath, taskSettings.folder))
      ) : [],
    [request, fileRelativePaths, emptyFolderRelativePaths, journalSettings, taskSettings]
  );

  const showFilter = targets.length > FILTER_THRESHOLD;
  const query = filter.trim().toLowerCase();
  const visibleTargets = query
    ? targets.filter((target) => target.relativePath.toLowerCase().includes(query))
    : targets;
  const displayRows = useMemo(() => {
    if (query) return visibleTargets.map((target) => ({ target, depth: target.depth, expandable: false }));
    const childrenOf = (parent: string) => targets.filter((target) => {
      if (!target.relativePath) return false;
      const slash = target.relativePath.lastIndexOf("/");
      return (slash < 0 ? "" : target.relativePath.slice(0, slash)) === parent;
    });
    const rows: { target: typeof targets[number]; depth: number; expandable: boolean }[] = [];
    const visit = (parent: string, depth: number) => {
      for (const target of childrenOf(parent)) {
        const expandable = childrenOf(target.relativePath).length > 0;
        rows.push({ target, depth, expandable });
        if (expanded.has(target.relativePath)) visit(target.relativePath, depth + 1);
      }
    };
    const rootTarget = targets.find((target) => target.relativePath === "");
    if (rootTarget) rows.push({ target: rootTarget, depth: 0, expandable: false });
    visit("", 0);
    return rows;
  }, [query, visibleTargets, targets, expanded]);

  useEffect(() => {
    if (request) {
      setFilter("");
      setSelected(null);
      setExpanded(new Set());
    }
  }, [request]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isMoving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request, isMoving, onCancel]);

  useEffect(() => {
    if (request) {
      listRef.current?.focus();
    }
  }, [request]);

  if (!request) {
    return null;
  }

  const selectedTarget = targets.find((target) => target.relativePath === selected);
  const canConfirm = selectedTarget !== undefined && !selectedTarget.disabled && !isMoving;

  const confirm = () => {
    if (canConfirm && selected !== null) {
      onConfirm(selected);
    }
  };

  return (
    <div
      className="unsaved-dialog"
      role="presentation"
      onClick={() => {
        if (!isMoving) {
          onCancel();
        }
      }}
    >
      <div
        className="unsaved-dialog__panel move-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="unsaved-dialog__eyebrow">{t("moveDialog.eyebrow")}</p>
        <h3 id="move-dialog-title">
          {request.label
            ? t("moveDialog.title", { name: request.label })
            : t("moveDialog.titleMultiple", { count: request.sources.length })}
        </h3>

        {showFilter ? (
          <input
            type="search"
            className="move-dialog__filter"
            value={filter}
            placeholder={t("moveDialog.filterPlaceholder")}
            aria-label={t("moveDialog.filterPlaceholder")}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}

        <div
          ref={listRef}
          className="move-dialog__list"
          role="listbox"
          aria-label={t("moveDialog.listLabel")}
          tabIndex={0}
          onKeyDown={(event) => {
            const enabled = displayRows.map(({ target }) => target).filter((target) => !target.disabled);

            if (enabled.length === 0) {
              return;
            }

            const index = enabled.findIndex((target) => target.relativePath === selected);

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected(enabled[Math.min(index + 1, enabled.length - 1)].relativePath);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected(enabled[Math.max(index - 1, 0)].relativePath);
            } else if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
          }}
        >
          {visibleTargets.length === 0 ? (
            <p className="move-dialog__empty">{t("moveDialog.noMatch")}</p>
          ) : (
            displayRows.map(({ target, depth, expandable }) => {
              const isSelected = target.relativePath === selected;

              return (
                <button
                  key={target.relativePath}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-expanded={expandable ? expanded.has(target.relativePath) : undefined}
                  disabled={target.disabled}
                  className={cn("move-dialog__item", isSelected && "move-dialog__item--selected")}
                  style={{ paddingLeft: `${0.6 + depth * 1.1}rem` }}
                  title={target.relativePath || t("moveDialog.root")}
                  onClick={() => {
                    setSelected(target.relativePath);
                    if (expandable && target.relativePath) {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(target.relativePath)) next.delete(target.relativePath);
                        else next.add(target.relativePath);
                        return next;
                      });
                    }
                  }}
                  onDoubleClick={() => {
                    if (!target.disabled) {
                      onConfirm(target.relativePath);
                    }
                  }}
                >
                  {expandable && target.relativePath ? (expanded.has(target.relativePath) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />) : null}
                  {target.relativePath === "" ? (
                    <Home aria-hidden="true" />
                  ) : isSelected ? (
                    <FolderOpen aria-hidden="true" />
                  ) : (
                    <Folder aria-hidden="true" />
                  )}
                  <span className="move-dialog__item-name">
                    {target.relativePath === "" ? t("moveDialog.root") : target.name}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="unsaved-dialog__actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isMoving}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={confirm} disabled={!canConfirm} data-testid="move-confirm">
            {isMoving ? t("moveDialog.moving") : t("moveDialog.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
