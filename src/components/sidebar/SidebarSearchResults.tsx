import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { VaultSearchResult } from "@/hooks/useVaultSearch";

type SidebarSearchResultsProps = {
  results: VaultSearchResult[];
  loading: boolean;
  onOpen: (filePath: string) => void;
};

export function SidebarSearchResults({
  results,
  loading,
  onOpen
}: SidebarSearchResultsProps) {
  const { t } = useTranslation();

  if (loading) {
    return <p className="sidebar-search-results__empty">{t("sidebar.searchLoading")}</p>;
  }

  if (results.length === 0) {
    return <p className="sidebar-search-results__empty">{t("sidebar.searchNoResults")}</p>;
  }

  return (
    <div className="sidebar-search-results" aria-label={t("sidebar.searchResults")}>
      {results.map((result) => (
        <button
          key={result.filePath}
          type="button"
          className="sidebar-search-result"
          onClick={() => onOpen(result.filePath)}
        >
          <FileText aria-hidden="true" />
          <span className="sidebar-search-result__body">
            <strong>{result.title}</strong>
            <span className="sidebar-search-result__path">
              {result.parentPath || t("collection.root")}
            </span>
            {result.tags.length > 0 ? (
              <span className="sidebar-search-result__tags">
                {result.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
