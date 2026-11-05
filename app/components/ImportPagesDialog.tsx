"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { DocumentTab } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { formatPageRanges, parsePageRanges, type PageRangeResult } from "@/app/utils/pageRanges";
import { pagesWithMarkups } from "@/app/utils/pages";
import { getActiveTabFromAppState } from "@/app/utils/tabState";

/** Asks which pages of a multi-page PDF to show: on import, and again from the sheet menu. */
export function ImportPagesDialog() {
  const state = useAppState();
  const tab = getActiveTabFromAppState(state);
  if (!tab || tab.fileType !== "pdf" || tab.pageCount <= 1) return null;
  if (tab.sheets !== null && !tab.pagesDialogOpen) return null;
  return <ImportPagesForm key={tab.id} tab={tab} />;
}

function ImportPagesForm({ tab }: { tab: DocumentTab }) {
  const dispatch = useAppDispatch();
  const { pageCount, sheets } = tab;
  const importing = sheets === null;
  const everyPage = importing || sheets.length === pageCount;
  const [mode, setMode] = useState<"all" | "some">(everyPage ? "all" : "some");
  const [text, setText] = useState(everyPage ? "" : formatPageRanges(sheets));
  const inputRef = useRef<HTMLInputElement>(null);

  const result: PageRangeResult =
    mode === "all"
      ? { pages: Array.from({ length: pageCount }, (_, page) => page) }
      : parsePageRanges(text, pageCount);
  const typedNothing = mode === "some" && !text.trim();
  // These stay whatever is typed: SET_SHEETS never hides a sheet with markups on it.
  const kept = [...pagesWithMarkups([tab.measurements, tab.rectangles, tab.notes, tab.shapes])]
    .filter((page) => page < pageCount && !result.pages?.includes(page))
    .sort((a, b) => a - b);

  const cancel = () => {
    if (importing) dispatch({ type: "CLOSE_TAB", tabId: tab.id });
    else dispatch({ type: "SET_PAGES_DIALOG", open: false });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!result.pages) return;
    dispatch({ type: "SET_SHEETS", tabId: tab.id, sheets: result.pages, initial: importing });
  };

  // Listens on the window: focus can be anywhere when the question appears.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (importing) dispatch({ type: "CLOSE_TAB", tabId: tab.id });
      else dispatch({ type: "SET_PAGES_DIALOG", open: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, importing, tab.id]);

  useEffect(() => {
    if (mode === "some") inputRef.current?.focus();
  }, [mode]);

  const selectedCount = result.pages ? result.pages.length + kept.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-pages-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id="import-pages-title" className="text-lg font-semibold text-text-primary">
          {importing ? "Which pages do you want to import?" : "Choose pages"}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {tab.fileName ?? "This PDF"} has {pageCount} pages.
          {!importing && " Pages you hide stay in the file."}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="import-pages"
              checked={mode === "all"}
              onChange={() => setMode("all")}
            />
            All pages
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="import-pages"
              checked={mode === "some"}
              onChange={() => setMode("some")}
            />
            Pages:
            <input
              ref={inputRef}
              type="text"
              value={text}
              aria-label="Pages to import"
              aria-invalid={mode === "some" && !typedNothing && !!result.error}
              aria-describedby="import-pages-status"
              placeholder="1-10 or 1,2,3 5-8"
              onFocus={() => setMode("some")}
              onChange={(event) => {
                setMode("some");
                setText(event.target.value);
              }}
              className="input-field min-w-0 flex-1 px-3 py-1.5"
            />
          </label>

          <p
            id="import-pages-status"
            role="status"
            className={`min-h-5 text-sm ${
              result.error && !typedNothing ? "text-red-600 dark:text-red-400" : "text-text-secondary"
            }`}
          >
            {typedNothing
              ? "Separate pages with commas or spaces, and use a dash for a range."
              : (result.error ?? `${selectedCount} page${selectedCount === 1 ? "" : "s"} selected`)}
            {!result.error && kept.length > 0 && ` (${formatPageRanges(kept)} kept: they have markups)`}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={cancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={!result.pages} className="btn-primary disabled:opacity-40">
              {importing ? "Import" : "Apply"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
