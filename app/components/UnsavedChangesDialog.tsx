"use client";

import { useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { saveTabWithFeedback } from "@/app/utils/projectSave";

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
      const saved = await saveTabWithFeedback(tab, displayUnit, "linked", dispatch);
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
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id="unsaved-title" className="text-lg font-semibold text-text-primary">
          Close tab with unsaved changes?
        </h2>
        <p id="unsaved-description" className="mt-2 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{label}</span>{" "}has markups
          that haven&apos;t been saved. Closing it will discard them.
        </p>

        <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(event) => setDontAskAgain(event.target.checked)}
          />
          Don&apos;t ask me again
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={handleCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="rounded-lg border border-red-600/30 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-600/10"
          >
            Close without saving
          </button>
          <button
            type="button"
            autoFocus
            disabled={saving}
            onClick={handleSaveAndClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
            style={{ backgroundColor: "var(--save)" }}
          >
            {saving ? "Saving…" : "Save project & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
