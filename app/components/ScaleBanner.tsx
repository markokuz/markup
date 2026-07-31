"use client";

import { useAppState } from "@/app/context/AppContext";
import { formatDistance } from "@/app/utils/units";

export function ScaleBanner() {
  const { scale, fileBytes, fileType } = useAppState();

  if (!fileBytes) return null;

  if (!scale) {
    return (
      <div
        className="rounded-lg border px-4 py-2 text-sm"
        style={{
          borderColor: "var(--warning-border)",
          backgroundColor: "var(--warning-bg)",
          color: "var(--warning-text)",
        }}
      >
        Scale not set - use <strong>Calibrate</strong>{" "}
        and click two points on a known dimension (e.g. a labeled 10&apos; line).
      </div>
    );
  }

  const example =
    fileType === "pdf"
      ? formatDistance(scale.unitsPerPdfPoint * 72, scale.calibrationUnit)
      : formatDistance(scale.unitsPerPdfPoint * 100, scale.calibrationUnit);

  const unitLabel = fileType === "pdf" ? "PDF inch" : "100 px";

  return (
    <div
      className="rounded-lg border px-4 py-2 text-sm"
      style={{
        borderColor: "var(--success-border)",
        backgroundColor: "var(--success-bg)",
        color: "var(--success-text)",
      }}
    >
      Scale calibrated — 1 {unitLabel} ≈{" "}
      <span className="font-mono font-semibold">{example}</span>
    </div>
  );
}
