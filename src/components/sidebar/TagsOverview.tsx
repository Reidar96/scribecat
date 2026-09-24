import { Tag, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TagSummary } from "@/hooks/useTagIndex";

type TagsOverviewProps = {
  summaries: TagSummary[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
};

export function TagsOverview({ summaries, activeTag, onSelect }: TagsOverviewProps) {
  const { t } = useTranslation();

  return (
    <section className="sidebar-tags" aria-label={t("tags.overview")}>
      <div className="sidebar-tags__header">
        <Tag aria-hidden="true" />
        <span>{t("tags.overview")}</span>
        {activeTag ? (
          <button
            type="button"
            className="sidebar-tags__clear"
            aria-label={t("tags.clearFilter")}
            title={t("tags.clearFilter")}
            onClick={() => onSelect(null)}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {summaries.length === 0 ? (
        <p className="sidebar-tags__empty">{t("tags.noneInVault")}</p>
      ) : (
        <div className="sidebar-tags__list">
          {summaries.map((summary) => (
            <button
              key={summary.tag.toLocaleLowerCase()}
              type="button"
              className="sidebar-tags__item"
              data-active={activeTag?.toLocaleLowerCase() === summary.tag.toLocaleLowerCase() ? "true" : undefined}
              onClick={() =>
                onSelect(
                  activeTag?.toLocaleLowerCase() === summary.tag.toLocaleLowerCase()
                    ? null
                    : summary.tag
                )
              }
            >
              <span className="sidebar-tags__name">#{summary.tag}</span>
              <span className="sidebar-tags__count">{summary.count}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
