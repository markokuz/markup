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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
      >
        <div className="border-b border-slate-800 px-4 py-3">
          <h2 id="export-preview-title" className="text-lg font-medium text-slate-100">
            Preview before save
          </h2>
          <p className="mt-1 text-sm text-slate-400">{fileName}</p>
        </div>

        <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-auto bg-slate-900/50 p-4">
          {loading && (
            <p className="text-sm text-slate-400">Generating preview…</p>
          )}
          {!loading && blobUrl && fileType === "pdf" && (
            <iframe
              src={blobUrl}
              title="Export preview"
              className="h-[60vh] w-full rounded border border-slate-700 bg-white"
            />
          )}
          {!loading && blobUrl && fileType === "image" && (
            <img
              src={blobUrl}
              alt="Export preview"
              className="max-h-[60vh] max-w-full rounded border border-slate-700"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !blobUrl}
            onClick={onConfirm}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {saveMode === "choose-location" ? "Choose location & save" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
