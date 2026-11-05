"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ToolMode, Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ColorWheel } from "@/app/components/ColorWheel";
import { MARKUP_PALETTE } from "@/app/utils/colors";
import { RESERVED_KEYS, type ColorTool } from "@/app/utils/settings";
import { UNIT_LABELS } from "@/app/utils/units";

const COLOR_TOOLS: { id: ColorTool; label: string }[] = [
  { id: "measure", label: "Line" },
  { id: "area", label: "Area" },
  { id: "polyline", label: "Run" },
  { id: "count", label: "Count" },
  { id: "rectangle", label: "Rectangle" },
  { id: "cloud", label: "Cloud" },
  { id: "draw", label: "Draw" },
  { id: "callout", label: "Callout" },
  { id: "text", label: "Text" },
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

type SettingsTab = "general" | "snapping" | "colours" | "shortcuts";

const TABS: { id: SettingsTab; label: string; detail: string; icon: React.ReactNode }[] = [
  {
    id: "general",
    label: "General",
    detail: "How the app looks and behaves.",
    icon: (
      <>
        <path d="M2.5 4.5h1.75M7.75 4.5h5.75M2.5 11.5h5.75M11.75 11.5h1.75" />
        <circle cx="6" cy="4.5" r="1.75" />
        <circle cx="10" cy="11.5" r="1.75" />
      </>
    ),
  },
  {
    id: "snapping",
    label: "Snapping",
    detail: "How lines and rotation straighten up while you work.",
    icon: <path d="M3 3v5a5 5 0 0 0 10 0V3h-3v5a2 2 0 0 1-4 0V3H3z" />,
  },
  {
    id: "colours",
    label: "Colours",
    detail: "The colour each tool starts with.",
    icon: <path d="M8 2s4.5 4.4 4.5 7.5a4.5 4.5 0 0 1-9 0C3.5 6.4 8 2 8 2z" />,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    detail: "Click a box and press a key. Backspace clears it. L is kept for the magnifier.",
    icon: (
      <>
        <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
        <path d="M4.5 7h.01M7 7h.01M9.5 7h.01M11.5 7h.01M5.5 9.5h5" />
      </>
    ),
  },
];

const ARROW_STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** Settings button for the header plus the settings dialog it opens. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
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
  const [tab, setTab] = useState<SettingsTab>("general");
  const [capturing, setCapturing] = useState<ToolMode | null>(null);
  const [hotkeyNote, setHotkeyNote] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  const closeResetConfirm = () => {
    // The focused button is about to unmount; without this, focus falls out of the dialog.
    flushSync(() => setConfirmingReset(false));
    resetButtonRef.current?.focus();
  };

  const selectTab = (next: SettingsTab) => {
    setTab(next);
    setHotkeyNote("");
  };

  const handleTabKeyDown = (event: React.KeyboardEvent) => {
    const step = ARROW_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length].id;
    selectTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };

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
          if (event.key !== "Escape" || capturing) return;
          if (confirmingReset) closeResetConfirm();
          else onClose();
        }}
        className="flex h-[min(38rem,90vh)] w-full max-w-3xl flex-col gap-3 sm:flex-row"
      >
        <aside className="shrink-0 rounded-2xl border border-border bg-surface p-3 shadow-xl sm:w-52 sm:self-start">
          <h2 id="settings-title" className="mb-3 px-2 pt-1 text-lg font-semibold text-text-primary">
            Settings
          </h2>
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-labelledby="settings-title"
            onKeyDown={handleTabKeyDown}
            className="grid grid-cols-2 gap-1 sm:flex sm:flex-col"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`settings-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls="settings-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => selectTab(t.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                  tab === t.id
                    ? "bg-text-primary text-surface"
                    : "text-text-primary hover:bg-surface-muted"
                }`}
              >
                <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                  {t.icon}
                </svg>
                {t.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{activeTab.label}</h3>
              <p className="mt-0.5 text-sm text-text-secondary">{activeTab.detail}</p>
            </div>
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

          {/* Keyed so each tab opens scrolled to its top. */}
          <div
            key={tab}
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-2"
          >
            {tab === "general" && (
              <div className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-2">
                <CheckRow
                  checked={settings.darkMode}
                  onChange={(darkMode) => dispatch({ type: "UPDATE_SETTINGS", patch: { darkMode } })}
                  title="Dark mode"
                  detail="Darkens the app around your drawing. Pages and exports don't change."
                />
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
              </div>
            )}

            {tab === "snapping" && (
              <div className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-2">
                <div className="space-y-3">
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
                </div>
                <CheckRow
                  checked={settings.snapRotation}
                  onChange={(snap) => dispatch({ type: "UPDATE_SETTINGS", patch: { snapRotation: snap } })}
                  title="Snap rotation to 45° and 90°"
                  detail="Rotating a markup sticks to these angles when close. Hold Shift for 15° steps."
                />
              </div>
            )}

            {tab === "colours" && (
              <div className="space-y-3 py-2">
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
              </div>
            )}

            {tab === "shortcuts" && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 py-2">
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
            )}
          </div>

          {/* Out here, not in a tab, so Reset's message shows from whichever tab is open. */}
          {hotkeyNote && (
            <p role="status" className="px-6 pb-2 pt-1 text-xs text-accent">
              {hotkeyNote}
            </p>
          )}

          {confirmingReset ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-6 py-3">
              <p role="alert" className="min-w-0 flex-1 basis-56 text-sm text-text-primary">
                Reset colours, shortcuts, units, snapping and the calibration line to their defaults?
              </p>
              <div className="flex shrink-0 gap-2">
                <button type="button" autoFocus onClick={closeResetConfirm} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "RESET_SETTINGS" });
                    setHotkeyNote("Colours, shortcuts, units, snapping and the calibration line were reset.");
                    closeResetConfirm();
                  }}
                  className="rounded-lg border border-red-600/30 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-600/10 dark:border-red-400/50 dark:text-red-400 dark:hover:bg-red-400/10"
                >
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-border px-6 py-3">
              <button
                ref={resetButtonRef}
                type="button"
                onClick={() => {
                  setHotkeyNote("");
                  setConfirmingReset(true);
                }}
                className="text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
              >
                Reset to defaults
              </button>
              <button type="button" onClick={onClose} className="btn-secondary">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
