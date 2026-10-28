"use client";

import { useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { downloadBlob } from "@/app/utils/exportDocument";
import { buildMarkupRows, rowsToCsv, summarizeRows } from "@/app/utils/markupList";

/** Right-hand list of every markup with quantities and totals, exportable to CSV. */
export function MarkupsPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
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
    if (draftName.trim() !== current) {
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
            {rows.map((row) => (
              <li
                key={row.id}
                className={`group relative transition ${
                  selected.has(row.id) ? "bg-accent/10" : "hover:bg-surface-muted"
                }`}
              >
                {renamingId === row.id ? (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <input
                      autoFocus
                      value={draftName}
                      placeholder={row.type}
                      aria-label={`Name for ${row.type}`}
                      onChange={(event) => setDraftName(event.target.value)}
                      onFocus={(event) => event.target.select()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename(row.id, row.name);
                        if (event.key === "Escape") cancelRename();
                      }}
                      onBlur={() => commitRename(row.id, row.name)}
                      className="min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 py-0.5 text-sm text-text-primary outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_TOOL", tool: "select" });
                        dispatch({ type: "SET_SELECTION", ids: [row.id] });
                      }}
                      onDoubleClick={() => startRename(row.id, row.name)}
                      className="flex w-full items-start gap-2 px-3 py-2 pr-9 text-left text-sm"
                    >
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text-secondary">
                          {row.name ? (
                            <>
                              <span className="font-semibold text-text-primary">{row.name}</span>
                              <span> · {row.type}</span>
                            </>
                          ) : (
                            row.type
                          )}
                        </span>
                        <span className="block truncate text-text-primary">{row.display}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Rename"
                      aria-label={`Rename ${row.name || row.type}`}
                      onClick={() => startRename(row.id, row.name)}
                      className="absolute right-2 top-2 rounded p-1 text-text-secondary opacity-0 transition hover:bg-surface hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
                        <path
                          d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {totals.length > 0 && (
        <div className="border-t border-border bg-surface-muted px-3 py-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Totals
          </h3>
          <ul className="space-y-1">
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
