"use client";

import { Fragment, useState } from "react";
import type { CloudMode, DrawMode, ToolMode } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "measure", label: "Line", hint: "Draw dimension lines" },
  {
    id: "area",
    label: "Area",
    hint: "Click corners to measure area and perimeter. Double-click, Enter, or click the first point to finish",
  },
  {
    id: "count",
    label: "Count",
    hint: "Click each item to count it. Press Enter or Esc to start a new count",
  },
  { id: "rectangle", label: "Rect", hint: "Click two corners to draw a rectangle" },
  { id: "cloud", label: "Cloud", hint: "Click two corners to draw a revision cloud" },
  { id: "callout", label: "Callout", hint: "Click the point to call out, then where the text goes" },
  { id: "note", label: "Note", hint: "Click to add a text note" },
  {
    id: "snapshot",
    label: "Snap",
    hint: "Click two corners to copy that part of the drawing, background removed. Paste with Ctrl+V",
  },
  { id: "select", label: "Select", hint: "Move and edit measurements" },
  { id: "pan", label: "Pan", hint: "Drag to move, or hold middle mouse button" },
];

interface ModeOption<T extends string> {
  id: T;
  label: string;
  hint: string;
}

const CLOUD_MODES: ModeOption<CloudMode>[] = [
  { id: "rect", label: "Box", hint: "Click two corners for a rectangular cloud" },
  { id: "freehand", label: "Draw", hint: "Drag to draw any outline; it is smoothed into a cloud" },
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
      className="flex flex-col items-center gap-0.5 text-[9px] font-medium text-text-secondary"
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
        className="w-full rounded border border-border bg-surface px-0.5 py-0.5 text-center text-[11px] text-text-primary"
      />
    </label>
  );
}

/** Small stacked toggle shown under the active tool for its sub-options. */
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
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-muted p-0.5">
      {options.map((mode) => (
        <button
          key={mode.id}
          type="button"
          title={mode.hint}
          aria-pressed={value === mode.id}
          onClick={() => onChange(mode.id)}
          className={`rounded-md py-1 text-[9px] font-medium transition ${
            value === mode.id
              ? "bg-surface text-accent shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

export function SideToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.fileBytes) return null;

  const countInProgress = state.shapes.some(
    (s) => s.id === state.drawingShapeId && s.kind === "count",
  );

  return (
    <aside className="flex w-14 shrink-0 flex-col gap-1 border-r border-border bg-surface p-2">
      {TOOLS.map((tool) => (
        <Fragment key={tool.id}>
          <button
            type="button"
            title={
              state.settings.hotkeys[tool.id]
                ? `${tool.hint} (${state.settings.hotkeys[tool.id].toUpperCase()})`
                : tool.hint
            }
            onClick={() => dispatch({ type: "SET_TOOL", tool: tool.id })}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition ${
              state.tool === tool.id
                ? "bg-accent text-white shadow-sm"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            }`}
          >
            <ToolIcon tool={tool.id} />
            <span>{tool.label}</span>
          </button>
          {tool.id === "measure" && state.tool === "measure" && (
            <ModeToggle
              options={LINE_MODES}
              value={state.lineMode}
              onChange={(mode) => dispatch({ type: "SET_LINE_MODE", mode })}
            />
          )}
          {tool.id === "rectangle" && state.tool === "rectangle" && (
            <ModeToggle
              options={RECT_MODES}
              value={state.rectMode}
              onChange={(mode) => dispatch({ type: "SET_RECT_MODE", mode })}
            />
          )}
          {tool.id === "cloud" && state.tool === "cloud" && (
            <ModeToggle
              options={CLOUD_MODES}
              value={state.cloudMode}
              onChange={(mode) => dispatch({ type: "SET_CLOUD_MODE", mode })}
            />
          )}
          {tool.id === "count" && state.tool === "count" && (
            <div className="flex flex-col gap-1 rounded-lg bg-surface-muted p-1">
              <CountStartInput
                value={state.countStart}
                onChange={(start) => dispatch({ type: "SET_COUNT_START", start })}
              />
              <button
                type="button"
                title="Finish this count and start a new one on your next click (or press Enter)"
                disabled={!countInProgress}
                onClick={() => dispatch({ type: "FINISH_SHAPE" })}
                className="rounded-md bg-surface py-1 text-[9px] font-medium text-accent shadow-sm transition hover:bg-accent hover:text-white disabled:bg-transparent disabled:text-text-muted disabled:shadow-none"
              >
                New
              </button>
            </div>
          )}
        </Fragment>
      ))}
    </aside>
  );
}

function ToolIcon({ tool }: { tool: ToolMode }) {
  switch (tool) {
    case "measure":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="3" cy="17" r="2" fill="currentColor" />
          <circle cx="17" cy="3" r="2" fill="currentColor" />
        </svg>
      );
    case "rectangle":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect
            x="3"
            y="5"
            width="14"
            height="10"
            stroke="currentColor"
            strokeWidth="1.5"
            rx="1"
          />
        </svg>
      );
    case "select":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M4 3 L4 14 L8 10 L11 17 L13 16 L10 9 L15 9 Z"
            fill="currentColor"
          />
        </svg>
      );
    case "pan":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 3 C8 3 7 5 7 6 L5 8 C4 9 4 11 5 12 L8 15 C9 16 11 16 12 15 L14 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M13 5 L16 8 M16 5 L13 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "note":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect
            x="3"
            y="4"
            width="14"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line x1="6" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "area":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 15 L5 4 L15 3 L17 13 Z"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "count":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="6" cy="7" r="3" fill="currentColor" />
          <circle cx="14" cy="7" r="3" fill="currentColor" />
          <circle cx="10" cy="14" r="3" fill="currentColor" />
        </svg>
      );
    case "cloud":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M4 6 A2 2 0 0 1 8 5 A2 2 0 0 1 12 5 A2 2 0 0 1 16 6 A2 2 0 0 1 16 10 A2 2 0 0 1 16 14 A2 2 0 0 1 12 15 A2 2 0 0 1 8 15 A2 2 0 0 1 4 14 A2 2 0 0 1 4 10 A2 2 0 0 1 4 6 Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case "callout":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="8" y="3" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="7" x2="3.5" y2="16" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 18 L3 13.5 L6 15.5 Z" fill="currentColor" />
        </svg>
      );
    case "snapshot":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 7a1.5 1.5 0 011.5-1.5h2L8 3.5h4l1.5 2h2A1.5 1.5 0 0117 7v8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
}
