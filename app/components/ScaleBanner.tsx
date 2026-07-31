"use client";

import { useAppState } from "@/app/context/AppContext";

export function ScaleBanner() {
  const { scale, fileBytes } = useAppState();

  if (!fileBytes || scale) return null;

  return (
    <div className="border-b border-border px-4 py-2">
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
    </div>
  );
}
