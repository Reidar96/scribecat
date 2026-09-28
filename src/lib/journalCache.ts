import type { JournalImage } from "@/lib/journal";

export type CachedJournalEntry = {
  path: string;
  mtimeMs: number;
  markdown: string;
  firstImage: JournalImage | null;
};

type StoredJournalEntry = CachedJournalEntry & { id: string; scope: string };
const DATABASE = "scribecat-journal-index";
const STORE = "entries";
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("scope", "scope");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("Could not open journal cache")); };
  });
  return databasePromise;
}

export async function readJournalCache(scope: string): Promise<CachedJournalEntry[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).index("scope").getAll(scope);
      request.onsuccess = () => resolve(request.result as StoredJournalEntry[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read journal cache"));
    });
}

export async function writeJournalCache(scope: string, entries: CachedJournalEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const entry of entries) store.put({ ...entry, id: `${scope}\u0000${entry.path}`, scope } satisfies StoredJournalEntry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not write journal cache"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Journal cache write aborted"));
    });
}

export async function removeJournalCacheEntries(scope: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const path of paths) store.delete(`${scope}\u0000${path}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not prune journal cache"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Journal cache prune aborted"));
    });
}
