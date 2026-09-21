/** Types shared between FileTree, its rows and its consumers. */

/**
 * A freshly created entry the tree should switch straight into rename mode
 * for. Files and folders take the same route: the name is typed where the
 * entry lives, next to its siblings, instead of in the title row — the
 * breadcrumb cannot show a folder at all and is the first thing truncated on
 * a phone. The requestId is what makes a second creation of the same path
 * (create, undo, create again) a new request rather than a no-op.
 */
export type PendingEntryRename = {
  kind: "file" | "folder";
  /** Absolute path, as the store's create actions return it. */
  path: string;
  requestId: number;
};

export type DropPosition = "above" | "below" | "into";

export type DropIndicator = {
  key: string;
  position: DropPosition;
};

export type BatchEntry = { kind: "file" | "folder"; path: string };

export type FileContextMenuState =
  | { kind: "file"; filePath: string; x: number; y: number }
  | { kind: "folder"; relativePath: string; x: number; y: number }
  | { kind: "multiple"; keys: string[]; x: number; y: number };

export type RenamingTarget =
  | { kind: "file"; relativePath: string }
  | { kind: "folder"; relativePath: string };
