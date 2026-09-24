import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DetailsSection } from "@/components/editor/DetailsSection";
import { extractTags, normalizeTag, setTags } from "@/lib/documentFrontmatter";

type DetailsTagsSectionProps = {
  markdown: string;
  readOnly: boolean;
  onMarkdownChange: (markdown: string) => void;
};

export function DetailsTagsSection({
  markdown,
  readOnly,
  onMarkdownChange
}: DetailsTagsSectionProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const tags = useMemo(() => extractTags(markdown), [markdown]);

  const addTag = () => {
    const tag = normalizeTag(draft);

    if (!tag || readOnly) {
      return;
    }

    onMarkdownChange(setTags(markdown, [...tags, tag]));
    setDraft("");
  };

  const removeTag = (tag: string) => {
    if (readOnly) {
      return;
    }

    onMarkdownChange(setTags(markdown, tags.filter((current) => current !== tag)));
  };

  return (
    <DetailsSection id="tags" title={t("tags.title")}>
      <div className="details-tags">
        {tags.length > 0 ? (
          <div className="details-tags__chips" aria-label={t("tags.current")}>
            {tags.map((tag) => (
              <span key={tag} className="details-tags__chip">
                <span>{tag}</span>
                {readOnly ? null : (
                  <button
                    type="button"
                    className="details-tags__remove"
                    aria-label={t("tags.remove", { tag })}
                    title={t("tags.remove", { tag })}
                    onClick={() => removeTag(tag)}
                  >
                    <X aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="details-sidebar__empty">{t("tags.none")}</p>
        )}

        <div className="details-tags__add">
          <input
            type="text"
            value={draft}
            disabled={readOnly}
            placeholder={t(readOnly ? "tags.lockedPlaceholder" : "tags.placeholder")}
            aria-label={t("tags.add")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag();
              }
            }}
          />
          <button
            type="button"
            disabled={readOnly || !normalizeTag(draft)}
            aria-label={t("tags.add")}
            title={t("tags.add")}
            onClick={addTag}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>
    </DetailsSection>
  );
}
