"use client";

import { useRef, useState } from "react";
import type { AreaMode, CloudMode, DrawMode, EraseMode, ShapeAnnotation, ShapeMode } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ColorWheel } from "@/app/components/ColorWheel";
import { SIDE_TOOLS, ToolIcon } from "@/app/components/SideToolbar";
import { DEFAULT_ANNOTATION_COLOR, MARKUP_PALETTE } from "@/app/utils/colors";
import { TEXT_DEFAULT_SIZE } from "@/app/utils/noteLayout";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { isColorTool } from "@/app/utils/settings";
import {
  areaOutline,
  cutoutCount,
  DRAW_DEFAULT_WIDTH,
  DRAW_MAX_WIDTH,
  HIGHLIGHT_DEFAULT_WIDTH,
  HIGHLIGHT_MAX_WIDTH,
  DRAW_MIN_WIDTH,
  drawWidth,
  ERASER_DEFAULT_SIZE,
  ERASER_MAX_SIZE,
  ERASER_MIN_SIZE,
} from "@/app/utils/shapeMetrics";

interface ModeOption<T extends string> {
  id: T;
  label: string;
  hint: string;
}

const AREA_MODES: ModeOption<AreaMode>[] = [
  {
    id: "add",
    label: "Add",
    hint: "Click corners to measure a new area. Double-click, Enter, or click the first point to finish",
  },
  {
    id: "cut",
    label: "Cut out",
    hint: "Click inside an area, then around the opening to subtract it. Double-click, Enter, or click the first point to finish",
  },
];

const CLOUD_MODES: ModeOption<CloudMode>[] = [
  { id: "rect", label: "Box", hint: "Click two corners for a rectangular cloud" },
  { id: "freehand", label: "Draw", hint: "Drag to draw any outline; it is smoothed into a cloud" },
];

const ERASE_MODES: ModeOption<EraseMode>[] = [
  { id: "rect", label: "Box", hint: "Click two corners of the area to erase" },
  {
    id: "polygon",
    label: "Polygon",
    hint: "Click corners around the area. Double-click, Enter, or click the first point to finish",
  },
  { id: "lasso", label: "Lasso", hint: "Drag around the area to erase" },
];

const SHAPE_MODES: ModeOption<ShapeMode>[] = [
  { id: "ellipse", label: "Ellipse", hint: "Click two corners. Hold Shift for a circle" },
  { id: "arrow", label: "Arrow", hint: "Click the start, then where the arrow points" },
  {
    id: "polygon",
    label: "Polygon",
    hint: "Click corners. Double-click, Enter, or click the first point to finish",
  },
];

/** The Text button holds both text tools. */
const TEXT_TOOLS: ModeOption<"text" | "note">[] = [
  { id: "text", label: "Text", hint: "Click to type free text on the drawing" },
  { id: "note", label: "Note", hint: "Click to add a note card" },
];

const LINE_MODES: ModeOption<DrawMode>[] = [
  { id: "measure", label: "Measure", hint: "Dimension line with its length (needs a scale)" },
  { id: "plain", label: "Plain", hint: "Plain markup line, no measurement" },
];

const RECT_MODES: ModeOption<DrawMode>[] = [
  { id: "measure", label: "Measure", hint: "Rectangle labelled with width and height (needs a scale)" },
  { id: "plain", label: "Plain", hint: "Plain markup box, no measurements" },
];

/**
 * Text box for the first count number. A controlled type="number" input keeps a
 * typed leading zero ("055"), so this edits a digits-only draft instead.
 */
function CountStartInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  // Follow outside changes, e.g. the reset to 1 when the Count tool is reopened.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  return (
    <label
      className="flex items-center gap-1.5 text-xs text-text-muted"
      title="Number for the first item in a new count. Resets to 1 when you reopen the Count tool."
    >
      Start #
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
          setDraft(digits);
          if (digits) {
            const n = parseInt(digits, 10);
            setLastValue(n);
            onChange(n);
          }
        }}
        onBlur={() => {
          if (!draft) {
            setDraft("1");
            setLastValue(1);
            onChange(1);
          }
        }}
        className="input-field w-12 px-1 py-0.5 text-center font-mono text-xs"
      />
    </label>
  );
}

/** Segmented control for the tool in hand's sub-options. */
function ModeToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ModeOption<T>[];
  value: T;
  onChange: (mode: T) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border p-0.5" role="group">
      {options.map((mode) => (
        <button
          key={mode.id}
          type="button"
          title={mode.hint}
          aria-pressed={value === mode.id}
          onClick={() => onChange(mode.id)}
          className={`rounded-[3px] px-2.5 py-0.5 text-xs font-medium transition ${
            value === mode.id
              ? "bg-accent text-white"
              : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Row above the drawing with everything for the tool or selection in hand: modes,
 * colour, width, text style, Delete, and what to do next.
 */
export function ToolOptionsBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.fileBytes) return null;

  const isText = state.tool === "text" || state.tool === "note";
  const countInProgress = state.shapes.some(
    (s) => s.id === state.drawingShapeId && s.kind === "count",
  );
  const sideTool = SIDE_TOOLS.find((tool) => tool.id === (state.tool === "note" ? "text" : state.tool));
  const toolLabel = state.tool === "note" ? "Note" : state.tool === "calibrate" ? "Calibrate" : sideTool?.label;

  const modeToggle = (() => {
    if (isText) {
      return (
        <ModeToggle
          options={TEXT_TOOLS}
          value={state.tool === "note" ? "note" : "text"}
          onChange={(mode) => dispatch({ type: "SET_TOOL", tool: mode })}
        />
      );
    }
    switch (state.tool) {
      case "measure":
        return <ModeToggle options={LINE_MODES} value={state.lineMode} onChange={(mode) => dispatch({ type: "SET_LINE_MODE", mode })} />;
      case "area":
        return (
          <ModeToggle
            options={AREA_MODES}
            value={state.areaMode}
            onChange={(mode) => {
              dispatch({ type: "SET_AREA_MODE", mode });
              if (mode === "cut") {
                showSaveStatus("info", "Click inside an area, then around the opening. Double-click or Enter to finish.");
              }
            }}
          />
        );
      case "rectangle":
        return <ModeToggle options={RECT_MODES} value={state.rectMode} onChange={(mode) => dispatch({ type: "SET_RECT_MODE", mode })} />;
      case "shape":
        return <ModeToggle options={SHAPE_MODES} value={state.shapeMode} onChange={(mode) => dispatch({ type: "SET_SHAPE_MODE", mode })} />;
      case "erase":
        return <ModeToggle options={ERASE_MODES} value={state.eraseMode} onChange={(mode) => dispatch({ type: "SET_ERASE_MODE", mode })} />;
      case "cloud":
        return <ModeToggle options={CLOUD_MODES} value={state.cloudMode} onChange={(mode) => dispatch({ type: "SET_CLOUD_MODE", mode })} />;
      case "count":
        return (
          <div className="flex items-center gap-2">
            <CountStartInput
              value={state.countStart}
              onChange={(start) => dispatch({ type: "SET_COUNT_START", start })}
            />
            <button
              type="button"
              title="Finish this count and start a new one on your next click (or press Enter)"
              disabled={!countInProgress}
              onClick={() => dispatch({ type: "FINISH_SHAPE" })}
              className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-accent transition hover:bg-accent hover:text-white disabled:text-text-muted disabled:hover:bg-transparent"
            >
              New count
            </button>
          </div>
        );
      default:
        return null;
    }
  })();

  const hint =
    state.tool === "select" && state.selectedIds.length >= 2 && state.aligning
      ? "Click a dot to line up · click an item to hold it still · Esc to finish"
      : state.tool === "select" && state.selectedIds.length === 0
        ? "Drag to select · Ctrl+click to toggle · click a label to edit dimensions"
        : state.tool === "note"
          ? "Click to place a note"
          : state.tool === "calibrate"
            ? "Click two points a known distance apart, then type that length"
          : state.tool === "select"
            ? null
            : (sideTool?.hint ?? null);

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
  // With the Text tool and nothing selected, these set the style of the next text placed.
  const showTextStyle = selectedTexts.length > 0 || (state.tool === "text" && colorableIds.length === 0);
  const textSize = Math.round(selectedTexts[0]?.fontSize ?? state.settings.textSize ?? TEXT_DEFAULT_SIZE);
  const textBold = selectedTexts.length > 0 ? selectedTexts.every((s) => s.bold) : Boolean(state.settings.textBold);
  const textItalic = selectedTexts.length > 0 ? selectedTexts.every((s) => s.italic) : Boolean(state.settings.textItalic);
  const updateTexts = (updates: Partial<(typeof selectedTexts)[0]>) => {
    if (selectedTexts.length === 0) return;
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
  // Keeps focus in a text box being typed, which would otherwise end the edit (and drop an empty box).
  const keepTextFocus = (event: React.MouseEvent) => event.preventDefault();

  const selectedDrawings = state.shapes.filter(
    (sh) => sh.kind === "draw" && state.selectedIds.includes(sh.id),
  );
  const drawTool = state.tool === "draw" || state.tool === "highlight";
  // Selected strokes, or the Draw/Highlight tool's width for new strokes when nothing is selected.
  const showDrawWidth =
    selectedDrawings.length > 0 || (colorableIds.length === 0 && drawTool);

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
  const selectedArea =
    state.selectedIds.length === 1
      ? state.shapes.find((s) => s.id === state.selectedIds[0] && s.kind === "area" && !s.locked)
      : undefined;

  return (
    <div className="relative z-20 flex min-h-10 shrink-0 items-center gap-4 border-b border-border bg-surface px-3 py-1 text-sm">
      {/* Controls wrap only when the window is too narrow; the hint gives way first. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      {toolLabel && (
        <div className="flex items-center gap-1.5 text-text-primary">
          <span className="text-accent [&_svg]:h-4 [&_svg]:w-4">
            <ToolIcon tool={state.tool === "note" ? "note" : state.tool} />
          </span>
          <span className="text-xs font-medium uppercase tracking-wider">{toolLabel}</span>
        </div>
      )}

      {modeToggle}

        {state.tool === "select" && state.selectedIds.length >= 2 && (
          <button
            type="button"
            title="Line up the selected items"
            aria-pressed={!!state.aligning}
            onClick={() =>
              dispatch({ type: "SET_ALIGNING", aligning: state.aligning ? null : { anchorId: null } })
            }
            className={`flex h-7 items-center gap-1.5 rounded-md border bg-surface px-2.5 text-xs transition hover:bg-surface-muted ${
              state.aligning ? "border-accent text-accent" : "border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M8 1.5v13" />
              <rect x="3.5" y="3.5" width="9" height="3" rx="0.75" />
              <rect x="5" y="9.5" width="6" height="3" rx="0.75" />
            </svg>
            Align
          </button>
        )}

        {selectedArea && cutoutCount(selectedArea) > 0 && (
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

        {showTextStyle && (
          <div
            className="flex items-center gap-1"
            aria-label="Text style"
            title={selectedTexts.length === 0 ? "Style for the next text you place" : undefined}
          >
            <span className="mr-1 text-text-muted">Size</span>
            <button
              type="button"
              title="Smaller text"
              onMouseDown={keepTextFocus}
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
              onMouseDown={keepTextFocus}
              onClick={() => setTextSize(textSize + (textSize >= 20 ? 4 : 1))}
              className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-surface-muted"
            >
              +
            </button>
            <button
              type="button"
              title="Bold"
              aria-pressed={textBold}
              onMouseDown={keepTextFocus}
              onClick={() => {
                updateTexts({ bold: !textBold });
                dispatch({ type: "UPDATE_SETTINGS", patch: { textBold: !textBold } });
              }}
              className={`ml-1 rounded border px-1.5 py-0.5 text-xs font-bold ${
                textBold ? "border-accent text-accent" : "border-border"
              }`}
            >
              B
            </button>
            <button
              type="button"
              title="Italic"
              aria-pressed={textItalic}
              onMouseDown={keepTextFocus}
              onClick={() => {
                updateTexts({ italic: !textItalic });
                dispatch({ type: "UPDATE_SETTINGS", patch: { textItalic: !textItalic } });
              }}
              className={`rounded border px-1.5 py-0.5 text-xs italic ${
                textItalic ? "border-accent text-accent" : "border-border"
              }`}
            >
              I
            </button>
          </div>
        )}

        {(drawTool || showDrawWidth) && (
          <div className="flex items-center gap-3">
            {drawTool && (
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
                eraser={drawTool && state.drawEraser}
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
                placement="below"
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

        {state.selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: "DELETE_SELECTED" })}
            className="rounded-md border border-red-300 px-2 py-1 text-red-600 transition hover:bg-red-50 dark:border-red-400/50 dark:text-red-400 dark:hover:bg-red-400/10"
          >
            Delete{state.selectedIds.length > 1 ? ` (${state.selectedIds.length})` : ""}
          </button>
        )}
      </div>

      <span className="min-w-0 flex-1 basis-0 truncate text-right text-xs text-text-muted" title={hint ?? undefined}>
        {hint}
        {hint && state.tool !== "pan" && state.tool !== "calibrate" && " · "}
        {state.tool !== "pan" && state.tool !== "calibrate" && `Magnifier ${state.loupeEnabled ? "on" : "off"} (L)`}
      </span>
    </div>
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
  // Highlights keep their own, wider width.
  const highlight = drawings[0] ? Boolean(drawings[0].highlight) : state.tool === "highlight";
  const value = eraser
    ? (state.settings.eraserSize ?? ERASER_DEFAULT_SIZE)
    : drawings[0]
      ? drawWidth(drawings[0])
      : highlight
        ? (state.settings.highlightWidth ?? HIGHLIGHT_DEFAULT_WIDTH)
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
    dispatch({ type: "UPDATE_SETTINGS", patch: highlight ? { highlightWidth: width } : { drawWidth: width } });
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
        max={eraser ? ERASER_MAX_SIZE : highlight ? HIGHLIGHT_MAX_WIDTH : DRAW_MAX_WIDTH}
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
