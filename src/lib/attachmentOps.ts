import { getVaultStorage } from "@/platform";
import { dirname, join } from "@/platform/paths";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile
} from "@/platform/vaultFs";
import {
  getRelativeDisplayPath,
  isPathInsideVault,
  normalizeDisplayPath
} from "@/lib/vaultPaths";

export const ATTACHMENTS_FOLDER_NAME = "_attachments";

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_LINK_PATTERN =
  /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

type ManagedAttachmentRef = {
  rawTarget: string;
  rootRelativePath: string;
  start: number;
  end: number;
};

function isManagedAttachmentPath(rootRelativePath: string): boolean {
  const normalized = normalizeDisplayPath(rootRelativePath);
  const segments = normalized.split("/").filter(Boolean);
  return segments.includes(ATTACHMENTS_FOLDER_NAME);
}

async function parseManagedAttachmentRefs(
  markdown: string,
  filePath: string,
  folderPath: string
): Promise<ManagedAttachmentRef[]> {
  const fileDirectory = await dirname(filePath);
  const refs: ManagedAttachmentRef[] = [];

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawTarget = match[1];
    const matchIndex = match.index;
    if (
      matchIndex === undefined ||
      !rawTarget ||
      rawTarget.startsWith("#") ||
      ABSOLUTE_URL_PATTERN.test(rawTarget)
    ) {
      continue;
    }

    try {
      const absolutePath = await join(fileDirectory, rawTarget);
      if (!isPathInsideVault(folderPath, absolutePath)) continue;

      const rootRelativePath = normalizeDisplayPath(
        getRelativeDisplayPath(folderPath, absolutePath)
      );
      if (!isManagedAttachmentPath(rootRelativePath)) continue;

      const targetOffset = match[0].indexOf(rawTarget);
      if (targetOffset < 0) continue;

      refs.push({
        rawTarget,
        rootRelativePath,
        start: matchIndex + targetOffset,
        end: matchIndex + targetOffset + rawTarget.length
      });
    } catch {
      // A malformed link stays untouched. File operations should not turn one
      // broken attachment reference into a failed note move/copy.
    }
  }

  return refs;
}

async function markdownPathToAttachment(
  folderPath: string,
  markdownFilePath: string,
  rootRelativeAttachmentPath: string
): Promise<string> {
  const currentDirectory = normalizeDisplayPath(
    getRelativeDisplayPath(folderPath, await dirname(markdownFilePath))
  );
  const target = normalizeDisplayPath(rootRelativeAttachmentPath);
  const currentSegments = currentDirectory.split("/").filter(Boolean);
  const targetSegments = target.split("/").filter(Boolean);

  let common = 0;
  while (
    common < currentSegments.length &&
    common < targetSegments.length &&
    currentSegments[common] === targetSegments[common]
  ) {
    common += 1;
  }

  return `${"../".repeat(currentSegments.length - common)}${targetSegments
    .slice(common)
    .join("/")}`;
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const index = fileName.lastIndexOf(".");
  if (index <= 0) return { stem: fileName, extension: "" };
  return { stem: fileName.slice(0, index), extension: fileName.slice(index) };
}

async function uniqueAttachmentPath(
  targetDirectory: string,
  fileName: string
): Promise<string> {
  const { stem, extension } = splitFileName(fileName);
  let candidate = await join(targetDirectory, fileName);
  let suffix = 2;

  while (await exists(candidate)) {
    candidate = await join(targetDirectory, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
}

async function rewriteManagedAttachmentRefs(
  markdown: string,
  sourceFilePath: string,
  targetFilePath: string,
  folderPath: string,
  copiedRootPaths: ReadonlyMap<string, string>
): Promise<string> {
  const refs = await parseManagedAttachmentRefs(markdown, sourceFilePath, folderPath);
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (const ref of refs) {
    const nextRootPath = copiedRootPaths.get(ref.rootRelativePath);
    if (!nextRootPath) continue;

    replacements.push({
      start: ref.start,
      end: ref.end,
      value: await markdownPathToAttachment(folderPath, targetFilePath, nextRootPath)
    });
  }

  if (replacements.length === 0) return markdown;

  let result = "";
  let cursor = 0;
  for (const replacement of replacements.sort((left, right) => left.start - right.start)) {
    result += markdown.slice(cursor, replacement.start);
    result += replacement.value;
    cursor = replacement.end;
  }
  result += markdown.slice(cursor);
  return result;
}

export async function copyManagedAttachmentsForMarkdownVariants(
  folderPath: string,
  sourceFilePath: string,
  targetFilePath: string,
  markdownVariants: readonly string[]
): Promise<{
  markdownVariants: string[];
  sourceAttachmentPaths: string[];
}> {
  const sourceRootPaths = new Set<string>();

  for (const markdown of markdownVariants) {
    const refs = await parseManagedAttachmentRefs(markdown, sourceFilePath, folderPath);
    refs.forEach((ref) => sourceRootPaths.add(ref.rootRelativePath));
  }

  if (sourceRootPaths.size === 0) {
    return {
      markdownVariants: [...markdownVariants],
      sourceAttachmentPaths: []
    };
  }

  const targetAttachmentsDirectory = await join(
    await dirname(targetFilePath),
    ATTACHMENTS_FOLDER_NAME
  );
  await mkdir(targetAttachmentsDirectory, { recursive: true });

  const copiedRootPaths = new Map<string, string>();
  const copiedSourcePaths: string[] = [];

  for (const sourceRootPath of sourceRootPaths) {
    try {
      const sourceAbsolutePath = await join(folderPath, sourceRootPath);
      if (!(await exists(sourceAbsolutePath))) continue;

      const fileName = normalizeDisplayPath(sourceRootPath).split("/").pop();
      if (!fileName) continue;

      const targetAbsolutePath = await uniqueAttachmentPath(
        targetAttachmentsDirectory,
        fileName
      );
      await writeFile(targetAbsolutePath, await readFile(sourceAbsolutePath));

      copiedRootPaths.set(
        sourceRootPath,
        normalizeDisplayPath(getRelativeDisplayPath(folderPath, targetAbsolutePath))
      );
      copiedSourcePaths.push(sourceRootPath);
    } catch {
      // A missing/unreadable attachment must not make the Markdown itself
      // impossible to move. Its original link is retained below.
    }
  }

  const rewritten: string[] = [];
  for (const markdown of markdownVariants) {
    rewritten.push(
      await rewriteManagedAttachmentRefs(
        markdown,
        sourceFilePath,
        targetFilePath,
        folderPath,
        copiedRootPaths
      )
    );
  }

  return {
    markdownVariants: rewritten,
    sourceAttachmentPaths: copiedSourcePaths
  };
}

export async function cleanupOrphanedManagedAttachments(
  folderPath: string,
  candidateRootRelativePaths: readonly string[],
  excludedMarkdownFilePath: string | null = null,
  markdownOverrides: Readonly<Record<string, string>> = {}
): Promise<void> {
  if (candidateRootRelativePaths.length === 0) return;

  const candidates = new Set(
    candidateRootRelativePaths.map((path) => normalizeDisplayPath(path))
  );
  const referenced = new Set<string>();
  const excluded = excludedMarkdownFilePath
    ? normalizeDisplayPath(excludedMarkdownFilePath)
    : null;
  const overrides = new Map(
    Object.entries(markdownOverrides).map(([path, markdown]) => [
      normalizeDisplayPath(path),
      markdown
    ])
  );

  const markdownFiles = await getVaultStorage().listMarkdownFiles(folderPath);

  for (const record of markdownFiles) {
    const normalizedFilePath = normalizeDisplayPath(record.filePath);
    if (excluded && normalizedFilePath === excluded) continue;

    try {
      const markdown =
        overrides.get(normalizedFilePath) ?? (await readTextFile(record.filePath));
      const refs = await parseManagedAttachmentRefs(
        markdown,
        record.filePath,
        folderPath
      );

      for (const ref of refs) {
        if (candidates.has(ref.rootRelativePath)) {
          referenced.add(ref.rootRelativePath);
        }
      }
    } catch {
      // Conservatively keep candidates if one Markdown file cannot be read.
      return;
    }
  }

  await Promise.all(
    [...candidates]
      .filter((path) => !referenced.has(path))
      .map(async (path) => {
        try {
          await remove(await join(folderPath, path));
        } catch {
          // Already removed or inaccessible: no further cleanup is required.
        }
      })
  );
}

export async function copyVaultDirectory(
  sourceDirectory: string,
  targetDirectory: string
): Promise<void> {
  await mkdir(targetDirectory, { recursive: true });

  for (const entry of await readDir(sourceDirectory)) {
    if (entry.isSymlink) continue;

    const sourcePath = await join(sourceDirectory, entry.name);
    const targetPath = await join(targetDirectory, entry.name);

    if (entry.isDirectory) {
      await copyVaultDirectory(sourcePath, targetPath);
    } else if (entry.isFile) {
      await writeFile(targetPath, await readFile(sourcePath));
    }
  }
}
