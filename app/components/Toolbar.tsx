"use client";

import { useRef } from "react";
import type { ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { exportMarkedUpDocument } from "@/app/utils/exportDocument";
import { ACCEPTED_FILE_TYPES, detectDocumentType } from "@/app/utils/fileTypes";
import { convertUnits, formatDistance, UNIT_LABELS } from "@/app/utils/units";
import { docDistance } from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "calibrate", label: "Calibrate", hint: "Set scale from known dimension" },
];

export function Toolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = detectDocumentType(file);
    if (!fileType) return;

    const buffer = await file.arrayBuffer();
    dispatch({
      type: "LOAD_FILE",
      bytes: new Uint8Array(buffer),
      fileName: file.name,
      fileType,
      mimeType: file.type,
    });
    event.target.value = "";
  };

  const handleSave = async () => {
    if (!state.fileBytes || !state.fileName || !state.fileType) return;
    await exportMarkedUpDocument(
      state.fileBytes,
      state.fileType,
      state.fileName,
      state.fileMimeType ?? "",
      state.measurements,
      state.rectangles,
      state.scale,
      state.displayUnit,
    );
  };

  const saveLabel =
    state.fileType === "image" ? "Save PNG" : "Save PDF";

  const annotationCount =
    state.measurements.filter((m) => !m.isCalibration).length +
    state.rectangles.length;

  const zoomIn = () =>
    dispatch({ type: "SET_ZOOM", zoom: Math.min(4, state.zoom + 0.25) });
  const zoomOut = () =>
    dispatch({ type: "SET_ZOOM", zoom: Math.max(0.25, state.zoom - 0.25) });

  return (
    <header className="border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Markup
          </h1>
          <span className="hidden text-xs text-slate-500 sm:inline">
            PDF & image measure
          </span>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:bg-slate-700"
        >
          Upload File
        </button>

        <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.hint}
              disabled={!state.fileBytes && tool.id !== "calibrate"}
              onClick={() => dispatch({ type: "SET_TOOL", tool: tool.id })}
              className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-40 ${
                state.tool === tool.id
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!state.fileBytes || state.history.length === 0}
          onClick={() => dispatch({ type: "UNDO" })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-40"
        >
          Undo
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900">
            <button
              type="button"
              onClick={zoomOut}
              disabled={!state.fileBytes}
              className="px-2.5 py-1.5 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-14 text-center font-mono text-xs text-slate-400">
              {Math.round(state.zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={!state.fileBytes}
              className="px-2.5 py-1.5 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!state.fileBytes || annotationCount === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </header>
  );
}

export function StatusBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.fileBytes) return null;

  const selectedLine = state.measurements.find((m) => m.id === state.selectedId);
  const selectedRect = state.rectangles.find((r) => r.id === state.selectedId);

  const selectedLineLabel =
    selectedLine && state.scale && !selectedLine.isCalibration
      ? formatDistance(
          convertUnits(
            docDistance(selectedLine.start, selectedLine.end) *
              state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )
      : null;

  const selectedRectLabel =
    selectedRect && state.scale
      ? `${formatDistance(
          convertUnits(
            getRectDocWidth(selectedRect) * state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )} × ${formatDistance(
          convertUnits(
            getRectDocHeight(selectedRect) * state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )}`
      : null;

  const lineCount = state.measurements.filter((m) => !m.isCalibration).length;
  const rectCount = state.rectangles.length;
  const totalCount = lineCount + rectCount;

  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-slate-800 bg-slate-950/90 px-4 py-2 text-sm backdrop-blur">
      <div className="text-slate-400">
        {state.fileName}
        {totalCount > 0 && (
          <span className="ml-2 text-slate-500">
            · {totalCount} annotation{totalCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {selectedLineLabel && (
          <span className="font-mono text-cyan-300">
            Selected: {selectedLineLabel}
          </span>
        )}
        {selectedRectLabel && (
          <span className="font-mono text-cyan-300">
            Selected: {selectedRectLabel}
          </span>
        )}
        <label className="flex items-center gap-2 text-slate-400">
          Display unit
          <select
            value={state.displayUnit}
            onChange={(e) =>
              dispatch({
                type: "SET_DISPLAY_UNIT",
                unit: e.target.value as Unit,
              })
            }
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 outline-none focus:border-cyan-500"
          >
            {(Object.keys(UNIT_LABELS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        {selectedLine && !selectedLine.isCalibration && (
          <button
            type="button"
            onClick={() =>
              dispatch({ type: "DELETE_MEASUREMENT", id: selectedLine.id })
            }
            className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 transition hover:bg-red-500/10"
          >
            Delete
          </button>
        )}

        {selectedRect && (
          <button
            type="button"
            onClick={() =>
              dispatch({ type: "DELETE_RECTANGLE", id: selectedRect.id })
            }
            className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 transition hover:bg-red-500/10"
          >
            Delete
          </button>
        )}

        {(state.tool === "measure" || state.tool === "rectangle") && !state.scale && (
          <span className="text-amber-400">Calibrate scale before measuring</span>
        )}

        {state.tool === "select" && !selectedLine && !selectedRect && (
          <span className="text-slate-500">
            Click an annotation to edit · click a label to type a dimension
          </span>
        )}
      </div>
    </footer>
  );
}
