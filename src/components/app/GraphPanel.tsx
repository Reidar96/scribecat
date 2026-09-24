import { useEffect, useMemo, useState } from "react";
import {
  Network,
  PanelLeft,
  PanelLeftOpen,
  RefreshCw,
  Home
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { buildVaultGraph, type GraphNodeKind, type VaultGraphNode } from "@/lib/graphIndex";
import { readMarkdownFile } from "@/lib/fileSystem";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

type GraphPanelProps = {
  folderPath: string;
  filePaths: string[];
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onOpenSidebar: () => void;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (relativePath: string) => void;
  onOpenTag: (tag: string, filePaths: string[]) => void;
};

type Visibility = Record<GraphNodeKind, boolean>;

const INITIAL_VISIBILITY: Visibility = {
  note: true,
  tag: true,
  folder: true
};

export function GraphPanel({
  folderPath,
  filePaths,
  selectedFilePath,
  selectedFileContent,
  sidebarVisible,
  onSidebarVisibilityToggle,
  onOpenSidebar,
  onClose,
  onOpenFile,
  onOpenFolder,
  onOpenTag
}: GraphPanelProps) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  const [visibility, setVisibility] = useState<Visibility>(INITIAL_VISIBILITY);
  const [markdownByPath, setMarkdownByPath] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [refreshId, setRefreshId] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const scan = async () => {
      const openDocuments = useAppStore.getState().fileDocuments;
      const entries = await Promise.all(
        filePaths.map(async (filePath) => {
          const openDocument = openDocuments[filePath];
          if (openDocument) {
            return [filePath, openDocument.content] as const;
          }

          try {
            return [filePath, await readMarkdownFile(filePath)] as const;
          } catch {
            return [filePath, ""] as const;
          }
        })
      );

      if (!active) return;
      setMarkdownByPath(Object.fromEntries(entries));
      setIsLoading(false);
    };

    void scan();
    return () => {
      active = false;
    };
  }, [filePaths, refreshId]);

  // The graph follows links/tags typed into the open note immediately. The
  // full vault scan above remains disk-backed and only runs on mount/refresh.
  useEffect(() => {
    if (!selectedFilePath || selectedFileContent === null) return;
    setMarkdownByPath((current) => {
      if (current[selectedFilePath] === selectedFileContent) return current;
      return { ...current, [selectedFilePath]: selectedFileContent };
    });
  }, [selectedFilePath, selectedFileContent]);

  const graph = useMemo(
    () =>
      buildVaultGraph({
        folderPath,
        filePaths,
        markdownByPath,
        rootLabel: t("collection.root")
      }),
    [folderPath, filePaths, markdownByPath, t]
  );

  const visibleGraph = useMemo(() => {
    const nodes = graph.nodes.filter((node) => visibility[node.kind]);
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return { nodes, edges };
  }, [graph, visibility]);

  const counts = useMemo(
    () => ({
      notes: graph.nodes.filter((node) => node.kind === "note").length,
      tags: graph.nodes.filter((node) => node.kind === "tag").length,
      folders: graph.nodes.filter((node) => node.kind === "folder").length,
      links: graph.edges.filter((edge) => edge.kind === "link").length
    }),
    [graph]
  );

  const setKindVisible = (kind: GraphNodeKind) => {
    setVisibility((current) => ({ ...current, [kind]: !current[kind] }));
  };

  const activateNode = (node: VaultGraphNode) => {
    if (node.kind === "note" && node.filePath) {
      onOpenFile(node.filePath);
      return;
    }

    if (node.kind === "folder") {
      onOpenFolder(node.relativePath ?? "");
      return;
    }

    if (node.kind === "tag" && node.tag) {
      const noteIds = new Set(
        graph.edges
          .filter((edge) => edge.kind === "tag" && edge.target === node.id)
          .map((edge) => edge.source)
      );
      const matchingFilePaths = graph.nodes
        .filter((candidate) => candidate.kind === "note" && noteIds.has(candidate.id))
        .flatMap((candidate) => (candidate.filePath ? [candidate.filePath] : []));

      onOpenTag(node.tag, matchingFilePaths);
    }
  };

  return (
    <section className="graph-view" aria-label={t("graph.label")}>
      <div className="graph-view__card">
        <header className="graph-view__header">
          <div className="graph-view__header-leading">
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
              onClick={layout === "phone" ? onOpenSidebar : onSidebarVisibilityToggle}
            >
              {layout === "phone" ? (
                <PanelLeft />
              ) : sidebarVisible ? (
                <PanelLeft />
              ) : (
                <PanelLeftOpen />
              )}
            </Button>

            <div className="graph-view__heading">
              <div className="graph-view__title-row">
                <Network aria-hidden="true" />
                <h2>{t("graph.title")}</h2>
              </div>
            </div>
          </div>

          <div className="graph-view__header-actions">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("graph.refresh")}
              title={t("graph.refresh")}
              onClick={() => setRefreshId((id) => id + 1)}
            >
              <RefreshCw className={cn(isLoading && "animate-spin")} />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("common.goHome")}
              title={t("common.goHome")}
              onClick={onClose}
            >
              <Home />
            </Button>
          </div>
        </header>

        <div className="graph-view__filters" aria-label={t("graph.filters")}>
          <button
            type="button"
            className="graph-view__filter"
            data-kind="note"
            data-active={visibility.note ? "true" : undefined}
            aria-pressed={visibility.note}
            onClick={() => setKindVisible("note")}
          >
            <span className="graph-view__legend-shape graph-view__legend-shape--note" aria-hidden="true" />
            {t("graph.notes")}
          </button>
          <button
            type="button"
            className="graph-view__filter"
            data-kind="tag"
            data-active={visibility.tag ? "true" : undefined}
            aria-pressed={visibility.tag}
            onClick={() => setKindVisible("tag")}
          >
            <span className="graph-view__legend-shape graph-view__legend-shape--tag" aria-hidden="true" />
            {t("graph.tags")}
          </button>
          <button
            type="button"
            className="graph-view__filter"
            data-kind="folder"
            data-active={visibility.folder ? "true" : undefined}
            aria-pressed={visibility.folder}
            onClick={() => setKindVisible("folder")}
          >
            <span className="graph-view__legend-shape graph-view__legend-shape--folder" aria-hidden="true" />
            {t("graph.folders")}
          </button>
          <span className="graph-view__hint">{t("graph.hint")}</span>
        </div>

        <div className="graph-view__body">
          {isLoading ? (
            <div className="graph-view__state">
              <RefreshCw className="animate-spin" aria-hidden="true" />
              <p>{t("graph.loading")}</p>
            </div>
          ) : graph.nodes.length === 0 ? (
            <div className="graph-view__state">
              <Network aria-hidden="true" />
              <p>{t("graph.empty")}</p>
            </div>
          ) : visibleGraph.nodes.length === 0 ? (
            <div className="graph-view__state">
              <Network aria-hidden="true" />
              <p>{t("graph.allHidden")}</p>
            </div>
          ) : (
            <GraphCanvas
              nodes={visibleGraph.nodes}
              edges={visibleGraph.edges}
              activeFilePath={selectedFilePath}
              onActivateNode={activateNode}
            />
          )}
        </div>
      </div>
    </section>
  );
}
