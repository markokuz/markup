"use client";

import { useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { downloadBlob } from "@/app/utils/exportDocument";
import { buildMarkupRows, rowsToCsv, summarizeRows, type MarkupRow } from "@/app/utils/markupList";

/** Group rename targets share the rename box with rows; their ids carry this prefix. */
const GROUP_KEY = "group:";

type ListEntry =
  | { kind: "row"; row: MarkupRow }
  | { kind: "group"; groupId: string; name: string; rows: MarkupRow[] };

/** Rows in list order, with each group's members gathered where its first member sits. */
function groupEntries(rows: MarkupRow[]): ListEntry[] {
  const entries: ListEntry[] = [];
  const groups = new Map<string, Extract<ListEntry, { kind: "group" }>>();
  for (const row of rows) {
    if (!row.groupId) {
      entries.push({ kind: "row", row });
      continue;
    }
    let group = groups.get(row.groupId);
    if (!group) {
      group = { kind: "group", groupId: row.groupId, name: row.groupName || "Group", rows: [] };
      groups.set(row.groupId, group);
      entries.push(group);
    }
    group.rows.push(row);
  }
  return entries;
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rename, lock and delete buttons, shown on hover at the right of a row. */
function RowActions({
  label,
  renameTitle,
  deleteTitle,
  locked,
  onRename,
  onToggleLock,
  onDelete,
}: {
  label: string;
  renameTitle: string;
  deleteTitle: string;
  locked: boolean;
  onRename: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const button =
    "rounded p-1 text-text-secondary transition hover:bg-surface hover:text-text-primary";
  return (
    <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" title={renameTitle} aria-label={`Rename ${label}`} onClick={onRename} className={button}>
        <PencilIcon />
      </button>
      <button
        type="button"
        title={locked ? "Unlock (allow moving and resizing)" : "Lock in place"}
        aria-label={`${locked ? "Unlock" : "Lock"} ${label}`}
        aria-pressed={locked}
        onClick={onToggleLock}
        className={`${button} ${locked ? "text-accent" : ""}`}
      >
        <LockIcon open={!locked} size={14} />
      </button>
      <button
        type="button"
        title={deleteTitle}
        aria-label={`Delete ${label}`}
        onClick={onDelete}
        className={`${button} hover:text-red-600`}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/** Padlock; `open` swings the shackle up for the "unlocked" state. */
function LockIcon({ open = false, size = 11 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="9" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d={open ? "M7 9V6.5a3 3 0 015.6-1.5" : "M7 9V6.5a3 3 0 016 0V9"} stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Right-hand list of every markup with quantities and totals, exportable to CSV. */
export function MarkupsPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(true);
  const [totalsOpen, setTotalsOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Enter then blur both commit; the ref lets only the first one apply.
  const renamingRef = useRef<string | null>(null);

  if (!state.fileBytes) return null;

  const startRename = (id: string, current: string) => {
    setDraftName(current);
    setRenamingId(id);
    renamingRef.current = id;
  };

  const cancelRename = () => {
    renamingRef.current = null;
    setRenamingId(null);
  };

  const commitRename = (id: string, current: string) => {
    if (renamingRef.current !== id) return;
    cancelRename();
    if (draftName.trim() === current) return;
    if (id.startsWith(GROUP_KEY)) {
      dispatch({ type: "RENAME_GROUP", groupId: id.slice(GROUP_KEY.length), name: draftName });
    } else {
      dispatch({ type: "SET_ANNOTATION_LABEL", id, label: draftName });
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        title="Show markups list"
        onClick={() => setOpen(true)}
        className="flex w-8 shrink-0 flex-col items-center gap-2 border-l border-border bg-surface py-3 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden>‹</span>
        <span style={{ writingMode: "vertical-rl" }}>Markups</span>
      </button>
    );
  }

  const rows = buildMarkupRows(state);
  const totals = summarizeRows(rows, state.displayUnit);
  const selected = new Set(state.selectedIds);

  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  /** Selecting any member selects the whole group (the reducer expands it). */
  const select = (id: string) => {
    dispatch({ type: "SET_TOOL", tool: "select" });
    dispatch({ type: "SET_SELECTION", ids: [id] });
  };

  const renameInput = (id: string, current: string, placeholder: string, indent: boolean) => (
    <div className={`flex items-center gap-2 py-2 pr-3 ${indent ? "pl-7" : "pl-3"}`}>
      <input
        autoFocus
        value={draftName}
        placeholder={placeholder}
        aria-label={`Name for ${placeholder}`}
        onChange={(event) => setDraftName(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitRename(id, current);
          if (event.key === "Escape") cancelRename();
        }}
        onBlur={() => commitRename(id, current)}
        className="min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 py-0.5 text-sm text-text-primary outline-none"
      />
    </div>
  );

  const renderRow = (row: MarkupRow, indent: boolean) => (
    <li
      key={row.id}
      className={`group relative transition ${
        selected.has(row.id) ? "bg-accent/10" : "hover:bg-surface-muted"
      }`}
    >
      {renamingId === row.id ? (
        renameInput(row.id, row.name, row.type, indent)
      ) : (
        <>
          <button
            type="button"
            onClick={() => select(row.id)}
            onDoubleClick={() => startRename(row.id, row.name)}
            className={`flex w-full items-start gap-2 py-2 pr-24 text-left text-sm ${indent ? "pl-7" : "pl-3"}`}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-xs font-medium text-text-secondary">
                {row.name ? (
                  <>
                    <span className="font-semibold text-text-primary">{row.name}</span>
                    <span> · {row.type}</span>
                  </>
                ) : (
                  row.type
                )}
                {row.locked && (
                  <span title="Locked" className="text-text-muted">
                    <LockIcon />
                  </span>
                )}
              </span>
              <span className="block truncate text-text-primary">{row.display}</span>
            </span>
          </button>
          <RowActions
            label={row.name || row.type}
            renameTitle="Rename"
            deleteTitle="Delete"
            locked={!!row.locked}
            onRename={() => startRename(row.id, row.name)}
            onToggleLock={() => dispatch({ type: "SET_LOCKED", ids: [row.id], locked: !row.locked })}
            onDelete={() => dispatch({ type: "DELETE_ANNOTATIONS", ids: [row.id] })}
          />
        </>
      )}
    </li>
  );

  const renderGroup = (entry: Extract<ListEntry, { kind: "group" }>) => {
    const key = `${GROUP_KEY}${entry.groupId}`;
    const collapsed = collapsedGroups.has(entry.groupId);
    const isSelected = entry.rows.every((row) => selected.has(row.id));
    const allLocked = entry.rows.every((row) => row.locked);
    return (
      <li key={key}>
        <div
          className={`group relative transition ${isSelected ? "bg-accent/10" : "hover:bg-surface-muted"}`}
        >
          {renamingId === key ? (
            renameInput(key, entry.name, "Group", false)
          ) : (
            <>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expand ${entry.name}` : `Collapse ${entry.name}`}
                  onClick={() => toggleGroup(entry.groupId)}
                  className="py-2 pl-3 pr-1 text-text-secondary hover:text-text-primary"
                >
                  <span aria-hidden className={`inline-block transition ${collapsed ? "" : "rotate-90"}`}>
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => select(entry.rows[0].id)}
                  onDoubleClick={() => startRename(key, entry.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-24 text-left text-sm"
                >
                  <span className="truncate font-semibold text-text-primary">{entry.name}</span>
                  <span className="shrink-0 text-xs text-text-muted">{entry.rows.length} items</span>
                </button>
              </div>
              <RowActions
                label={entry.name}
                renameTitle="Rename group"
                deleteTitle="Delete the group and everything in it"
                locked={allLocked}
                onRename={() => startRename(key, entry.name)}
                onToggleLock={() =>
                  dispatch({
                    type: "SET_LOCKED",
                    ids: entry.rows.map((row) => row.id),
                    locked: !allLocked,
                  })
                }
                onDelete={() =>
                  dispatch({ type: "DELETE_ANNOTATIONS", ids: entry.rows.map((row) => row.id) })
                }
              />
            </>
          )}
        </div>
        {!collapsed && (
          <ul className="divide-y divide-border border-t border-border">
            {entry.rows.map((row) => renderRow(row, true))}
          </ul>
        )}
      </li>
    );
  };

  const exportCsv = () => {
    const base = (state.fileName ?? "markups").replace(/\.[^.]+$/, "");
    // BOM so Excel opens the UTF-8 (×, ², ·) correctly.
    const blob = new Blob(["﻿", rowsToCsv(rows, state.displayUnit)], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(blob, `${base}-markups.csv`);
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-text-primary">
          Markups <span className="font-normal text-text-secondary">({rows.length})</span>
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            title="Download the list as a CSV file for Excel"
          >
            Export CSV
          </button>
          <button
            type="button"
            title="Hide markups list"
            onClick={() => setOpen(false)}
            className="rounded px-1.5 py-1 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          >
            ›
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">
            Markups you draw show up here with their measurements.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {groupEntries(rows).map((entry) =>
              entry.kind === "group" ? renderGroup(entry) : renderRow(entry.row, false),
            )}
          </ul>
        )}
      </div>

      {totals.length > 0 && (
        <div className="border-t border-border bg-surface-muted px-3 py-2">
          <button
            type="button"
            aria-expanded={totalsOpen}
            onClick={() => setTotalsOpen((v) => !v)}
            className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
          >
            <span aria-hidden className={`inline-block transition ${totalsOpen ? "rotate-90" : ""}`}>
              ›
            </span>
            Totals
            {!totalsOpen && (
              <span className="ml-auto font-normal normal-case text-text-muted">{totals.length}</span>
            )}
          </button>
          <ul className={`mt-1 max-h-48 space-y-1 overflow-y-auto ${totalsOpen ? "" : "hidden"}`}>
            {totals.map((t) => (
              <li key={`${t.type}-${t.color}`} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-text-secondary">{t.type}</span>
                <span className="ml-auto font-medium text-text-primary">{t.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
