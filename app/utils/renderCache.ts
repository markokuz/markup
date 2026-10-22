"use client";

// Rendered full pages kept between sessions (IndexedDB), so reopening a heavy
// PDF shows it at once. Every call fails soft: no storage just means no cache.

const DB_NAME = "markup-render-cache";
const STORE = "pages";
/** Oldest renders are dropped beyond this (a big sheet is a few MB as PNG). */
const MAX_ENTRIES = 20;

interface CachedRender {
  key: string;
  blob: Blob;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("savedAt", "savedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Content hash of the file, so the same PDF hits the cache under any name. */
export async function hashFile(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

export async function loadCachedRender(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as CachedRender | undefined)?.blob ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function saveCachedRender(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put({ key, blob, savedAt: Date.now() } satisfies CachedRender);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_ENTRIES;
      if (excess <= 0) return;
      store.index("savedAt").openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor || excess-- <= 0) return;
        cursor.delete();
        cursor.continue();
      };
    };
    await done(transaction);
  } catch {
    // Quota or private mode: the page just renders again next time.
  }
}
