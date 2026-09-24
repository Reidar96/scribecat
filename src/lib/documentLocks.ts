export type DocumentLockMap = Record<string, true>;

export function documentLockKey(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLocaleLowerCase();
}

export function normalizeDocumentLocks(value: unknown): DocumentLockMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: DocumentLockMap = {};

  for (const [path, locked] of Object.entries(value as Record<string, unknown>)) {
    const key = documentLockKey(path);

    if (key && locked === true) {
      result[key] = true;
    }
  }

  return result;
}

export function isDocumentLocked(locks: DocumentLockMap, relativePath: string): boolean {
  return locks[documentLockKey(relativePath)] === true;
}

export function setDocumentLock(
  locks: DocumentLockMap,
  relativePath: string,
  locked: boolean
): DocumentLockMap {
  const key = documentLockKey(relativePath);

  if (!key) {
    return locks;
  }

  if (locked) {
    return locks[key] ? locks : { ...locks, [key]: true };
  }

  if (!locks[key]) {
    return locks;
  }

  const { [key]: _removed, ...rest } = locks;
  return rest;
}

export function renameDocumentLockPath(
  locks: DocumentLockMap,
  fromRelativePath: string,
  toRelativePath: string
): DocumentLockMap {
  const fromKey = documentLockKey(fromRelativePath);
  const toKey = documentLockKey(toRelativePath);

  if (!fromKey || !toKey || fromKey === toKey) {
    return locks;
  }

  const result: DocumentLockMap = {};
  let changed = false;

  for (const [key, locked] of Object.entries(locks)) {
    if (key === fromKey) {
      result[toKey] = locked;
      changed = true;
    } else if (key.startsWith(`${fromKey}/`)) {
      result[`${toKey}${key.slice(fromKey.length)}`] = locked;
      changed = true;
    } else {
      result[key] = locked;
    }
  }

  return changed ? result : locks;
}

export function removeDocumentLockPath(
  locks: DocumentLockMap,
  relativePath: string
): DocumentLockMap {
  const key = documentLockKey(relativePath);

  if (!key) {
    return locks;
  }

  const result: DocumentLockMap = {};
  let changed = false;

  for (const [entryKey, locked] of Object.entries(locks)) {
    if (entryKey === key || entryKey.startsWith(`${key}/`)) {
      changed = true;
    } else {
      result[entryKey] = locked;
    }
  }

  return changed ? result : locks;
}
