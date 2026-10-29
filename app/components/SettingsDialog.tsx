"use client";

import { useState } from "react";
import type { ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ColorWheel } from "@/app/components/ColorWheel";
import { MARKUP_PALETTE } from "@/app/utils/colors";
import { RESERVED_KEYS, type ColorTool } from "@/app/utils/settings";
import { UNIT_LABELS } from "@/app/utils/units";

const COLOR_TOOLS: { id: ColorTool; label: string }[] = [
  { id: "measure", label: "Line" },
  { id: "area", label: "Area" },
  { id: "count", label: "Count" },
  { id: "rectangle", label: "Rectangle" },
  { id: "cloud", label: "Cloud" },
  { id: "callout", label: "Callout" },
  { id: "note", label: "Note" },
];

const HOTKEY_TOOLS: { id: ToolMode; label: string }[] = [
  ...COLOR_TOOLS,
  { id: "snapshot", label: "Snapshot" },
  { id: "calibrate", label: "Calibrate" },
  { id: "select", label: "Select" },
  { id: "pan", label: "Pan" },
];

const TOOL_LABELS = Object.fromEntries(HOTKEY_TOOLS.map((t) => [t.id, t.label])) as Record<
  ToolMode,
  string
>;

/** Settings button for the header plus the settings dialog it opens. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded-lg p-2 text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
        aria-label="Settings"
        aria-haspopup="dialog"
        title="Settings"
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 4.5h11M2.5 11.5h11" />
          <circle cx="6" cy="4.5" r="1.75" fill="var(--surface)" />
          <circle cx="10" cy="11.5" r="1.75" fill="var(--surface)" />
        </svg>
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CheckRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {title}
        <span className="mt-0.5 block text-xs text-text-muted">{detail}</span>
      </span>
    </label>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { settings } = state;
  const [capturing, setCapturing] = useState<ToolMode | null>(null);
  const [hotkeyNote, setHotkeyNote] = useState("");

  const captureKey = (tool: ToolMode, event: React.KeyboardEvent) => {
    event.preventDefault();
    // Keep the app's own shortcuts from firing while a key is being assigned.
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturing(null);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      dispatch({ type: "SET_HOTKEY", tool, key: "" });
      setHotkeyNote(`${TOOL_LABELS[tool]} has no shortcut now.`);
      setCapturing(null);
      return;
    }
    if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey || event.altKey || key.length !== 1 || key === " ") {
      setHotkeyNote("Use a single letter or number without Ctrl, Alt or Cmd.");
      return;
    }
    if (RESERVED_KEYS.has(key)) {
      setHotkeyNote(`${key.toUpperCase()} is reserved for the magnifier.`);
      return;
    }
    const previous = (Object.keys(settings.hotkeys) as ToolMode[]).find(
      (t) => t !== tool && settings.hotkeys[t] === key,
    );
    dispatch({ type: "SET_HOTKEY", tool, key });
    setHotkeyNote(
      previous
        ? `${key.toUpperCase()} moved from ${TOOL_LABELS[previous]} to ${TOOL_LABELS[tool]}; ${TOOL_LABELS[previous]} has no shortcut now.`
        : "",
    );
    setCapturing(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        // Keys typed in here must not switch tools or trigger the app's other shortcuts.
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !capturing) onClose();
        }}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="settings-title" className="text-lg font-semibold text-text-primary">
            Settings
          </h2>
          <button
            type="button"
            autoFocus
            aria-label="Close settings"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <Section title="General">
            <CheckRow
              checked={state.confirmCloseUnsaved}
              onChange={(enabled) => dispatch({ type: "SET_CONFIRM_CLOSE_UNSAVED", enabled })}
              title="Ask before closing tabs with unsaved changes"
              detail="Also warns before leaving or reloading the page."
            />
            <CheckRow
              checked={state.autoOrientPortrait}
              onChange={(enabled) => dispatch({ type: "SET_AUTO_ORIENT_PORTRAIT", enabled })}
              title="Open portrait pages rotated to 270°"
              detail="For sheets scanned sideways. Applies to newly opened files."
            />
            <CheckRow
              checked={settings.showCalibrationLine}
              onChange={(show) =>
                dispatch({ type: "UPDATE_SETTINGS", patch: { showCalibrationLine: show } })
              }
              title="Show calibration line"
              detail="The dashed line you calibrated with. The scale stays set when it's hidden, and it's never exported."
            />
          </Section>

          <Section title="Line snapping">
            <CheckRow
              checked={state.snapLines}
              onChange={(enabled) => dispatch({ type: "SET_SNAP_LINES", enabled })}
              title="Snap lines while drawing"
              detail="Lines close to a snap angle are straightened to it."
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-6 text-sm">
              <label className="flex items-center gap-2 text-text-secondary">
                Snap to
                <select
                  disabled={!state.snapLines}
                  value={settings.snapStepDeg}
                  onChange={(event) =>
                    dispatch({
                      type: "UPDATE_SETTINGS",
                      patch: { snapStepDeg: Number(event.target.value) as 90 | 45 },
                    })
                  }
                  className="rounded border border-border bg-surface px-2 py-1 text-text-primary disabled:opacity-50"
                >
                  <option value={90}>90° (flat / plumb)</option>
                  <option value={45}>45° (adds diagonals)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-text-secondary">
                within
                <input
                  type="number"
                  min={1}
                  max={15}
                  disabled={!state.snapLines}
                  value={settings.snapToleranceDeg}
                  onChange={(event) => {
                    const value = Math.min(15, Math.max(1, Number(event.target.value) || 1));
                    dispatch({ type: "UPDATE_SETTINGS", patch: { snapToleranceDeg: value } });
                  }}
                  className="w-14 rounded border border-border bg-surface px-2 py-1 text-text-primary disabled:opacity-50"
                />
                degrees
              </label>
            </div>
          </Section>

          <Section title="Units">
            <label className="flex items-center justify-between gap-4 text-sm text-text-primary">
              <span>
                Default unit
                <span className="mt-0.5 block text-xs text-text-muted">
                  Used for measurements and calibration when the app opens.
                </span>
              </span>
              <select
                value={settings.defaultUnit}
                onChange={(event) => {
                  const unit = event.target.value as Unit;
                  dispatch({ type: "UPDATE_SETTINGS", patch: { defaultUnit: unit } });
                  dispatch({ type: "SET_DISPLAY_UNIT", unit });
                }}
                className="rounded border border-border bg-surface px-2 py-1"
              >
                {(Object.keys(UNIT_LABELS) as Unit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title="Default colours">
            {COLOR_TOOLS.map((tool) => {
              const current = settings.toolColors[tool.id];
              return (
                <div key={tool.id} className="flex items-center gap-3 text-sm">
                  <span className="w-20 text-text-primary">{tool.label}</span>
                  <div className="flex flex-1 flex-wrap items-center gap-1">
                    {MARKUP_PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        title={`Set ${tool.label} colour ${color}`}
                        aria-pressed={current === color}
                        onClick={() => dispatch({ type: "SET_TOOL_COLOR", tool: tool.id, color })}
                        className={`h-5 w-5 rounded-full border-2 transition ${
                          current === color ? "border-text-primary" : "border-transparent"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <ColorWheel
                      value={current}
                      placement="below"
                      onChange={(color) => dispatch({ type: "SET_TOOL_COLOR", tool: tool.id, color })}
                    />
                  </div>
                  <span
                    className="h-6 w-6 shrink-0 rounded border border-border"
                    style={{ backgroundColor: current }}
                    title={current}
                  />
                </div>
              );
            })}
          </Section>

          <Section title="Keyboard shortcuts">
            <p className="text-xs text-text-muted">
              Click a box and press a key. Backspace clears it. L is kept for the magnifier.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {HOTKEY_TOOLS.map((tool) => {
                const key = settings.hotkeys[tool.id];
                const isCapturing = capturing === tool.id;
                return (
                  <div key={tool.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-primary">{tool.label}</span>
                    <button
                      type="button"
                      aria-label={`Shortcut for ${tool.label}: ${key ? key.toUpperCase() : "none"}`}
                      onClick={() => {
                        setHotkeyNote("");
                        setCapturing(isCapturing ? null : tool.id);
                      }}
                      onKeyDown={(event) => {
                        if (isCapturing) captureKey(tool.id, event);
                      }}
                      onBlur={() => {
                        if (isCapturing) setCapturing(null);
                      }}
                      className={`min-w-[5.5rem] rounded border px-2 py-1 font-mono text-xs transition ${
                        isCapturing
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface-muted text-text-primary hover:border-text-secondary"
                      }`}
                    >
                      {isCapturing ? "Press a key…" : key ? key.toUpperCase() : "—"}
                    </button>
                  </div>
                );
              })}
            </div>
            {hotkeyNote && (
              <p role="status" className="text-xs text-accent">
                {hotkeyNote}
              </p>
            )}
          </Section>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "RESET_SETTINGS" });
              setHotkeyNote("Colours, shortcuts, units and snap settings were reset.");
            }}
            className="text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
          >
            Reset to defaults
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
