"use client";

import type { Measurement, Scale, Unit } from "@/app/types";
import { toScreenPoint, estimateLabelWidth } from "@/app/utils/coordinates";
import { CALIBRATION_COLOR, getAnnotationColor } from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { InlineDimensionLine } from "@/app/components/InlineDimensionLine";
import type { DocumentViewport } from "@/app/utils/documentViewport";

function getMeasurementValueInDisplayUnit(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): number {
  const dist = Math.hypot(
    measurement.end.x - measurement.start.x,
    measurement.end.y - measurement.start.y,
  );
  return convertUnits(
    dist * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
}

function getDisplayDistance(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): string {
  return formatDistance(
    getMeasurementValueInDisplayUnit(measurement, scale, displayUnit),
    displayUnit,
  );
}

interface MeasurementLineProps {
  measurement: Measurement;
  viewport: DocumentViewport;
  scale: Scale | null;
  displayUnit: Unit;
  isSelected: boolean;
  isSelectMode: boolean;
  showHandles: boolean;
  isEditingLength: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onEndpointPointerDown: (
    id: string,
    endpoint: "start" | "end",
    event: React.PointerEvent,
  ) => void;
  onBodyPointerDown: (id: string, event: React.PointerEvent) => void;
  onLabelDragStart: (id: string, event: React.PointerEvent) => void;
  onStartEditLength: (id: string) => void;
  onCommitLength: (id: string, value: number) => void;
  onCancelEdit: () => void;
}

export function MeasurementLine({
  measurement,
  viewport,
  scale,
  displayUnit,
  isSelected,
  isSelectMode,
  showHandles,
  isEditingLength,
  onSelect,
  onEndpointPointerDown,
  onBodyPointerDown,
  onLabelDragStart,
  onStartEditLength,
  onCommitLength,
  onCancelEdit,
}: MeasurementLineProps) {
  const start = toScreenPoint(viewport, measurement.start.x, measurement.start.y);
  const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);

  const color = measurement.isCalibration
    ? CALIBRATION_COLOR
    : getAnnotationColor(measurement, isSelected);
  const strokeWidth = isSelected ? 2.5 : 2;
  const label =
    scale && !measurement.isCalibration
      ? getDisplayDistance(measurement, scale, displayUnit)
      : measurement.isCalibration
        ? "Calibration"
        : "—";
  const labelValueInDisplayUnit =
    scale && !measurement.isCalibration
      ? getMeasurementValueInDisplayUnit(measurement, scale, displayUnit)
      : 0;
  const interactive = isSelectMode && !measurement.isCalibration;

  if (measurement.isCalibration) {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const calLabelWidth = estimateLabelWidth("Calibration");
    return (
      <g className="measurement-line" style={{ pointerEvents: "none" }}>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray="8 5"
          strokeLinecap="round"
        />
        <rect
          x={mid.x - calLabelWidth / 2}
          y={mid.y - 10}
          width={calLabelWidth}
          height={20}
          rx={4}
          fill="rgba(15, 23, 42, 0.85)"
          stroke={color}
          strokeWidth={1}
        />
        <text
          x={mid.x - calLabelWidth / 2 + 6}
          y={mid.y + 4}
          fill={color}
          fontSize={12}
          fontWeight={600}
          fontFamily="var(--font-geist-mono), monospace"
        >
          Calibration
        </text>
      </g>
    );
  }

  return (
    <InlineDimensionLine
      start={start}
      end={end}
      label={label}
      valueInDisplayUnit={labelValueInDisplayUnit}
      color={color}
      strokeWidth={strokeWidth}
      displayUnit={displayUnit}
      isSelected={isSelected}
      showHandles={showHandles && !!scale}
      isEditing={isEditingLength}
      interactive={interactive}
      showEndpointHandles={showHandles && isSelected}
      onSelect={(shiftKey) => onSelect(measurement.id, shiftKey ?? false)}
      onBodyPointerDown={(event) => {
        onSelect(measurement.id, event.shiftKey);
        onBodyPointerDown(measurement.id, event);
      }}
      onEndpointPointerDown={(endpoint, event) =>
        onEndpointPointerDown(measurement.id, endpoint, event)
      }
      onStartEdit={() => onStartEditLength(measurement.id)}
      onCommit={(value) => onCommitLength(measurement.id, value)}
      onCancel={onCancelEdit}
      onDragStart={(event) => onLabelDragStart(measurement.id, event)}
    />
  );
}
