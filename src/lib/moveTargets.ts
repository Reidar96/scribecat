/**
 * The folder list behind "Move to…" in the file tree's context menu: the
 * touch replacement for dragging a row, and a keyboard path on the desktop.
 * Everything here works on vault-relative paths with forward slashes.
 */

export type MoveSource = {
  kind: "file" | "folder";
  relativePath: string;
};

export type MoveTarget = {
  /** "" for the vault root. */
  relativePath: string;
  name: string;
  depth: number;
  /** The entries are already there, or a folder would be moved into itself. */
  disabled: boolean;
};

function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");

  return index === -1 ? "" : relativePath.slice(0, index);
}

function isSameOrInside(candidate: string, folder: string): boolean {
  return candidate === folder || candidate.startsWith(`${folder}/`);
}

/**
 * Every folder of the vault (derived from the note paths and the empty
 * folders, since folders are not tracked on their own), root first, sorted
 * the way the tree shows them, with the targets that make no sense for the
 * given sources disabled rather than hidden: a greyed row explains itself,
 * a missing one does not.
 */
export function listMoveTargets(
  fileRelativePaths: string[],
  emptyFolderRelativePaths: string[],
  sources: MoveSource[]
): MoveTarget[] {
  const folders = new Set<string>();

  for (const path of fileRelativePaths) {
    let parent = parentOf(path);

    while (parent !== "") {
      folders.add(parent);
      parent = parentOf(parent);
    }
  }

  for (const path of emptyFolderRelativePaths) {
    let current = path;

    while (current !== "") {
      folders.add(current);
      current = parentOf(current);
    }
  }

  const sorted = [...folders].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
  );

  const sourceParents = new Set(sources.map((source) => parentOf(source.relativePath)));
  const sourceFolders = sources
    .filter((source) => source.kind === "folder")
    .map((source) => source.relativePath);

  const disabledFor = (target: string) =>
    // Moving within the same parent is a reorder, which is what the drag
    // handle is for; here it would only look like nothing happened.
    (sourceParents.size === 1 && sourceParents.has(target)) ||
    sourceFolders.some((folder) => isSameOrInside(target, folder));

  return [
    { relativePath: "", name: "", depth: 0, disabled: disabledFor("") },
    ...sorted.map((relativePath) => ({
      relativePath,
      name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
      depth: relativePath.split("/").length,
      disabled: disabledFor(relativePath)
    }))
  ];
}
