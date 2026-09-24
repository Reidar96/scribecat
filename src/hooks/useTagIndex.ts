import { useEffect, useState } from "react";

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
  const [summaries, setSummaries] = useState<TagSummary[]>([]);

  useEffect(() => {
    let active = true;

    void Promise.all(
      filePaths.map(async (filePath) => {
        const markdown =
          filePath === selectedFilePath && selectedFileContent !== null
            ? selectedFileContent
            : await readMarkdownFile(filePath).catch(() => "");
        return { filePath, tags: extractTags(markdown) };
      })
    ).then((records) => {
      if (!active) {
        return;
      }

      const byKey = new Map<string, TagSummary>();

      for (const record of records) {
        for (const tag of record.tags) {
          const key = tag.toLocaleLowerCase();
          const existing = byKey.get(key);

          if (existing) {
            existing.count += 1;
            existing.filePaths.push(record.filePath);
          } else {
            byKey.set(key, { tag, count: 1, filePaths: [record.filePath] });
          }
        }
      }

      setSummaries(
        [...byKey.values()].sort((left, right) =>
          left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" })
        )
      );
    });

    return () => {
      active = false;
    };
  }, [filePaths, selectedFilePath, selectedFileContent]);

  return summaries;
}
