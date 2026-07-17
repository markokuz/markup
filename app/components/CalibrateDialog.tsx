"use client";

import { FormEvent, useState } from "react";
import type { Unit } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { defaultScreenLabelOffsetDoc, midpoint, pdfDistance } from "@/app/utils/coordinates";
import { UNIT_LABELS } from "@/app/utils/units";

export function CalibrateDialog() {
  const { calibrateDialogOpen, pendingCalibrationLine, documentViewport } = useAppState();
  const dispatch = useAppDispatch();
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<Unit>("ft");
  const [error, setError] = useState("");

  if (!calibrateDialogOpen || !pendingCalibrationLine) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) {
      setError("Enter a positive number.");
      return;
    }

    const pdfDist = pdfDistance(
      pendingCalibrationLine.start,
      pendingCalibrationLine.end,
    );
    if (pdfDist < 1) {
      setError("Selected line is too short. Pick two points farther apart.");
      return;
    }

    const anchorDoc = midpoint(
      pendingCalibrationLine.start,
      pendingCalibrationLine.end,
    );
    const labelOffset = documentViewport
      ? defaultScreenLabelOffsetDoc(documentViewport, anchorDoc)
      : { x: 0, y: -12 };

    dispatch({
      type: "SET_SCALE",
      scale: {
        unitsPerPdfPoint: numeric / pdfDist,
        calibrationUnit: unit,
      },
      calibrationMeasurement: {
        id: crypto.randomUUID(),
        start: pendingCalibrationLine.start,
        end: pendingCalibrationLine.end,
        labelOffset,
        isCalibration: true,
      },
    });
    setValue("");
    setError("");
  };

  const handleClose = () => {
    dispatch({ type: "CLOSE_CALIBRATE_DIALOG" });
    setValue("");
    setError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibrate-title"
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 id="calibrate-title" className="text-lg font-semibold text-white">
          Set known dimension
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Enter the real-world length between the two points you selected.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="calibrate-value"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Length
              </label>
              <input
                id="calibrate-value"
                type="number"
                step="any"
                min="0"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="10"
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <div className="w-36">
              <label
                htmlFor="calibrate-unit"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Unit
              </label>
              <select
                id="calibrate-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              >
                {(Object.keys(UNIT_LABELS) as Unit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
            >
              Apply scale
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
