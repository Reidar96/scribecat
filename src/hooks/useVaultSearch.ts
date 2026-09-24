import { useEffect, useMemo, useState } from "react";

import { extractTags, splitFrontmatter } from "@/lib/documentFrontmatter";
import { getRelativeDisplayPath, readMarkdownFile } from "@/lib/fileSystem";
import { getNoteDisplayName } from "@/lib/folderNotes";

export type VaultSearchResult = {
  filePath: string;
  relativePath: string;
  title: string;
  parentPath: string;
  tags: string[];
};

type IndexedRecord = VaultSearchResult & {
  haystack: string;
};

function parentPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

function indexRecord(filePath: string, relativePath: string, markdown: string): IndexedRecord {
  const tags = extractTags(markdown);
  const title = getNoteDisplayName(relativePath);
  const parent = parentPath(relativePath);
  const body = splitFrontmatter(markdown).body;

  return {
    filePath,
    relativePath,
    title,
    parentPath: parent,
    tags,
    haystack: [title, relativePath, ...tags, body].join("\n").toLocaleLowerCase()
  };
}

/**
 * Lightweight vault-wide text index used by the sidebar search.
 *
 * Nothing is persisted: Markdown files remain the source of truth. The index
 * is built lazily when the search field is in use and refreshed when the
 * vault's file list changes. The open note is patched from its in-memory
 * content so unsaved edits are searchable too.
 */
export function useVaultSearch(
  query: string,
  folderPath: string | null,
  filePaths: string[],
  selectedFilePath: string | null,
  selectedFileContent: string | null
): { results: VaultSearchResult[]; loading: boolean } {
  const active = query.trim().length > 0;
  const [records, setRecords] = useState<IndexedRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !folderPath) {
      setLoading(false);
      return;
    }

    let current = true;
    setLoading(true);

    void Promise.all(
      filePaths.map(async (filePath) => {
        const markdown =
          filePath === selectedFilePath && selectedFileContent !== null
            ? selectedFileContent
            : await readMarkdownFile(filePath).catch(() => "");
        return indexRecord(filePath, getRelativeDisplayPath(folderPath, filePath), markdown);
      })
    ).then((next) => {
      if (!current) return;
      setRecords(next);
      setLoading(false);
    });

    return () => {
      current = false;
    };
    // selected content is patched by the smaller effect below; do not rebuild
    // the whole vault for every keystroke in the open note.
  }, [active, filePaths, folderPath, selectedFilePath]);

  useEffect(() => {
    if (!active || !folderPath || !selectedFilePath || selectedFileContent === null) {
      return;
    }

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);
    const next = indexRecord(selectedFilePath, relativePath, selectedFileContent);

    setRecords((current) => {
      const index = current.findIndex((record) => record.filePath === selectedFilePath);
      if (index < 0) return current;
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }, [active, folderPath, selectedFileContent, selectedFilePath]);

  const results = useMemo(() => {
    if (!active) return [];

    const terms = query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return records
      .filter((record) => terms.every((term) => record.haystack.includes(term)))
      .sort((left, right) => {
        const leftTitle = left.title.toLocaleLowerCase();
        const rightTitle = right.title.toLocaleLowerCase();
        const first = terms[0] ?? "";

        const leftStarts = leftTitle.startsWith(first);
        const rightStarts = rightTitle.startsWith(first);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;

        return left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
          numeric: true
        });
      });
  }, [active, query, records]);

  return { results, loading };
}
