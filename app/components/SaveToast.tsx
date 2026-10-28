"use client";

import { useEffect } from "react";
import { clearSaveStatus, useSaveStatus, type SaveStatusKind } from "@/app/utils/saveStatus";

/** How long each kind stays up; "saving" stays until the save reports back. */
const DURATION_MS: Record<SaveStatusKind, number | null> = {
  saving: null,
  success: 2000,
  info: 2000,
  warning: 6000,
  error: 6000,
};

const STYLES: Record<SaveStatusKind, string> = {
  saving: "border-border bg-surface text-text-primary",
  success: "border-green-600/30 bg-green-50 text-green-800",
  info: "border-border bg-surface text-text-secondary",
  warning: "border-amber-500/40 bg-amber-50 text-amber-900",
  error: "border-red-500/40 bg-red-50 text-red-800",
};

/** Feedback pill for Ctrl+S and the save menu, under the toolbar at top centre. */
export function SaveToast() {
  const status = useSaveStatus();

  useEffect(() => {
    if (!status) return;
    const duration = DURATION_MS[status.kind];
    if (duration === null) return;
    const timer = window.setTimeout(() => clearSaveStatus(status.id), duration);
    return () => window.clearTimeout(timer);
  }, [status]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-16 z-40 -translate-x-1/2"
    >
      {status && (
        <div
          key={status.id}
          className={`flex max-w-md items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium shadow-md ${STYLES[status.kind]}`}
        >
          {status.kind === "saving" && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {status.kind === "success" && <span aria-hidden>✓</span>}
          {status.kind === "error" && <span aria-hidden>!</span>}
          <span>{status.text}</span>
        </div>
      )}
    </div>
  );
}
