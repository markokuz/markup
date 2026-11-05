"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentRotation, ShapeAnnotation, ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { supportsSaveFilePicker } from "@/app/utils/saveFilePicker";
import { ColorWheel } from "@/app/components/ColorWheel";
import { SettingsButton } from "@/app/components/SettingsDialog";
import { ACCEPTED_FILE_TYPES } from "@/app/utils/fileTypes";
import { PROJECT_ACCEPT } from "@/app/utils/projectFile";
import { openDocumentFile, pickAndOpenFile } from "@/app/utils/openFile";
import { saveTabWithFeedback, type SaveMode } from "@/app/utils/projectSave";
import { getActiveTabFromAppState } from "@/app/utils/tabState";
import { convertUnits, formatDistance, UNIT_LABELS } from "@/app/utils/units";
import { docDistance } from "@/app/utils/coordinates";
import {
  getRectHorizontalDocLength,
  getRectVerticalDocLength,
} from "@/app/utils/dimensions";
import {
  DEFAULT_ANNOTATION_COLOR,
  MARKUP_PALETTE,
} from "@/app/utils/colors";
import { setZoomAnchor } from "@/app/utils/zoomAnchor";
import { stepZoom } from "@/app/utils/zoomLevels";
import { TEXT_DEFAULT_SIZE } from "@/app/utils/noteLayout";
import { parsePageRanges } from "@/app/utils/pageRanges";
import { fileLabel, nearestCalibratedSheet } from "@/app/utils/pages";
import { showSaveStatus } from "@/app/utils/saveStatus";
import {
  areaOutline,
  cutoutCount,
  DRAW_DEFAULT_WIDTH,
  DRAW_MAX_WIDTH,
  DRAW_MIN_WIDTH,
  drawWidth,
  ERASER_DEFAULT_SIZE,
  ERASER_MAX_SIZE,
  ERASER_MIN_SIZE,
} from "@/app/utils/shapeMetrics";
import { isColorTool } from "@/app/utils/settings";
import { clearCalibrationPrompt, useCalibrationPrompt } from "@/app/utils/calibrationPrompt";

/** How long the "set the scale first" popup stays under Calibrate. */
const CALIBRATION_PROMPT_MS = 4500;

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "calibrate", label: "Calibrate", hint: "Set scale from known dimension" },
];

export function Toolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const calibrationPrompt = useCalibrationPrompt();

  useEffect(() => {
    if (!calibrationPrompt) return;
    const timer = window.setTimeout(() => clearCalibrationPrompt(calibrationPrompt.id), CALIBRATION_PROMPT_MS);
    return () => window.clearTimeout(timer);
  }, [calibrationPrompt]);

  // Once a scale is set the hint has done its job.
  useEffect(() => {
    if (state.scale) clearCalibrationPrompt();
  }, [state.scale]);

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
    event.target.value = "";
    if (file) await openDocumentFile(file, dispatch);
  };

  const handleSaveTab = async (saveMode: SaveMode) => {
    setSaveMenuOpen(false);
    const tab = getActiveTabFromAppState(state);
    if (!tab) return;
    await saveTabWithFeedback(tab, state.displayUnit, saveMode, dispatch);
  };

  const saveDisabled = !state.fileBytes;
  const documentKind = state.fileType === "image" ? "PNG" : "PDF";

  const canChooseSaveLocation = supportsSaveFilePicker();

  const zoomIn = () => {
    setZoomAnchor("center");
    dispatch({ type: "SET_ZOOM", zoom: stepZoom(state.zoom, 1) });
  };
  const zoomOut = () => {
    setZoomAnchor("center");
    dispatch({ type: "SET_ZOOM", zoom: stepZoom(state.zoom, -1) });
  };

  const rotateCw = () => {
    const next = ((state.rotation + 90) % 360) as DocumentRotation;
    dispatch({ type: "SET_ROTATION", rotation: next });
  };

  const rotateCcw = () => {
    const next = ((state.rotation + 270) % 360) as DocumentRotation;
    dispatch({ type: "SET_ROTATION", rotation: next });
  };

  return (
    <>
    <header className="relative z-30 border-b border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Markup
          </h1>
          <span className="hidden text-xs text-text-muted sm:inline">
            PDF & image measure
          </span>
        </div>

        <div className="h-6 w-px bg-border" />

        <input
          ref={fileInputRef}
          type="file"
          accept={`${ACCEPTED_FILE_TYPES},${PROJECT_ACCEPT}`}
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => void pickAndOpenFile(dispatch, fileInputRef.current, state.tabs)}
          className="btn-secondary h-9"
        >
          Upload File
        </button>

        <div className="relative flex h-9 rounded-lg border border-border bg-surface">
          {TOOLS.map((tool) => (
            <button
              key={tool.id === "calibrate" && calibrationPrompt ? `${tool.id}-${calibrationPrompt.id}` : tool.id}
              type="button"
              title={tool.hint}
              disabled={!state.fileBytes && tool.id !== "calibrate"}
              onClick={() => {
                if (tool.id === "calibrate") clearCalibrationPrompt();
                dispatch({ type: "SET_TOOL", tool: tool.id });
              }}
              className={`rounded-[7px] px-3 text-sm font-medium transition disabled:opacity-40 ${
                state.tool === tool.id
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
              } ${tool.id === "calibrate" && calibrationPrompt ? "calibrate-flash" : ""}`}
            >
              {tool.label}
            </button>
          ))}
          {calibrationPrompt && (
            <div
              role="status"
              className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary shadow-lg"
            >
              <span
                aria-hidden
                className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-border bg-surface"
              />
              {calibrationPrompt.text}
            </div>
          )}
        </div>

        <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface">
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!state.fileBytes || state.history.length === 0}
            onClick={() => dispatch({ type: "UNDO" })}
            className="flex w-8 items-center justify-center text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <HistoryArrow direction="back" />
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            disabled={!state.fileBytes || state.future.length === 0}
            onClick={() => dispatch({ type: "REDO" })}
            className="flex w-8 items-center justify-center text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <HistoryArrow direction="forward" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={zoomOut}
              disabled={!state.fileBytes}
              className="w-8 text-text-secondary transition hover:bg-surface-muted disabled:opacity-40"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-14 self-center text-center font-mono text-xs text-text-secondary">
              {Math.round(state.zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={!state.fileBytes}
              className="w-8 text-text-secondary transition hover:bg-surface-muted disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          {state.fileBytes && (
            <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                onClick={rotateCcw}
                disabled={!state.fileBytes}
                className="w-8 text-text-secondary transition hover:bg-surface-muted disabled:opacity-40"
                aria-label="Rotate counter-clockwise"
                title="Rotate view left"
              >
                ↺
              </button>
              <span className="min-w-10 self-center text-center font-mono text-xs text-text-secondary">
                {state.rotation}°
              </span>
              <button
                type="button"
                onClick={rotateCw}
                disabled={!state.fileBytes}
                className="w-8 text-text-secondary transition hover:bg-surface-muted disabled:opacity-40"
                aria-label="Rotate clockwise"
                title="Rotate view right"
              >
                ↻
              </button>
            </div>
          )}

          <div ref={saveMenuRef} className="relative flex h-9">
            <button
              type="button"
              onClick={() => handleSaveTab("save")}
              disabled={saveDisabled}
              title={
                state.projectHandle
                  ? `Save (Ctrl+S) — updates ${state.projectHandle.name}`
                  : "Save (Ctrl+S) — choose where to save"
              }
              className="rounded-l-lg px-3 text-sm font-medium text-white transition disabled:opacity-40"
              style={{ backgroundColor: "var(--save)" }}
              onMouseEnter={(e) => {
                if (!saveDisabled) e.currentTarget.style.backgroundColor = "var(--save-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--save)";
              }}
            >
              Save
            </button>
            <button
              type="button"
              disabled={saveDisabled}
              aria-expanded={saveMenuOpen}
              aria-haspopup="menu"
              aria-label="Save options"
              onClick={() => setSaveMenuOpen((open) => !open)}
              className="flex w-8 items-center justify-center rounded-r-lg border-l border-emerald-700/20 text-white transition disabled:opacity-40"
              style={{ backgroundColor: "var(--save)" }}
              onMouseEnter={(e) => {
                if (!saveDisabled) e.currentTarget.style.backgroundColor = "var(--save-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--save)";
              }}
            >
              <svg
                aria-hidden
                viewBox="0 0 12 12"
                className="h-3.5 w-3.5 fill-current"
              >
                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {saveMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[14rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSaveTab("save-as")}
                  className="block w-full px-3 py-2 text-left text-sm text-text-primary transition hover:bg-surface-muted"
                >
                  Save as…
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {canChooseSaveLocation
                      ? `Choose a folder and name for the ${documentKind}`
                      : "Saves to Downloads in this browser"}
                  </span>
                </button>
                {/* A saved PDF reopens editable on its own; only flattened images need a project. */}
                {state.fileType !== "pdf" && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleSaveTab("save-project-as")}
                    className="block w-full px-3 py-2 text-left text-sm text-text-primary transition hover:bg-surface-muted"
                  >
                    Save project as .mkup…
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {canChooseSaveLocation
                        ? "Keeps the markups editable (a PNG can't)"
                        : "Keeps the markups editable · saves to Downloads"}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
          <SettingsButton />
        </div>
      </div>
    </header>
    </>
  );
}

/** Moves between a multi-page PDF's sheets; hidden for anything with one page. */
function SheetNavigator() {
  const { sheets, page, pageCount, pageLabels, scale, scales } = useAppState();
  const dispatch = useAppDispatch();
  if (pageCount <= 1 || !sheets) return null;

  const index = sheets.indexOf(page);
  const go = (offset: number) => {
    const next = sheets[index + offset];
    if (next !== undefined) dispatch({ type: "SET_PAGE", page: next });
  };
  /** Goes to the page number typed in the box; anything it can't go to is explained and undone. */
  const goToTyped = (input: HTMLInputElement) => {
    const text = input.value.trim();
    const current = String(page + 1);
    if (!text || text === current) {
      input.value = current;
      return;
    }
    const { pages, error } = parsePageRanges(text, pageCount);
    const target = pages?.length === 1 ? pages[0] : null;
    if (target === null) {
      showSaveStatus("warning", error ?? "Enter one page number.");
    } else if (!sheets.includes(target)) {
      showSaveStatus("warning", `Page ${target + 1} isn't imported. Add it with Pages…`);
    } else {
      dispatch({ type: "SET_PAGE", page: target });
      return;
    }
    input.value = current;
  };
  const uncalibrated = sheets.filter((sheet) => !scales[sheet]).length;
  const scaleSource = scale ? null : nearestCalibratedSheet(sheets, scales, page);
  const label = fileLabel(page, pageLabels);
  const arrow = "rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary disabled:opacity-40";

  return (
    <div className="flex items-center gap-1" aria-label="Sheets">
      <button
        type="button"
        title="Previous sheet (Page Up)"
        aria-label="Previous sheet"
        disabled={index <= 0}
        onClick={() => go(-1)}
        className={arrow}
      >
        ‹
      </button>
      <input
        // Remounts on each page change, so it always starts from the page on screen.
        key={page}
        type="text"
        inputMode="numeric"
        defaultValue={page + 1}
        aria-label="Page number"
        title="Type a page number and press Enter"
        onFocus={(event) => event.target.select()}
        onBlur={(event) => goToTyped(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            goToTyped(event.currentTarget);
            // Leave nothing focused, which would swallow tool hotkeys and Page Up/Down.
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.currentTarget.value = String(page + 1);
            event.currentTarget.blur();
          }
        }}
        className="input-field w-12 px-1 py-0.5 text-center text-xs"
      />
      <span className="whitespace-nowrap text-xs text-text-muted">
        {/* The box holds the file's page number; a partial import also says where that falls in it. */}
        {sheets.length === pageCount ? `/ ${pageCount}` : `(${index + 1} of ${sheets.length} sheets)`}
      </span>
      <button
        type="button"
        title="Next sheet (Page Down)"
        aria-label="Next sheet"
        disabled={index >= sheets.length - 1}
        onClick={() => go(1)}
        className={arrow}
      >
        ›
      </button>
      {label && <span className="max-w-32 truncate text-xs text-text-secondary" title={label}>{label}</span>}
      <button
        type="button"
        title="Choose which pages of the file to show"
        onClick={() => dispatch({ type: "SET_PAGES_DIALOG", open: true })}
        className="ml-1 whitespace-nowrap rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
      >
        Pages…
      </button>
      {scaleSource !== null && (
        <button
          type="button"
          title={`Give this sheet the scale set on sheet ${scaleSource + 1}. Check it's drawn at the same scale.`}
          onClick={() => dispatch({ type: "COPY_SCALE_FROM_SHEET", page: scaleSource })}
          className="ml-1 whitespace-nowrap rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
        >
          Use scale from sheet {scaleSource + 1}
        </button>
      )}
      {scale && uncalibrated > 0 && (
        <button
          type="button"
          title="Give this sheet's scale to every sheet that has none yet. Check any detail sheets drawn at a different scale."
          onClick={() => {
            dispatch({ type: "APPLY_SCALE_TO_UNCALIBRATED" });
            showSaveStatus(
              "success",
              `Scale set on ${uncalibrated} more sheet${uncalibrated === 1 ? "" : "s"}. Check any drawn at a different scale.`,
            );
          }}
          className="ml-1 whitespace-nowrap rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
        >
          Use scale on {uncalibrated} other sheet{uncalibrated === 1 ? "" : "s"}
        </button>
      )}
    </div>
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
    ...state.notes.filter((n) => colorableIds.includes(n.id)),
    ...state.shapes.filter((sh) => colorableIds.includes(sh.id)),
  ];
  const selectedSnapshotIds = state.shapes
    .filter((sh) => sh.kind === "image" && colorableIds.includes(sh.id))
    .map((sh) => sh.id);
  const selectedTexts = state.shapes.filter(
    (sh) => sh.kind === "text" && state.selectedIds.includes(sh.id),
  );
  const textSize = Math.round(selectedTexts[0]?.fontSize ?? TEXT_DEFAULT_SIZE);
  const updateTexts = (updates: Partial<(typeof selectedTexts)[0]>) => {
    dispatch({ type: "RECORD_UNDO" });
    for (const shape of selectedTexts) {
      dispatch({ type: "UPDATE_SHAPE", id: shape.id, updates });
    }
  };
  const setTextSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return;
    const fontSize = Math.min(size, 2000);
    updateTexts({ fontSize });
    dispatch({ type: "UPDATE_SETTINGS", patch: { textSize: fontSize } });
  };

  const selectedDrawings = state.shapes.filter(
    (sh) => sh.kind === "draw" && state.selectedIds.includes(sh.id),
  );
  // Selected strokes, or the Draw tool's width for new strokes when nothing is selected.
  const showDrawWidth =
    selectedDrawings.length > 0 || (colorableIds.length === 0 && state.tool === "draw");

  const sharedColor =
    selectedAnnotations.length > 0 &&
    selectedAnnotations.every(
      (annotation) =>
        (annotation.color ?? DEFAULT_ANNOTATION_COLOR) ===
        (selectedAnnotations[0].color ?? DEFAULT_ANNOTATION_COLOR),
    )
      ? (selectedAnnotations[0].color ?? DEFAULT_ANNOTATION_COLOR)
      : null;

  // With nothing selected, the palette sets the colour of the tool in hand (for this tab).
  const paletteTool = colorableIds.length === 0 && isColorTool(state.tool) ? state.tool : null;
  const paletteColor = paletteTool
    ? (state.toolColors[paletteTool] ?? state.settings.toolColors[paletteTool])
    : sharedColor;

  const applyColor = (color: string, recordUndo = true) => {
    if (paletteTool) {
      dispatch({ type: "SET_TAB_TOOL_COLOR", tool: paletteTool, color });
      return;
    }
    if (colorableIds.length === 0) return;
    dispatch({ type: "SET_ANNOTATION_COLOR", ids: colorableIds, color, recordUndo });
  };

  const selectedLineLabel =
    selectedLine && state.scale && !selectedLine.isCalibration && !selectedLine.plain
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
    selectedRect && state.scale && !selectedRect.plain
      ? `${formatDistance(
          convertUnits(
            getRectHorizontalDocLength(selectedRect, state.rotation) *
              state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )} × ${formatDistance(
          convertUnits(
            getRectVerticalDocLength(selectedRect, state.rotation) *
              state.scale.unitsPerPdfPoint,
            state.scale.calibrationUnit,
            state.displayUnit,
          ),
          state.displayUnit,
        )}`
      : null;

  const selectedArea =
    state.selectedIds.length === 1
      ? state.shapes.find((s) => s.id === state.selectedIds[0] && s.kind === "area" && !s.locked)
      : undefined;

  const lineCount = state.measurements.filter((m) => !m.isCalibration).length;
  const rectCount = state.rectangles.length;
  const noteCount = state.notes.length;
  const totalCount = lineCount + rectCount + noteCount + state.shapes.length;

  return (
    <footer className="relative z-20 flex flex-wrap items-center gap-4 border-t border-border bg-surface px-4 py-2 text-sm">
      <div className="text-text-secondary">
        {state.fileName}
        {totalCount > 0 && (
          <span className="ml-2 text-text-muted">
            · {totalCount} annotation{totalCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <SheetNavigator />

      <div className="ml-auto flex flex-wrap items-center gap-3">
        {state.selectedIds.length > 1 && (
          <span className="font-mono text-accent">
            {state.selectedIds.length} selected
          </span>
        )}
        {selectedLineLabel && (
          <span className="font-mono text-accent">
            Selected: {selectedLineLabel}
          </span>
        )}
        {selectedRectLabel && (
          <span className="font-mono text-accent">
            Selected: {selectedRectLabel}
          </span>
        )}

        {selectedArea && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Subtract an opening from this area: click around it, then double-click, press Enter or click the first point"
              onClick={() => {
                dispatch({ type: "START_CUTOUT", id: selectedArea.id });
                showSaveStatus("info", "Click around the opening. Double-click or Enter to finish.");
              }}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            >
              Cut out
            </button>
            {cutoutCount(selectedArea) > 0 && (
              <button
                type="button"
                title="Fill this area's cutouts back in"
                onClick={() => {
                  dispatch({ type: "RECORD_UNDO" });
                  dispatch({
                    type: "UPDATE_SHAPE",
                    id: selectedArea.id,
                    updates: { points: areaOutline(selectedArea), breaks: undefined },
                  });
                }}
                className="rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
              >
                Remove cutouts
              </button>
            )}
          </div>
        )}

        {selectedTexts.length > 0 && (
          <div className="flex items-center gap-1" aria-label="Text style">
            <span className="mr-1 text-text-muted">Size</span>
            <button
              type="button"
              title="Smaller text"
              onClick={() => setTextSize(Math.max(1, textSize - (textSize > 20 ? 4 : 1)))}
              className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-surface-muted"
            >
              −
            </button>
            <input
              key={textSize}
              type="number"
              min={1}
              defaultValue={textSize}
              aria-label="Text size"
              onKeyDown={(event) => {
                if (event.key === "Enter") setTextSize(Number(event.currentTarget.value));
              }}
              onBlur={(event) => {
                if (Number(event.currentTarget.value) !== textSize) setTextSize(Number(event.currentTarget.value));
              }}
              className="input-field w-14 px-1.5 py-0.5 text-center text-xs"
            />
            <button
              type="button"
              title="Bigger text"
              onClick={() => setTextSize(textSize + (textSize >= 20 ? 4 : 1))}
              className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-surface-muted"
            >
              +
            </button>
            <button
              type="button"
              title="Bold"
              aria-pressed={selectedTexts.every((s) => s.bold)}
              onClick={() => {
                const bold = !selectedTexts.every((s) => s.bold);
                updateTexts({ bold });
              }}
              className={`ml-1 rounded border px-1.5 py-0.5 text-xs font-bold ${
                selectedTexts.every((s) => s.bold) ? "border-accent text-accent" : "border-border"
              }`}
            >
              B
            </button>
            <button
              type="button"
              title="Italic"
              aria-pressed={selectedTexts.every((s) => s.italic)}
              onClick={() => {
                const italic = !selectedTexts.every((s) => s.italic);
                updateTexts({ italic });
              }}
              className={`rounded border px-1.5 py-0.5 text-xs italic ${
                selectedTexts.every((s) => s.italic) ? "border-accent text-accent" : "border-border"
              }`}
            >
              I
            </button>
          </div>
        )}

        {(state.tool === "draw" || showDrawWidth) && (
          <div className="flex items-center gap-3">
            {state.tool === "draw" && (
              <button
                type="button"
                title={
                  state.drawEraser
                    ? "Eraser on: drag over drawings to rub them out. Click to draw again"
                    : "Eraser: drag over drawings to rub out parts of them"
                }
                aria-label="Eraser"
                aria-pressed={state.drawEraser}
                onClick={() => dispatch({ type: "SET_DRAW_ERASER", on: !state.drawEraser })}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                  state.drawEraser
                    ? "border-accent bg-accent text-white"
                    : "border-border text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                }`}
              >
                <EraserIcon />
                Eraser
              </button>
            )}
            {showDrawWidth && (
              <DrawWidthSlider
                drawings={selectedDrawings}
                eraser={state.tool === "draw" && state.drawEraser}
              />
            )}
          </div>
        )}

        {(colorableIds.length > 0 || paletteTool) && (
          <div className="flex items-center gap-2">
            <span className="text-text-muted">{paletteTool ? "Tool color" : "Color"}</span>
            <div className="flex items-center gap-1">
              {MARKUP_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={`Set color ${color}`}
                  onClick={() => applyColor(color)}
                  className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
                    paletteColor === color
                      ? "border-text-primary"
                      : "border-border"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <ColorWheel
                value={paletteColor ?? DEFAULT_ANNOTATION_COLOR}
                onChange={(color, recordUndo) => applyColor(color, recordUndo)}
              />
              {selectedSnapshotIds.length > 0 && (
                <button
                  type="button"
                  title="Show the snapshot in its original colours"
                  onClick={() =>
                    // "" clears the tint; only snapshots treat an empty colour as "original".
                    dispatch({ type: "SET_ANNOTATION_COLOR", ids: selectedSnapshotIds, color: "" })
                  }
                  className="ml-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                >
                  Original
                </button>
              )}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-text-secondary">
          Display unit
          <select
            value={state.displayUnit}
            onChange={(e) =>
              dispatch({
                type: "SET_DISPLAY_UNIT",
                unit: e.target.value as Unit,
              })
            }
            className="input-field rounded-md px-2 py-1 text-text-primary"
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
            className="rounded-md border border-red-300 px-2 py-1 text-red-600 transition hover:bg-red-50 dark:border-red-400/50 dark:text-red-400 dark:hover:bg-red-400/10"
          >
            Delete{state.selectedIds.length > 1 ? ` (${state.selectedIds.length})` : ""}
          </button>
        )}

        {state.tool === "note" && (
          <span className="text-text-muted">Click to place a note</span>
        )}

        {state.tool !== "pan" && state.tool !== "calibrate" && (
          <span className="text-text-muted">
            Magnifier {state.loupeEnabled ? "on" : "off"} · press L to toggle
          </span>
        )}

        {state.tool === "select" && state.selectedIds.length === 0 && (
          <span className="text-text-muted">
            Drag to select · Ctrl+click to toggle · click a label to edit dimensions
          </span>
        )}
      </div>
    </footer>
  );
}

/** Curved undo/redo arrow; "forward" is the mirror image. */
function HistoryArrow({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={direction === "forward" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M8 4L4 8l4 4" />
      <path d="M4 8h8a4.5 4.5 0 010 9H9" />
    </svg>
  );
}

/**
 * Line thickness slider beside the colours: sets the selected strokes, or with none
 * selected the Draw tool's width for new strokes. A whole drag is one undo step.
 */
function EraserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.5 2.5l4 4-6.5 6.5H4l-1.5-1.5a1.4 1.4 0 010-2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6 6l4 4M7 13h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DrawWidthSlider({ drawings, eraser }: { drawings: ShapeAnnotation[]; eraser: boolean }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const undoRecorded = useRef(false);
  const value = eraser
    ? (state.settings.eraserSize ?? ERASER_DEFAULT_SIZE)
    : drawings[0]
      ? drawWidth(drawings[0])
      : (state.settings.drawWidth ?? DRAW_DEFAULT_WIDTH);

  const setWidth = (width: number) => {
    // With the eraser on, the slider sizes the eraser instead of the line.
    if (eraser) {
      dispatch({ type: "UPDATE_SETTINGS", patch: { eraserSize: width } });
      return;
    }
    if (drawings.length > 0) {
      if (!undoRecorded.current) {
        dispatch({ type: "RECORD_UNDO" });
        undoRecorded.current = true;
      }
      for (const shape of drawings) {
        dispatch({ type: "UPDATE_SHAPE", id: shape.id, updates: { strokeWidth: width } });
      }
    }
    dispatch({ type: "UPDATE_SETTINGS", patch: { drawWidth: width } });
  };
  const endChange = () => {
    undoRecorded.current = false;
  };

  return (
    <label className="flex items-center gap-2 text-text-muted" title={eraser ? "Eraser size" : "Line thickness"}>
      {eraser ? "Size" : "Width"}
      <input
        type="range"
        min={eraser ? ERASER_MIN_SIZE : DRAW_MIN_WIDTH}
        max={eraser ? ERASER_MAX_SIZE : DRAW_MAX_WIDTH}
        step={1}
        value={value}
        aria-label={eraser ? "Eraser size in pixels" : "Line thickness in pixels"}
        onChange={(event) => setWidth(Number(event.currentTarget.value))}
        onPointerUp={endChange}
        onKeyUp={endChange}
        onBlur={endChange}
        className="width-slider w-24"
      />
      <span className="w-10 font-mono text-xs text-text-primary">{value} px</span>
    </label>
  );
}
