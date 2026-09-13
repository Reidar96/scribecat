import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Thrown for any path a client sends that is not a plain, vault-relative
 * path. The message is safe to hand straight back in a 400 response.
 */
export class VaultPathError extends Error {}

/**
 * The same rule set as `assertVaultPath` in the desktop app's
 * src/lib/chat/vaultStaging.ts, ported rather than imported: the server is its
 * own package and the desktop code is not (yet) a shared workspace package.
 * Keep the two in step: both are the security boundary between a
 * client-supplied path and the filesystem.
 *
 * The file API serves the whole vault the way the desktop app's filesystem
 * layer sees it: notes, the images folder and the `.scribedog/` sidecars
 * (versions, manual order, checkpoints, chat sessions), which the frontend
 * reads and writes itself. The one part of `.scribedog/` that belongs to the
 * server alone is `.scribedog/server/` (password hash, session secret); no
 * client-supplied path may point into it.
 */
const META_DIR_SEGMENT = ".scribedog";
const SERVER_DIR_SEGMENT = "server";

// Control characters never belong in a file name and are the classic way to
// smuggle a second path past a naive check.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function normalizeVaultPath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export type VaultPathOptions = {
  /** Accept "" (or "/" or ".") for the vault root itself; off by default. */
  allowRoot?: boolean;
};

/**
 * Validates a client-supplied path and returns it normalized (forward
 * slashes, no leading "./" or "/", no trailing "/"; "" for the root when
 * allowed). Rejects absolute paths, drive letters, UNC prefixes, ".." and "."
 * segments, empty segments, control characters and the server's own metadata
 * directory.
 */
export function assertVaultPath(rawPath: unknown, options: VaultPathOptions = {}): string {
  if (typeof rawPath !== "string") {
    throw new VaultPathError("No path given. Pass a vault-relative path such as Notes/Idea.md.");
  }

  const trimmed = rawPath.trim();
  const normalized = normalizeVaultPath(trimmed);

  if (!normalized || normalized === ".") {
    if (options.allowRoot) {
      return "";
    }

    throw new VaultPathError("No path given. Pass a vault-relative path such as Notes/Idea.md.");
  }

  if (/^[a-z]:/i.test(normalized) || trimmed.startsWith("\\\\") || trimmed.startsWith("/")) {
    throw new VaultPathError(`"${trimmed}" is an absolute path. Only paths relative to the vault root are allowed.`);
  }

  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new VaultPathError(`"${trimmed}" contains characters that are not allowed in a path.`);
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new VaultPathError(`"${trimmed}" leaves the vault. Paths must not contain ".." segments.`);
  }

  if (segments.some((segment) => !segment)) {
    throw new VaultPathError(`"${trimmed}" is not a usable path.`);
  }

  if (segments[0].toLowerCase() === META_DIR_SEGMENT && segments[1]?.toLowerCase() === SERVER_DIR_SEGMENT) {
    throw new VaultPathError(`"${trimmed}" is inside a folder that is off limits (${META_DIR_SEGMENT}/${SERVER_DIR_SEGMENT}).`);
  }

  return normalized;
}

/** The markdown-only variant, for routes that deal with notes and nothing else. */
export function assertMarkdownPath(rawPath: unknown): string {
  const normalized = assertVaultPath(rawPath);

  if (!/\.md$/i.test(normalized)) {
    throw new VaultPathError(`"${normalized}" is not a Markdown file. Only .md files can be opened or saved.`);
  }

  return normalized;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isRootOrInside(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || isInside(rootPath, candidatePath);
}

/**
 * Turns a validated vault-relative path into an absolute one and makes sure
 * the entry it names, or, for an entry that does not exist yet, its nearest
 * existing ancestor, really lies below the vault root once symlinks are
 * resolved. The desktop app gets that guarantee from Tauri's scoped
 * filesystem capability; the server has to provide it itself, because a
 * symlink planted in the vault would otherwise turn "vault-relative" into
 * "anywhere on disk".
 *
 * Returns the absolute path *without* resolving the entry's own symlink, so
 * an operation on a link (rename, remove) acts on the link, not its target.
 */
export async function resolveVaultEntry(vaultRealPath: string, relativePath: string): Promise<string> {
  if (relativePath === "") {
    return vaultRealPath;
  }

  const absolutePath = path.join(vaultRealPath, ...relativePath.split("/"));

  if (!isInside(vaultRealPath, absolutePath)) {
    throw new VaultPathError(`"${relativePath}" leaves the vault.`);
  }

  // Walk up to the nearest ancestor that exists; a symlink anywhere on the
  // way (the entry itself included) must resolve back into the vault.
  let probe = absolutePath;

  for (;;) {
    let exists = true;

    try {
      await lstat(probe);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      exists = false;
    }

    if (exists) {
      // lstat sees a dangling symlink where realpath does not; writing
      // through one would create the file wherever the link points.
      const resolved = await realpath(probe).catch(() => null);

      if (resolved === null || !isRootOrInside(vaultRealPath, resolved)) {
        throw new VaultPathError(`"${relativePath}" leaves the vault.`);
      }

      return absolutePath;
    }

    const parent = path.dirname(probe);

    if (parent === probe) {
      throw new VaultPathError(`"${relativePath}" leaves the vault.`);
    }

    probe = parent;
  }
}

/** Kept under its stage-1 name for the note routes; same guarantees as resolveVaultEntry. */
export const resolveVaultFile = resolveVaultEntry;
