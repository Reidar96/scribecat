import { platform } from "@/platform";
import { join } from "@/platform/paths";
import { isRemoteVaultPath } from "@/platform/remote/vaultRoot";
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@/platform/vaultFs";

import { normalizeVaultPath, vaultPathKey } from "@/lib/chat/vaultStaging";
import { VAULT_META_DIR_NAME } from "@/lib/vaultPaths";

/**
 * Hot exit: the unsaved content of every dirty note, kept outside the note
 * itself so closing the app, switching vaults or a crash loses nothing, and
 * the next open of the vault brings the note back dirty with its draft.
 *
 * This is not autosave. The note on disk is only ever written by a save; a
 * draft is a copy of what is in the editor, and it is deleted the moment the
 * document is saved or becomes clean again.
 *
 * Layout mirrors fileVersions.ts and chat/checkpoints.ts (index plus blobs):
 *   .scribecat/drafts/index.json   -> { version: 1, entries: { "<vault-relative path>": entry } }
 *   .scribecat/drafts/<blobId>.md  -> the draft content
 *
 * Keyed by the vault-relative path so a vault that moves to another machine
 * keeps its drafts. One blob per file, rewritten in place: a draft is written
 * after every pause in typing, and vaults often sit in Dropbox, Syncthing or
 * Git, where a fresh file per write would be constant churn.
 *
 * A server vault is shared between people and devices, a draft belongs to one
 * person at one keyboard. For a remote root (the desktop opening a server
 * vault) and in the browser edition the same index therefore lives in
 * `localStorage`, under the vault's root, and nothing is written to the
 * server. The store above sees one API either way.
 */

export type DraftEntry = {
  blobId: string;
  /**
   * mtime of the file when the baseline the draft was made against was read;
   * null when the file did not exist yet (an unwritten folder note). What
   * the save-time conflict check compares against.
   */
  baseMtimeMs: number | null;
  updatedAt: number;
};

export type DraftIndex = {
  version: 1;
  /** Vault-relative path (forward slashes) -> entry. */
  entries: Record<string, DraftEntry>;
};

export type LoadedDraft = {
  relativePath: string;
  content: string;
  baseMtimeMs: number | null;
  updatedAt: number;
};

const DRAFTS_DIR_NAME = "drafts";
const INDEX_FILE_NAME = "index.json";
const LOCAL_STORAGE_PREFIX = "scribecat-drafts:";

/** Where the index and the blobs live; one implementation per kind of vault. */
type DraftBackend = {
  readIndex(): Promise<DraftIndex>;
  writeIndex(index: DraftIndex): Promise<void>;
  readBlob(blobId: string): Promise<string>;
  writeBlob(blobId: string, content: string): Promise<void>;
  removeBlob(blobId: string): Promise<void>;
  /** Every blob that exists, referenced or not; for pruning orphans. */
  listBlobIds(): Promise<string[]>;
  /** Drops the index and every blob. */
  clear(): Promise<void>;
};

function emptyIndex(): DraftIndex {
  return { version: 1, entries: {} };
}

function normalizeEntry(raw: unknown): DraftEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as { blobId?: unknown; baseMtimeMs?: unknown; updatedAt?: unknown };

  if (typeof candidate.blobId !== "string" || !candidate.blobId) {
    return null;
  }

  return {
    blobId: candidate.blobId,
    baseMtimeMs: typeof candidate.baseMtimeMs === "number" ? candidate.baseMtimeMs : null,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0
  };
}

export function normalizeDraftIndex(parsed: unknown): DraftIndex {
  if (typeof parsed !== "object" || parsed === null) {
    return emptyIndex();
  }

  const rawEntries = (parsed as { entries?: unknown }).entries;

  if (typeof rawEntries !== "object" || rawEntries === null || Array.isArray(rawEntries)) {
    return emptyIndex();
  }

  const entries: Record<string, DraftEntry> = {};

  for (const [rawPath, rawEntry] of Object.entries(rawEntries as Record<string, unknown>)) {
    const entry = normalizeEntry(rawEntry);
    const path = normalizeVaultPath(rawPath);

    if (entry && path) {
      entries[path] = entry;
    }
  }

  return { version: 1, entries };
}

/** Windows paths are case-insensitive, so index lookups have to be too. */
function findIndexKey(index: DraftIndex, relativePath: string): string | null {
  const wanted = vaultPathKey(relativePath);

  return Object.keys(index.entries).find((key) => vaultPathKey(key) === wanted) ?? null;
}

function createBlobId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createFsBackend(folderPath: string): DraftBackend {
  const dirPath = () => join(folderPath, VAULT_META_DIR_NAME, DRAFTS_DIR_NAME);
  const blobPath = async (blobId: string) => join(await dirPath(), `${blobId}.md`);

  return {
    async readIndex() {
      try {
        const filePath = await join(await dirPath(), INDEX_FILE_NAME);

        if (!(await exists(filePath))) {
          return emptyIndex();
        }

        return normalizeDraftIndex(JSON.parse(await readTextFile(filePath)));
      } catch {
        return emptyIndex();
      }
    },
    async writeIndex(index) {
      const dir = await dirPath();
      await mkdir(dir, { recursive: true });
      await writeTextFile(await join(dir, INDEX_FILE_NAME), JSON.stringify(index, null, 2));
    },
    async readBlob(blobId) {
      return readTextFile(await blobPath(blobId));
    },
    async writeBlob(blobId, content) {
      await mkdir(await dirPath(), { recursive: true });
      await writeTextFile(await blobPath(blobId), content);
    },
    async removeBlob(blobId) {
      await remove(await blobPath(blobId)).catch(() => undefined);
    },
    async listBlobIds() {
      try {
        const dir = await dirPath();

        if (!(await exists(dir))) {
          return [];
        }

        return (await readDir(dir))
          .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
          .map((entry) => entry.name.slice(0, -".md".length));
      } catch {
        return [];
      }
    },
    async clear() {
      try {
        const dir = await dirPath();

        if (await exists(dir)) {
          await remove(dir, { recursive: true });
        }
      } catch {
        // Nothing to clear, or nothing that can be: either way there is no draft left to load.
      }
    }
  };
}

function createLocalStorageBackend(folderPath: string): DraftBackend {
  const prefix = `${LOCAL_STORAGE_PREFIX}${normalizeVaultPath(folderPath).toLowerCase()}:`;
  const indexKey = `${prefix}index`;
  const blobKey = (blobId: string) => `${prefix}blob:${blobId}`;

  const storage = (): Storage | null => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  };

  return {
    async readIndex() {
      try {
        const raw = storage()?.getItem(indexKey);
        return raw ? normalizeDraftIndex(JSON.parse(raw)) : emptyIndex();
      } catch {
        return emptyIndex();
      }
    },
    async writeIndex(index) {
      storage()?.setItem(indexKey, JSON.stringify(index));
    },
    async readBlob(blobId) {
      const raw = storage()?.getItem(blobKey(blobId));

      if (raw === null || raw === undefined) {
        throw new Error(`Draft blob ${blobId} is missing`);
      }

      return raw;
    },
    async writeBlob(blobId, content) {
      storage()?.setItem(blobKey(blobId), content);
    },
    async removeBlob(blobId) {
      storage()?.removeItem(blobKey(blobId));
    },
    async listBlobIds() {
      const store = storage();

      if (!store) {
        return [];
      }

      const ids: string[] = [];
      const blobPrefix = blobKey("");

      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);

        if (key && key.startsWith(blobPrefix)) {
          ids.push(key.slice(blobPrefix.length));
        }
      }

      return ids;
    },
    async clear() {
      const store = storage();

      if (!store) {
        return;
      }

      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index);

        if (key && key.startsWith(prefix)) {
          store.removeItem(key);
        }
      }
    }
  };
}

/**
 * The browser edition's vault root is the virtual `/vault` (not a remote
 * root), but the vault is on the server just the same.
 */
function isSharedVault(folderPath: string): boolean {
  return isRemoteVaultPath(folderPath) || !platform.features.localFolders;
}

function backendFor(folderPath: string): DraftBackend {
  return isSharedVault(folderPath) ? createLocalStorageBackend(folderPath) : createFsBackend(folderPath);
}

/**
 * index.json is read-modify-write; a debounced write and a move landing at
 * once would otherwise interleave and drop one. Same single chain as
 * fileVersions.ts. Every exported mutation enqueues *synchronously* on call,
 * so callers that issue "flush, then move, then write" in a row get exactly
 * that order without awaiting each step.
 */
let indexWriteQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = indexWriteQueue.then(task, task);
  indexWriteQueue = result.catch(() => undefined);
  return result;
}

export async function readDraftIndex(folderPath: string): Promise<DraftIndex> {
  return enqueue(() => backendFor(folderPath).readIndex());
}

/** Writes (or overwrites) the draft of one note. Last call wins. */
export async function writeDraft(
  folderPath: string,
  relativePath: string,
  content: string,
  baseMtimeMs: number | null
): Promise<void> {
  const normalizedPath = normalizeVaultPath(relativePath);

  if (!normalizedPath) {
    return;
  }

  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const existingKey = findIndexKey(index, normalizedPath);
    const existing = existingKey ? index.entries[existingKey] : null;
    const blobId = existing?.blobId ?? createBlobId();

    await backend.writeBlob(blobId, content);

    if (existingKey && existingKey !== normalizedPath) {
      delete index.entries[existingKey];
    }

    index.entries[normalizedPath] = { blobId, baseMtimeMs, updatedAt: Date.now() };
    await backend.writeIndex(index);
  });
}

export async function deleteDraft(folderPath: string, relativePath: string): Promise<void> {
  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const key = findIndexKey(index, relativePath);

    if (!key) {
      return;
    }

    const { blobId } = index.entries[key];
    delete index.entries[key];
    await backend.writeIndex(index);
    await backend.removeBlob(blobId);
  });
}

/** A note was renamed or moved; its draft follows. */
export async function moveDraft(
  folderPath: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<void> {
  const normalizedNewPath = normalizeVaultPath(newRelativePath);

  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const oldKey = findIndexKey(index, oldRelativePath);

    if (!oldKey || !normalizedNewPath) {
      return;
    }

    const entry = index.entries[oldKey];
    delete index.entries[oldKey];

    // A draft already sitting at the target belongs to a file that no longer
    // exists under that name; the moved one is the live document.
    const targetKey = findIndexKey(index, normalizedNewPath);

    if (targetKey) {
      const replaced = index.entries[targetKey];
      delete index.entries[targetKey];
      await backend.removeBlob(replaced.blobId);
    }

    index.entries[normalizedNewPath] = entry;
    await backend.writeIndex(index);
  });
}

/** A folder was renamed or moved; every draft under it follows. */
export async function moveFolderDrafts(
  folderPath: string,
  oldFolderRelativePath: string,
  newFolderRelativePath: string
): Promise<void> {
  const oldPrefix = normalizeVaultPath(oldFolderRelativePath);
  const newPrefix = normalizeVaultPath(newFolderRelativePath);

  if (!oldPrefix) {
    return;
  }

  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const oldPrefixKey = `${vaultPathKey(oldPrefix)}/`;
    const nextEntries: Record<string, DraftEntry> = {};
    let changed = false;

    for (const [path, entry] of Object.entries(index.entries)) {
      if (vaultPathKey(path).startsWith(oldPrefixKey)) {
        const remainder = path.slice(oldPrefix.length + 1);
        nextEntries[newPrefix ? `${newPrefix}/${remainder}` : remainder] = entry;
        changed = true;
      } else {
        nextEntries[path] = entry;
      }
    }

    if (changed) {
      await backend.writeIndex({ version: 1, entries: nextEntries });
    }
  });
}

/** A folder was deleted; its drafts go with it. */
export async function deleteFolderDrafts(
  folderPath: string,
  folderRelativePath: string
): Promise<void> {
  const prefix = normalizeVaultPath(folderRelativePath);

  if (!prefix) {
    return;
  }

  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const prefixKey = `${vaultPathKey(prefix)}/`;
    const removed: DraftEntry[] = [];
    const nextEntries: Record<string, DraftEntry> = {};

    for (const [path, entry] of Object.entries(index.entries)) {
      if (vaultPathKey(path).startsWith(prefixKey)) {
        removed.push(entry);
      } else {
        nextEntries[path] = entry;
      }
    }

    if (removed.length === 0) {
      return;
    }

    await backend.writeIndex({ version: 1, entries: nextEntries });
    await Promise.all(removed.map((entry) => backend.removeBlob(entry.blobId)));
  });
}

/**
 * Every draft of the vault with its content, for restoring them into the
 * document map when the vault opens. Entries whose blob cannot be read are
 * dropped from the index, blobs the index does not mention are deleted;
 * both are leftovers of an interrupted write, and both would otherwise
 * accumulate silently.
 */
export async function loadDrafts(folderPath: string): Promise<LoadedDraft[]> {
  return enqueue(async () => {
    const backend = backendFor(folderPath);
    const index = await backend.readIndex();
    const loaded: LoadedDraft[] = [];
    const nextEntries: Record<string, DraftEntry> = {};
    let indexChanged = false;

    for (const [relativePath, entry] of Object.entries(index.entries)) {
      try {
        const content = await backend.readBlob(entry.blobId);
        loaded.push({ relativePath, content, baseMtimeMs: entry.baseMtimeMs, updatedAt: entry.updatedAt });
        nextEntries[relativePath] = entry;
      } catch {
        indexChanged = true;
      }
    }

    const referenced = new Set(Object.values(nextEntries).map((entry) => entry.blobId));
    const orphaned = (await backend.listBlobIds()).filter((blobId) => !referenced.has(blobId));

    if (indexChanged) {
      await backend.writeIndex({ version: 1, entries: nextEntries });
    }

    await Promise.all(orphaned.map((blobId) => backend.removeBlob(blobId)));

    return loaded;
  });
}

/** Removes every draft of the vault, index and blobs. */
export async function clearDrafts(folderPath: string): Promise<void> {
  return enqueue(() => backendFor(folderPath).clear());
}
