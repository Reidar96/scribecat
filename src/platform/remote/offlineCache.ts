import type { DirectoryEntry, FileInfo } from "@/platform/types";
import type { RemoteFileInfo } from "./serverApi";

type CacheValue =
  | { kind: "text"; content: string; mtimeMs: number | null }
  | { kind: "bytes"; bytes: number[]; mtimeMs: number | null }
  | { kind: "directory"; entries: DirectoryEntry[]; info: RemoteFileInfo | null }
  | { kind: "stat"; info: RemoteFileInfo };
type CacheRecord = CacheValue & { id: string; root: string; path: string };
const DB_NAME = "scribecat-offline-vaults";
const STORE = "files";
let databasePromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("root", "root");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("Could not open offline cache")); };
  });
  return databasePromise;
}

const idFor = (root: string, path: string) => `${root}\u0000${path}`;

export async function getCached(root: string, path: string): Promise<CacheRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(idFor(root, path));
      request.onsuccess = () => resolve((request.result as CacheRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read offline cache"));
    });
}

export async function putCached(root: string, path: string, value: CacheValue): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ ...value, id: idFor(root, path), root, path } satisfies CacheRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not write offline cache"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline cache write aborted"));
    });
}

export async function getCachedMarkdownIndex(root: string): Promise<{ relativePath: string; mtimeMs: number }[] | null> {
  const record = await getCached(root, "\u0000markdown-index");
  return record?.kind === "text" ? JSON.parse(record.content) as { relativePath: string; mtimeMs: number }[] : null;
}

export async function setCachedMarkdownIndex(root: string, entries: { relativePath: string; mtimeMs: number }[]): Promise<void> {
  await putCached(root, "\u0000markdown-index", { kind: "text", content: JSON.stringify(entries), mtimeMs: null });
}

export function cachedFileInfo(info: RemoteFileInfo): FileInfo {
  return {
    isFile: info.isFile, isDirectory: info.isDirectory, isSymlink: info.isSymlink,
    size: info.size, mtime: info.mtimeMs === null ? null : new Date(info.mtimeMs),
    birthtime: info.birthtimeMs === null ? null : new Date(info.birthtimeMs)
  };
}
