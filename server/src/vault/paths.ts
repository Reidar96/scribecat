import { realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Thrown for any path a client sends that is not a plain, vault-relative
 * markdown path. The message is safe to hand straight back in a 400 response.
 */
export class VaultPathError extends Error {}

/**
 * The same rule set as `assertVaultPath` in the desktop app's
 * src/lib/chat/vaultStaging.ts, ported rather than imported: the server is its
 * own package and the desktop code is not (yet) a shared workspace package.
 * Keep the two in step — both are the security boundary between a
 * client-supplied path and the filesystem.
 *
 * The desktop version additionally fences off `images/` for the agent; the
 * file API only ever serves markdown, so `.scribedog/` (the app's own
 * metadata, including the password hash) is the one forbidden root here.
 */
const FORBIDDEN_ROOT_SEGMENTS = [".scribedog"];

// Control characters never belong in a file name and are the classic way to
// smuggle a second path past a naive check.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function normalizeVaultPath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Validates a client-supplied path and returns it normalized (forward
 * slashes, no leading "./" or "/"). Rejects absolute paths, drive letters, UNC
 * prefixes, ".." and "." segments, empty segments, the metadata directory and
 * anything that is not a .md file.
 */
export function assertVaultPath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new VaultPathError("No path given. Pass a vault-relative path such as Notes/Idea.md.");
  }

  const trimmed = rawPath.trim();
  const normalized = normalizeVaultPath(trimmed);

  if (!normalized) {
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

  if (FORBIDDEN_ROOT_SEGMENTS.includes(segments[0].toLowerCase())) {
    throw new VaultPathError(`"${trimmed}" is inside a folder that is off limits (${FORBIDDEN_ROOT_SEGMENTS.join(", ")}).`);
  }

  if (!/\.md$/i.test(normalized)) {
    throw new VaultPathError(`"${trimmed}" is not a Markdown file. Only .md files can be opened or saved.`);
  }

  return normalized;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Turns a validated vault-relative path into an absolute one and makes sure
 * the file it names (or, for a file that does not exist yet, its directory)
 * really lies below the vault root once symlinks are resolved. The desktop app
 * gets that guarantee from Tauri's scoped filesystem capability; the server
 * has to provide it itself, because a symlink planted in the vault would
 * otherwise turn "vault-relative" into "anywhere on disk".
 */
export async function resolveVaultFile(vaultRealPath: string, relativePath: string): Promise<string> {
  const absolutePath = path.join(vaultRealPath, ...relativePath.split("/"));

  if (!isInside(vaultRealPath, absolutePath)) {
    throw new VaultPathError(`"${relativePath}" leaves the vault.`);
  }

  let resolvedTarget: string;

  try {
    resolvedTarget = await realpath(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    // The file itself may not exist yet (first save); its parent directory
    // must, and must be inside the vault. Resolving the parent keeps a symlink
    // in the middle of the path from escaping.
    const resolvedParent = await realpath(path.dirname(absolutePath));

    if (resolvedParent !== vaultRealPath && !isInside(vaultRealPath, resolvedParent)) {
      throw new VaultPathError(`"${relativePath}" leaves the vault.`);
    }

    return path.join(resolvedParent, path.basename(absolutePath));
  }

  if (!isInside(vaultRealPath, resolvedTarget)) {
    throw new VaultPathError(`"${relativePath}" leaves the vault.`);
  }

  return resolvedTarget;
}
