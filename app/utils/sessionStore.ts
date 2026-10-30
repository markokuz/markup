"use client";

// Browser backup of each open project plus its linked .mkup file handle, so a
// reload can restore the work and Ctrl+S keeps writing to the same file (Chrome
// can then offer "Allow on every visit" for it). Every call fails soft.

import { createDbOpener, done } from "@/app/utils/idb";

const DB_NAME = "markup-session";
const STORE = "tabs";

export interface SessionEntry {
  /** Tab id, kept when restoring so later saves update this same entry. */
  id: string;
  fileName: string;
  project: Blob;
  handle: FileSystemFileHandle | null;
  savedAt: number;
}

const openDb = createDbOpener(DB_NAME, (db) => {
  db.createObjectStore(STORE, { keyPath: "id" });
});

export async function putSession(entry: SessionEntry): Promise<boolean> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(entry);
    await done(transaction);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await done(transaction);
  } catch {
    // No storage: nothing to clean up.
  }
}

/** Saved sessions, newest first. */
export async function listSessions(): Promise<SessionEntry[]> {
  try {
    const db = await openDb();
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    const entries = await new Promise<SessionEntry[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SessionEntry[]);
      request.onerror = () => reject(request.error);
    });
    return entries.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}
