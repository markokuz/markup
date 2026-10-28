"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { restoreSession } from "@/app/utils/openFile";
import { deleteSession, listSessions, type SessionEntry } from "@/app/utils/sessionStore";

function timeAgo(savedAt: number): string {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(savedAt).toLocaleDateString();
}

/** Start-screen list of browser backups from earlier visits (saved on every Ctrl+S). */
export function RestoreSessions() {
  const { tabs } = useAppState();
  const dispatch = useAppDispatch();
  const [entries, setEntries] = useState<SessionEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listSessions().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openIds = new Set(tabs.map((tab) => tab.id));
  const visible = entries.filter((entry) => !openIds.has(entry.id));
  if (visible.length === 0) return null;

  return (
    <div className="mt-6 w-full max-w-sm rounded-2xl border border-border bg-surface p-4 text-left shadow-sm">
      <h2 className="text-sm font-semibold text-text-primary">Restore previous work</h2>
      <p className="mt-0.5 text-xs text-text-muted">Saved in this browser when you pressed Ctrl+S.</p>
      <ul className="mt-3 space-y-1">
        {visible.map((entry) => (
          <li key={entry.id} className="group flex items-center gap-2">
            <button
              type="button"
              onClick={() => void restoreSession(entry, dispatch)}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface-muted"
            >
              <span className="truncate text-text-primary">{entry.fileName}</span>
              <span className="shrink-0 text-xs text-text-muted">{timeAgo(entry.savedAt)}</span>
            </button>
            <button
              type="button"
              title="Remove this backup"
              aria-label={`Remove backup of ${entry.fileName}`}
              onClick={() => {
                void deleteSession(entry.id);
                setEntries((list) => list.filter((e) => e.id !== entry.id));
              }}
              className="rounded p-1 text-text-muted opacity-0 transition hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
