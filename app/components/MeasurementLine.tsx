"use client";

import type { Measurement, Scale, Unit } from "@/app/types";
import { midpoint, toScreenPoint } from "@/app/utils/coordinates";
import { convertUnits, formatDistance } from "@/app/utils/units";
import type { DocumentViewport } from "@/app/utils/documentViewport";

// Re-export pdfDistance from coordinates - fix import in MeasurementLine
function getDisplayDistance(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): string {
  const dist = Math.hypot(
    measurement.end.x - measurement.start.x,
    measurement.end.y - measurement.start.y,
  );
  const value = convertUnits(
    dist * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}

interface MeasurementLineProps {
  measurement: Measurement;
  viewport: DocumentViewport;
  scale: Scale | null;
  displayUnit: Unit;
  isSelected: boolean;
  showHandles: boolean;
  onSelect: (id: string) => void;
  onEndpointPointerDown: (
    id: string,
    endpoint: "start" | "end",
    event: React.PointerEvent,
  ) => void;
  onBodyPointerDown: (id: string, event: React.PointerEvent) => void;
  onLabelPointerDown: (id: string, event: React.PointerEvent) => void;
}

export function MeasurementLine({
  measurement,
  viewport,
  scale,
  displayUnit,
  isSelected,
  showHandles,
  onSelect,
  onEndpointPointerDown,
  onBodyPointerDown,
  onLabelPointerDown,
}: MeasurementLineProps) {
  const start = toScreenPoint(viewport, measurement.start.x, measurement.start.y);
  const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);
  const mid = midpoint(start, end);
  const labelPos = {
    x: mid.x + measurement.labelOffset.x,
    y: mid.y + measurement.labelOffset.y,
  };

  const color = measurement.isCalibration
    ? "#f59e0b"
    : isSelected
      ? "#22d3ee"
      : "#06b6d4";
  const strokeWidth = isSelected ? 2.5 : 2;
  const label =
    scale && !measurement.isCalibration
      ? getDisplayDistance(measurement, scale, displayUnit)
      : measurement.isCalibration
        ? "Calibration"
        : "—";

  return (
    <g
      className="measurement-line"
      onPointerDown={(e) => {
        if (showHandles) {
          e.stopPropagation();
          onSelect(measurement.id);
        }
      }}
    >
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={measurement.isCalibration ? "8 5" : undefined}
        strokeLinecap="round"
        style={{ pointerEvents: showHandles ? "stroke" : "none" }}
        onPointerDown={(e) => {
          if (!showHandles) return;
          e.stopPropagation();
          onSelect(measurement.id);
          onBodyPointerDown(measurement.id, e);
        }}
      />
      <rect
        x={labelPos.x - 4}
        y={labelPos.y - 14}
        width={label.length * 7 + 12}
        height={20}
        rx={4}
        fill="rgba(15, 23, 42, 0.85)"
        stroke={color}
        strokeWidth={1}
        style={{ pointerEvents: showHandles ? "all" : "none", cursor: showHandles ? "move" : "default" }}
        onPointerDown={(e) => {
          if (!showHandles) return;
          e.stopPropagation();
          onSelect(measurement.id);
          onLabelPointerDown(measurement.id, e);
        }}
      />
      <text
        x={labelPos.x + 2}
        y={labelPos.y}
        fill={color}
        fontSize={12}
        fontWeight={600}
        fontFamily="var(--font-geist-mono), monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
      {showHandles && isSelected && !measurement.isCalibration && (
        <>
          <circle
            cx={start.x}
            cy={start.y}
            r={7}
            fill="#0f172a"
            stroke={color}
            strokeWidth={2}
            style={{ cursor: "crosshair", pointerEvents: "all" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onEndpointPointerDown(measurement.id, "start", e);
            }}
          />
          <circle
            cx={end.x}
            cy={end.y}
            r={7}
            fill="#0f172a"
            stroke={color}
            strokeWidth={2}
            style={{ cursor: "crosshair", pointerEvents: "all" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onEndpointPointerDown(measurement.id, "end", e);
            }}
          />
        </>
      )}
    </g>
  );
}
