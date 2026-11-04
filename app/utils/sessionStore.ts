"use client";

// Browser backup of each open project plus its linked .mkup file handle, so a
// reload can restore the work and Ctrl+S keeps writing to the same file (Chrome
// can then offer "Allow on every visit" for it). Every call fails soft.

import { createDbOpener, done } from "@/app/utils/idb";

const DB_NAME = "markup-session";
const STORE = "tabs";

/** Oldest backups are dropped beyond this: a reload leaves its tabs' backups behind. */
const MAX_SESSIONS = 20;

export interface SessionEntry {
  /** Tab id, kept when restoring so later saves update this same entry. */
  id: string;
  fileName: string;
  project: Blob;
  /** The document itself. Absent when `project` already holds it (opened .mkups, older backups). */
  bytes?: Blob;
  handle: FileSystemFileHandle | null;
  savedAt: number;
}

const openDb = createDbOpener(DB_NAME, (db) => {
  db.createObjectStore(STORE, { keyPath: "id" });
});

/** Ids of the backups past the newest MAX_SESSIONS. */
export function sessionsToDrop(entries: Pick<SessionEntry, "id" | "savedAt">[]): string[] {
  return [...entries]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(MAX_SESSIONS)
    .map((entry) => entry.id);
}

export async function putSession(entry: SessionEntry): Promise<boolean> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(entry);
    const all = store.getAll();
    all.onsuccess = () => {
      for (const id of sessionsToDrop(all.result as SessionEntry[])) store.delete(id);
    };
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
