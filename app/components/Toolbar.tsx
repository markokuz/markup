"use client";

import { useRef } from "react";
import type { ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { exportMarkedUpPdf } from "@/app/utils/exportPdf";
import { convertUnits, formatDistance, UNIT_LABELS } from "@/app/utils/units";
import { pdfDistance } from "@/app/utils/coordinates";

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "calibrate", label: "Calibrate", hint: "Set scale from known dimension" },
  { id: "measure", label: "Measure", hint: "Draw dimension lines" },
  { id: "select", label: "Select", hint: "Move and edit measurements" },
  { id: "pan", label: "Pan", hint: "Drag to move, or hold middle mouse button" },
];

export function Toolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    dispatch({
      type: "LOAD_PDF",
      bytes: new Uint8Array(buffer),
      fileName: file.name,
    });
    event.target.value = "";
  };

  const handleSave = async () => {
    if (!state.pdfBytes || !state.pdfFileName) return;
    await exportMarkedUpPdf(
      state.pdfBytes,
      state.measurements,
      state.scale,
      state.displayUnit,
      state.pdfFileName,
    );
  };

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
            PDF scale measure
          </span>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:bg-slate-700"
        >
          Upload PDF
        </button>

        <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.hint}
              disabled={!state.pdfBytes && tool.id !== "calibrate"}
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
          disabled={!state.pdfBytes || state.history.length === 0}
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
              disabled={!state.pdfBytes}
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
              disabled={!state.pdfBytes}
              className="px-2.5 py-1.5 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!state.pdfBytes || state.measurements.length === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            Save PDF
          </button>
        </div>
      </div>
    </header>
  );
}

export function StatusBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.pdfBytes) return null;

  const selected = state.measurements.find((m) => m.id === state.selectedId);
  const selectedLabel =
    selected && state.scale && !selected.isCalibration
      ? formatDistance(
          convertUnits(
            pdfDistance(selected.start, selected.end) * state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )
      : null;

  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-slate-800 bg-slate-950/90 px-4 py-2 text-sm backdrop-blur">
      <div className="text-slate-400">
        {state.pdfFileName}
        {state.measurements.filter((m) => !m.isCalibration).length > 0 && (
          <span className="ml-2 text-slate-500">
            · {state.measurements.filter((m) => !m.isCalibration).length}{" "}
            measurement
            {state.measurements.filter((m) => !m.isCalibration).length === 1
              ? ""
              : "s"}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {selectedLabel && (
          <span className="font-mono text-cyan-300">Selected: {selectedLabel}</span>
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

        {selected && !selected.isCalibration && (
          <button
            type="button"
            onClick={() =>
              dispatch({ type: "DELETE_MEASUREMENT", id: selected.id })
            }
            className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 transition hover:bg-red-500/10"
          >
            Delete
          </button>
        )}

        {state.tool === "measure" && !state.scale && (
          <span className="text-amber-400">Calibrate scale before measuring</span>
        )}

        {state.tool === "select" && !selected && (
          <span className="text-slate-500">Click a measurement to edit</span>
        )}
      </div>
    </footer>
  );
}
