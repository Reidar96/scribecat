import { useEffect, useMemo, useState } from "react";

import { extractTags } from "@/lib/documentFrontmatter";
import { readMarkdownFile } from "@/lib/fileSystem";

export type TagSummary = {
  tag: string;
  count: number;
  filePaths: string[];
};

export function useTagIndex(
  filePaths: string[],
  selectedFilePath: string | null,
  selectedFileContent: string | null
): TagSummary[] {
  const [tagsByPath, setTagsByPath] = useState<Record<string, string[]>>({});

  // Build the vault index when the file list changes. A refresh gives us a new
  // list reference, so external changes are picked up too. Typing in the open
  // note is handled by the small effect below and never re-reads the vault.
  useEffect(() => {
    let active = true;

    void Promise.all(
      filePaths.map(async (filePath) => ({
        filePath,
        tags: extractTags(await readMarkdownFile(filePath).catch(() => ""))
      }))
    ).then((records) => {
      if (!active) {
        return;
      }

      setTagsByPath(
        Object.fromEntries(records.map((record) => [record.filePath, record.tags]))
      );
    });

    return () => {
      active = false;
    };
  }, [filePaths]);

  useEffect(() => {
    if (!selectedFilePath || selectedFileContent === null) {
      return;
    }

    const nextTags = extractTags(selectedFileContent);
    setTagsByPath((current) => {
      const previous = current[selectedFilePath] ?? [];

      if (
        previous.length === nextTags.length &&
        previous.every((tag, index) => tag === nextTags[index])
      ) {
        return current;
      }

      return { ...current, [selectedFilePath]: nextTags };
    });
  }, [selectedFilePath, selectedFileContent]);

  return useMemo(() => {
    const byKey = new Map<string, TagSummary>();

    for (const filePath of filePaths) {
      for (const tag of tagsByPath[filePath] ?? []) {
        const key = tag.toLocaleLowerCase();
        const existing = byKey.get(key);

        if (existing) {
          existing.count += 1;
          existing.filePaths.push(filePath);
        } else {
          byKey.set(key, { tag, count: 1, filePaths: [filePath] });
        }
      }
    }

    return [...byKey.values()].sort((left, right) =>
      left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" })
    );
  }, [filePaths, tagsByPath]);
}
