"use client";

import type { Measurement, Scale, Unit } from "@/app/types";
import { getLineLabelDocPosition, toScreenPoint } from "@/app/utils/coordinates";
import { CALIBRATION_COLOR, getAnnotationColor } from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { DimensionLabel } from "@/app/components/DimensionLabel";
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
  const labelDoc = getLineLabelDocPosition(measurement);
  const labelPos = toScreenPoint(viewport, labelDoc.x, labelDoc.y);

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

  return (
    <g
      className="measurement-line"
      onPointerDown={(event) => {
        if (interactive) {
          event.stopPropagation();
          onSelect(measurement.id, event.shiftKey);
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
        style={{ pointerEvents: interactive ? "stroke" : "none" }}
        onPointerDown={(event) => {
          if (!showHandles) return;
          event.stopPropagation();
          onSelect(measurement.id, event.shiftKey);
          onBodyPointerDown(measurement.id, event);
        }}
      />
      {!measurement.isCalibration && (
        <DimensionLabel
          x={labelPos.x}
          y={labelPos.y}
          label={label}
          valueInDisplayUnit={labelValueInDisplayUnit}
          color={color}
          displayUnit={displayUnit}
          isSelected={isSelected}
          showHandles={showHandles && !!scale}
          isEditing={isEditingLength}
          onSelect={() => onSelect(measurement.id, false)}
          onStartEdit={() => onStartEditLength(measurement.id)}
          onCommit={(value) => onCommitLength(measurement.id, value)}
          onCancel={onCancelEdit}
          onDragStart={(event) => onLabelDragStart(measurement.id, event)}
        />
      )}
      {measurement.isCalibration && (
        <>
          <rect
            x={labelPos.x - 4}
            y={labelPos.y - 14}
            width={label.length * 7 + 12}
            height={20}
            rx={4}
            fill="rgba(15, 23, 42, 0.85)"
            stroke={color}
            strokeWidth={1}
            style={{ pointerEvents: "none" }}
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
        </>
      )}
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
            onPointerDown={(event) => {
              event.stopPropagation();
              onEndpointPointerDown(measurement.id, "start", event);
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
            onPointerDown={(event) => {
              event.stopPropagation();
              onEndpointPointerDown(measurement.id, "end", event);
            }}
          />
        </>
      )}
    </g>
  );
}
