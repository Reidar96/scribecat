import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useEditorSettingsStore, type DetailsSectionId } from "@/store/useEditorSettingsStore";

type DetailsSectionProps = {
  id: DetailsSectionId;
  title: ReactNode;
  children: ReactNode;
};

export function useDetailsSectionCollapsed(id: DetailsSectionId): boolean {
  return useEditorSettingsStore((state) => state.collapsedDetailsSections.includes(id));
}

/**
 * One foldable section of the details panel. The fold state is kept in the
 * settings store, so the outline can unfold itself when the editor hands it
 * the keyboard focus, and it survives switching files and restarts.
 */
export function DetailsSection({ id, title, children }: DetailsSectionProps) {
  const { t } = useTranslation();
  const collapsed = useDetailsSectionCollapsed(id);
  const setCollapsed = useEditorSettingsStore((state) => state.setDetailsSectionCollapsed);
  const contentId = `details-section-${id}`;

  return (
    <section className="details-sidebar__section" data-collapsed={collapsed ? "true" : undefined}>
      <h4 className="details-sidebar__section-title">
        <button
          type="button"
          className="details-sidebar__section-toggle"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          title={collapsed ? t("detailsPanel.expandSection") : t("detailsPanel.collapseSection")}
          onClick={() => setCollapsed(id, !collapsed)}
        >
          <span className="details-sidebar__section-chevron" aria-hidden="true">
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </span>
          <span className="details-sidebar__section-label">{title}</span>
        </button>
      </h4>

      {collapsed ? null : <div id={contentId}>{children}</div>}
    </section>
  );
}
