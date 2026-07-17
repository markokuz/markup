"use client";

import { useAppState } from "@/app/context/AppContext";
import { formatDistance } from "@/app/utils/units";

export function ScaleBanner() {
  const { scale, fileBytes, fileType } = useAppState();

  if (!fileBytes) return null;

  if (!scale) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
        Scale not set — use <strong>Calibrate</strong> and click two points on a
        known dimension (e.g. a labeled 10 ft line).
      </div>
    );
  }

  const example =
    fileType === "pdf"
      ? formatDistance(scale.unitsPerPdfPoint * 72, scale.calibrationUnit)
      : formatDistance(scale.unitsPerPdfPoint * 100, scale.calibrationUnit);

  const unitLabel = fileType === "pdf" ? "PDF inch" : "100 px";

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
      Scale calibrated — 1 {unitLabel} ≈{" "}
      <span className="font-mono font-semibold text-emerald-300">{example}</span>
    </div>
  );
}
