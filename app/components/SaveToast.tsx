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

/** A hint is advice to read and act on, so it stays up longer. */
const HINT_DURATION_MS = 12000;

const ICON_COLOR: Record<SaveStatusKind, string> = {
  saving: "text-text-secondary",
  success: "text-green-600 dark:text-green-400",
  info: "text-text-muted",
  warning: "text-amber-500 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

function StatusIcon({ kind }: { kind: SaveStatusKind }) {
  if (kind === "saving") {
    return (
      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "warning" ? (
        <path d="M8 2.2 14.6 13.5H1.4L8 2.2ZM8 6.5v3.2M8 11.6v.1" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.5" />
          {kind === "success" && <path d="m5.2 8.2 2 2 3.6-4" />}
          {kind === "error" && <path d="M8 4.6v4M8 11.2v.1" />}
          {kind === "info" && <path d="M8 7.4v3.8M8 4.8v.1" />}
        </>
      )}
    </svg>
  );
}

/**
 * Feedback for saves, copies and errors, in the toolbar just right of undo and redo. It takes
 * up the toolbar's free space without moving anything; a long message grows down over the canvas.
 * With under 16rem free (a narrow window) it hangs below the toolbar instead of covering controls.
 */
export function SaveToast() {
  const status = useSaveStatus();

  useEffect(() => {
    if (!status) return;
    const duration = DURATION_MS[status.kind];
    if (duration === null) return;
    const timer = window.setTimeout(
      () => clearSaveStatus(status.id),
      status.hint ? HINT_DURATION_MS : duration,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  return (
    <div role="status" aria-live="polite" className="@container pointer-events-none h-9 min-w-0 flex-1">
      {/* Only positioned when there's room: otherwise the card is placed against the header. */}
      <div className="h-full @[16rem]:relative">
        {status && (
          <div
            key={status.id}
            className="absolute left-4 top-full z-40 mt-1 flex w-max max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border border-border bg-surface px-3 py-[7px] text-sm font-medium text-text-primary shadow-md [overflow-wrap:anywhere] @[16rem]:left-0 @[16rem]:top-0 @[16rem]:mt-0 @[16rem]:max-w-full"
          >
            <span className={`mt-0.5 shrink-0 ${ICON_COLOR[status.kind]}`}>
              <StatusIcon kind={status.kind} />
            </span>
            <span className="min-w-0">
              {status.text}
              {status.hint && (
                <span className="mt-0.5 block text-xs font-normal text-text-secondary">{status.hint}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
