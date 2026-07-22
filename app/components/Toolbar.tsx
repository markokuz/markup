"use client";

import { useEffect, useRef, useState } from "react";
import type { ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import {
  exportMarkedUpDocument,
  supportsSaveFilePicker,
  type ExportSaveMode,
} from "@/app/utils/exportDocument";
import { ACCEPTED_FILE_TYPES, detectDocumentType } from "@/app/utils/fileTypes";
import { convertUnits, formatDistance, UNIT_LABELS } from "@/app/utils/units";
import { docDistance } from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import {
  DEFAULT_ANNOTATION_COLOR,
  MARKUP_PALETTE,
} from "@/app/utils/colors";

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "calibrate", label: "Calibrate", hint: "Set scale from known dimension" },
];

export function Toolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);

  useEffect(() => {
    if (!saveMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!saveMenuRef.current?.contains(event.target as Node)) {
        setSaveMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [saveMenuOpen]);

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

  const handleSave = async (saveMode: ExportSaveMode = "download") => {
    if (!state.fileBytes || !state.fileName || !state.fileType) return;
    setSaveMenuOpen(false);
    await exportMarkedUpDocument(
      state.fileBytes,
      state.fileType,
      state.fileName,
      state.fileMimeType ?? "",
      state.measurements,
      state.rectangles,
      state.scale,
      state.displayUnit,
      saveMode,
    );
  };

  const annotationCount =
    state.measurements.filter((m) => !m.isCalibration).length +
    state.rectangles.length;

  const saveLabel =
    state.fileType === "image" ? "Save PNG" : "Save PDF";

  const saveDisabled = !state.fileBytes || annotationCount === 0;

  const canChooseSaveLocation = supportsSaveFilePicker();

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

          <div ref={saveMenuRef} className="relative flex">
            <button
              type="button"
              onClick={() => handleSave("download")}
              disabled={saveDisabled}
              className="rounded-l-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {saveLabel}
            </button>
            <button
              type="button"
              disabled={saveDisabled}
              aria-expanded={saveMenuOpen}
              aria-haspopup="menu"
              aria-label="Save options"
              onClick={() => setSaveMenuOpen((open) => !open)}
              className="rounded-r-lg border-l border-emerald-500/40 bg-emerald-600 px-2 py-1.5 text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              <svg
                aria-hidden
                viewBox="0 0 12 12"
                className="h-3.5 w-3.5 fill-current"
              >
                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {saveMenuOpen && !saveDisabled && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSave("download")}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                >
                  Save to Downloads
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSave("choose-location")}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                >
                  Choose save location…
                  {!canChooseSaveLocation && (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Uses Downloads in this browser
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export function StatusBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.fileBytes) return null;

  const selectedLine =
    state.selectedIds.length === 1
      ? state.measurements.find((m) => m.id === state.selectedIds[0])
      : undefined;
  const selectedRect =
    state.selectedIds.length === 1
      ? state.rectangles.find((r) => r.id === state.selectedIds[0])
      : undefined;

  const colorableIds = state.selectedIds.filter((id) => {
    const measurement = state.measurements.find((m) => m.id === id);
    return !measurement?.isCalibration;
  });

  const selectedAnnotations = [
    ...state.measurements.filter((m) => colorableIds.includes(m.id)),
    ...state.rectangles.filter((r) => colorableIds.includes(r.id)),
  ];
  const sharedColor =
    selectedAnnotations.length > 0 &&
    selectedAnnotations.every(
      (annotation) =>
        (annotation.color ?? DEFAULT_ANNOTATION_COLOR) ===
        (selectedAnnotations[0].color ?? DEFAULT_ANNOTATION_COLOR),
    )
      ? (selectedAnnotations[0].color ?? DEFAULT_ANNOTATION_COLOR)
      : null;

  const applyColor = (color: string) => {
    if (colorableIds.length === 0) return;
    dispatch({ type: "SET_ANNOTATION_COLOR", ids: colorableIds, color });
  };

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

      <div className="ml-auto flex flex-wrap items-center gap-3">
        {state.selectedIds.length > 1 && (
          <span className="font-mono text-cyan-300">
            {state.selectedIds.length} selected
          </span>
        )}
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

        {colorableIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Color</span>
            <div className="flex items-center gap-1">
              {MARKUP_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={`Set color ${color}`}
                  onClick={() => applyColor(color)}
                  className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
                    sharedColor === color
                      ? "border-white"
                      : "border-slate-600"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={sharedColor ?? DEFAULT_ANNOTATION_COLOR}
                onChange={(event) => applyColor(event.target.value)}
                className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-slate-900"
                title="Custom color"
              />
            </div>
          </div>
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

        {state.selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: "DELETE_SELECTED" })}
            className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 transition hover:bg-red-500/10"
          >
            Delete{state.selectedIds.length > 1 ? ` (${state.selectedIds.length})` : ""}
          </button>
        )}

        {(state.tool === "measure" || state.tool === "rectangle") && !state.scale && (
          <span className="text-amber-400">Calibrate scale before measuring</span>
        )}

        {state.tool === "select" && state.selectedIds.length === 0 && (
          <span className="text-slate-500">
            Drag to select · Shift+click to toggle · click a label to edit dimensions
          </span>
        )}
      </div>
    </footer>
  );
}
