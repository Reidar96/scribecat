import { extractTags } from "@/lib/documentFrontmatter";
import { collectOutgoingFileLinks } from "@/lib/editor/documentLinks";
import { getRelativeDisplayPath } from "@/lib/fileSystem";
import { getNoteDisplayName } from "@/lib/folderNotes";

export type GraphNodeKind = "note" | "tag" | "folder";
export type GraphEdgeKind = "link" | "tag" | "folder";

export type VaultGraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Note nodes only. */
  filePath?: string;
  /** Note and folder nodes; always vault-relative and "/" separated. */
  relativePath?: string;
  /** Tag nodes only, preserving the first spelling found in the vault. */
  tag?: string;
};

export type VaultGraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
};

export type VaultGraph = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
};

type BuildVaultGraphOptions = {
  folderPath: string;
  filePaths: string[];
  markdownByPath: Record<string, string>;
  rootLabel: string;
};

function noteId(filePath: string): string {
  return `note:${filePath}`;
}

function folderKey(relativePath: string): string {
  return relativePath.toLocaleLowerCase();
}

function folderId(relativePath: string): string {
  return `folder:${folderKey(relativePath)}`;
}

function tagId(tag: string): string {
  return `tag:${tag.toLocaleLowerCase()}`;
}

function parentFolderOf(relativeFilePath: string): string {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

function folderLabel(relativePath: string, rootLabel: string): string {
  if (!relativePath) {
    return rootLabel;
  }

  return relativePath.split("/").filter(Boolean).pop() ?? relativePath;
}

function edgeId(kind: GraphEdgeKind, source: string, target: string, undirected = false): string {
  if (!undirected || source < target) {
    return `${kind}:${source}→${target}`;
  }

  return `${kind}:${target}→${source}`;
}

/**
 * Builds the global ScribeCat graph from the vault's ordinary Markdown files.
 * Nothing is persisted: notes, YAML tags, folder placement and resolvable
 * Markdown links are the only source of truth.
 */
export function buildVaultGraph({
  folderPath,
  filePaths,
  markdownByPath,
  rootLabel
}: BuildVaultGraphOptions): VaultGraph {
  const nodes: VaultGraphNode[] = [];
  const edges: VaultGraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const folderPathsByKey = new Map<string, string>();
  const tagsByKey = new Map<string, string>();

  const addNode = (node: VaultGraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addEdge = (
    kind: GraphEdgeKind,
    source: string,
    target: string,
    undirected = false
  ) => {
    const id = edgeId(kind, source, target, undirected);
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, kind, source, target });
  };

  for (const filePath of filePaths) {
    const relativePath = getRelativeDisplayPath(folderPath, filePath).replace(/\\/g, "/");
    addNode({
      id: noteId(filePath),
      kind: "note",
      label: getNoteDisplayName(filePath),
      filePath,
      relativePath
    });

    const parentFolder = parentFolderOf(relativePath);
    const key = folderKey(parentFolder);
    if (!folderPathsByKey.has(key)) {
      folderPathsByKey.set(key, parentFolder);
    }

    for (const tag of extractTags(markdownByPath[filePath] ?? "")) {
      const tagKey = tag.toLocaleLowerCase();
      if (!tagsByKey.has(tagKey)) {
        tagsByKey.set(tagKey, tag);
      }
    }
  }

  for (const relativePath of folderPathsByKey.values()) {
    addNode({
      id: folderId(relativePath),
      kind: "folder",
      label: folderLabel(relativePath, rootLabel),
      relativePath
    });
  }

  for (const tag of tagsByKey.values()) {
    addNode({
      id: tagId(tag),
      kind: "tag",
      label: `#${tag}`,
      tag
    });
  }

  for (const filePath of filePaths) {
    const source = noteId(filePath);
    const markdown = markdownByPath[filePath] ?? "";
    const relativePath = getRelativeDisplayPath(folderPath, filePath).replace(/\\/g, "/");
    const parentFolder = parentFolderOf(relativePath);

    addEdge("folder", source, folderId(parentFolder));

    for (const tag of extractTags(markdown)) {
      addEdge("tag", source, tagId(tag));
    }

    for (const link of collectOutgoingFileLinks(markdown, filePath, filePaths)) {
      if (!link.targetFilePath) continue;
      addEdge("link", source, noteId(link.targetFilePath), true);
    }
  }

  return { nodes, edges };
}
