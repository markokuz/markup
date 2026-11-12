"use client";

import { useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { isProjectHandle, saveTabWithFeedback } from "@/app/utils/projectSave";

export function UnsavedChangesDialog() {
  const { tabs, pendingCloseTabId, displayUnit } = useAppState();
  const dispatch = useAppDispatch();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [saving, setSaving] = useState(false);

  const tab = tabs.find((t) => t.id === pendingCloseTabId);
  if (!tab) return null;

  const label = tab.fileName ?? "Untitled";

  const applyDontAskAgain = () => {
    if (dontAskAgain) {
      dispatch({ type: "SET_CONFIRM_CLOSE_UNSAVED", enabled: false });
    }
    setDontAskAgain(false);
  };

  const handleCancel = () => {
    setDontAskAgain(false);
    dispatch({ type: "CANCEL_CLOSE_TAB" });
  };

  const handleDiscard = () => {
    applyDontAskAgain();
    dispatch({ type: "CLOSE_TAB", tabId: tab.id });
  };

  const handleSaveAndClose = async () => {
    if (!tab.fileBytes || !tab.fileName || !tab.fileType) return;
    setSaving(true);
    try {
      // Only close once the file itself was written; a browser-only backup isn't enough.
      // A plain save flattens an image to PNG; the tab's editable markups would be gone for good.
      const mode = tab.fileType === "image" && !isProjectHandle(tab.projectHandle) ? "save-project-as" : "save";
      const saved = await saveTabWithFeedback(tab, displayUnit, mode, dispatch);
      if (!saved) return;
      applyDontAskAgain();
      dispatch({ type: "CLOSE_TAB", tabId: tab.id });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-description"
        className="w-full max-w-[400px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex gap-3 px-5 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5 14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8 6.5v3M8 11.25v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="unsaved-title" className="break-words text-[15px] font-semibold leading-6 text-text-primary">
              Save changes to &ldquo;{label}&rdquo;?
            </h2>
            <p id="unsaved-description" className="mt-0.5 text-sm text-text-secondary">
              Your changes will be lost if you close without saving.
            </p>
          </div>
        </div>

        <div className="border-t border-border bg-surface-muted px-5 py-3">
          <label className="flex w-fit items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(event) => setDontAskAgain(event.target.checked)}
            />
            Don&apos;t ask again
          </label>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              className="btn-secondary text-red-600! hover:bg-red-600/10! dark:text-red-400!"
            >
              Don&apos;t save
            </button>
            <div className="flex-1" />
            <button type="button" onClick={handleCancel} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              disabled={saving}
              onClick={handleSaveAndClose}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-40"
              style={{ backgroundColor: "var(--save)" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
