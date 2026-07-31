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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibrate-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id="calibrate-title" className="text-lg font-semibold text-text-primary">
          Set known dimension
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Enter the real-world length between the two points you selected.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="calibrate-value"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary"
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
                className="input-field w-full px-3 py-2"
              />
            </div>
            <div className="w-36">
              <label
                htmlFor="calibrate-unit"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Unit
              </label>
              <select
                id="calibrate-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="input-field w-full px-3 py-2"
              >
                {(Object.keys(UNIT_LABELS) as Unit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Apply scale
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
