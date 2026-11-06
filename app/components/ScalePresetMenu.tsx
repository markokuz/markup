"use client";

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { SCALE_PRESET_GROUPS, type ScalePreset } from "@/app/utils/scalePresets";
import { showSaveStatus } from "@/app/utils/saveStatus";

/** Dropdown beside Calibrate: set a PDF sheet's scale from its title block, no clicking on the drawing. */
export function ScalePresetMenu() {
  const { sheets } = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [allSheets, setAllSheets] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetCount = sheets?.length ?? 1;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const apply = ({ label, scale }: ScalePreset) => {
    const everySheet = allSheets && sheetCount > 1;
    dispatch({ type: "SET_SCALE", scale, allSheets: everySheet });
    setOpen(false);
    showSaveStatus(
      "success",
      `Scale set to ${label}${everySheet ? ` on all ${sheetCount} sheets` : ""}.`,
      "Check a known dimension: a set printed to fit won't match its stated scale.",
    );
  };

  return (
    <div ref={rootRef} className="relative flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Set a standard scale"
        title="Set a standard scale, like 1/4&quot; = 1'-0&quot;"
        onClick={() => setOpen((was) => !was)}
        className="flex w-7 items-center justify-center rounded-r-[7px] border-l border-border text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
      >
        <svg aria-hidden viewBox="0 0 12 12" className="h-3.5 w-3.5">
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-52 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {sheetCount > 1 && (
            <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-text-primary">
              <input type="checkbox" checked={allSheets} onChange={(event) => setAllSheets(event.target.checked)} />
              Use on all {sheetCount} sheets
            </label>
          )}
          {SCALE_PRESET_GROUPS.map((group) => (
            <div key={group.name}>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {group.name}
              </div>
              {group.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  role="menuitem"
                  onClick={() => apply(preset)}
                  className="block w-full px-3 py-1 text-left font-mono text-xs text-text-primary transition hover:bg-surface-muted"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
