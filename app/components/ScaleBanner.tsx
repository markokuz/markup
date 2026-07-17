"use client";

import { useAppState } from "@/app/context/AppContext";
import { formatDistance } from "@/app/utils/units";

export function ScaleBanner() {
  const { scale, pdfBytes } = useAppState();

  if (!pdfBytes) return null;

  if (!scale) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
        Scale not set — use <strong>Calibrate</strong> and click two points on a
        known dimension (e.g. a labeled 10 ft line).
      </div>
    );
  }

  const example = formatDistance(scale.unitsPerPdfPoint * 72, scale.calibrationUnit);

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
      Scale calibrated — 1 PDF inch ≈{" "}
      <span className="font-mono font-semibold text-emerald-300">{example}</span>
    </div>
  );
}
