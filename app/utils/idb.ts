"use client";

/** Opens (once per name) an IndexedDB database; a failed open is retried on the next call. */
export function createDbOpener(name: string, upgrade: (db: IDBDatabase) => void) {
  let dbPromise: Promise<IDBDatabase> | null = null;
  return () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  };
}

export function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
