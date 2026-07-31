"use client";

import { useEffect } from "react";
import type { DocumentType } from "@/app/types";
import type { ExportSaveMode } from "@/app/utils/exportDocument";

interface ExportPreviewDialogProps {
  open: boolean;
  blobUrl: string | null;
  fileType: DocumentType;
  fileName: string;
  loading: boolean;
  saveMode: ExportSaveMode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExportPreviewDialog({
  open,
  blobUrl,
  fileType,
  fileName,
  loading,
  saveMode,
  onConfirm,
  onCancel,
}: ExportPreviewDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="export-preview-title" className="text-lg font-medium text-text-primary">
            Preview before save
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{fileName}</p>
        </div>

        <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-auto bg-canvas-bg p-4">
          {loading && (
            <p className="text-sm text-text-secondary">Generating preview…</p>
          )}
          {!loading && blobUrl && fileType === "pdf" && (
            <iframe
              src={blobUrl}
              title="Export preview"
              className="h-[60vh] w-full rounded border border-border bg-white"
            />
          )}
          {!loading && blobUrl && fileType === "image" && (
            <img
              src={blobUrl}
              alt="Export preview"
              className="max-h-[60vh] max-w-full rounded border border-border"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !blobUrl}
            onClick={onConfirm}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
            style={{ backgroundColor: "var(--save)" }}
            onMouseEnter={(e) => {
              if (!loading && blobUrl) e.currentTarget.style.backgroundColor = "var(--save-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--save)";
            }}
          >
            {saveMode === "choose-location" ? "Choose location & save" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
