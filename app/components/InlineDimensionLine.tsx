"use client";

import type { Point2D } from "@/app/types";
import {
  arrowPolygonPoints,
  computeDimensionLayout,
  estimateLabelWidth,
} from "@/app/utils/coordinates";
import { SELECTION_ACCENT } from "@/app/utils/colors";
import { DimensionLabel } from "@/app/components/DimensionLabel";

const ARROW_LEN = 9;
const ARROW_HALF_WIDTH = 4;

interface InlineDimensionLineProps {
  start: Point2D;
  end: Point2D;
  label: string;
  valueInDisplayUnit?: number;
  color: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  displayUnit?: import("@/app/types").Unit;
  isSelected?: boolean;
  showHandles?: boolean;
  isEditing?: boolean;
  interactive?: boolean;
  onSelect?: (shiftKey?: boolean) => void;
  onStartEdit?: () => void;
  onCommit?: (value: number) => void;
  onCancel?: () => void;
  onDragStart?: (event: React.PointerEvent) => void;
  onBodyPointerDown?: (event: React.PointerEvent) => void;
  onEndpointPointerDown?: (
    endpoint: "start" | "end",
    event: React.PointerEvent,
  ) => void;
  showEndpointHandles?: boolean;
}

export function InlineDimensionLine({
  start,
  end,
  label,
  valueInDisplayUnit = 0,
  color,
  strokeWidth = 2,
  strokeDasharray,
  displayUnit = "ft",
  isSelected = false,
  showHandles = false,
  isEditing = false,
  interactive = false,
  onSelect,
  onStartEdit,
  onCommit,
  onCancel,
  onDragStart,
  onBodyPointerDown,
  onEndpointPointerDown,
  showEndpointHandles = false,
}: InlineDimensionLineProps) {
  const labelWidth = estimateLabelWidth(label);
  const layout = computeDimensionLayout(start, end, labelWidth, ARROW_LEN);

  const handleLinePointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    event.stopPropagation();
    if (showHandles && onBodyPointerDown) {
      onBodyPointerDown(event);
    } else {
      onSelect?.(event.shiftKey);
    }
  };

  const lineSegments = layout.showGap
    ? [
        [layout.segment1Start, layout.segment1End] as const,
        [layout.segment2Start, layout.segment2End] as const,
      ]
    : [[layout.fullStart, layout.fullEnd] as const];

  return (
    <g>
      {isSelected &&
        lineSegments.map(([a, b], i) => (
          <line
            key={`halo-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={SELECTION_ACCENT}
            strokeWidth={strokeWidth + 6}
            strokeLinecap="round"
            opacity={0.35}
            style={{ pointerEvents: "none" }}
          />
        ))}
      {lineSegments.map(([a, b], i) => (
        <line
          key={`seg-${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          style={{ pointerEvents: interactive ? "stroke" : "none" }}
          onPointerDown={handleLinePointerDown}
        />
      ))}
      <polygon
        points={arrowPolygonPoints(layout.arrowStart, ARROW_LEN, ARROW_HALF_WIDTH)}
        fill={color}
        style={{ pointerEvents: "none" }}
      />
      <polygon
        points={arrowPolygonPoints(layout.arrowEnd, ARROW_LEN, ARROW_HALF_WIDTH)}
        fill={color}
        style={{ pointerEvents: "none" }}
      />
      {label !== "—" && (
        <g
          transform={`rotate(${layout.angleDeg}, ${layout.labelCenter.x}, ${layout.labelCenter.y})`}
        >
          <DimensionLabel
            x={layout.labelCenter.x}
            y={layout.labelCenter.y}
            label={label}
            valueInDisplayUnit={valueInDisplayUnit}
            color={color}
            displayUnit={displayUnit}
            isSelected={isSelected}
            showHandles={showHandles}
            isEditing={isEditing}
            inline
            clickable={interactive && !showHandles}
            onSelect={() => onSelect?.(false)}
            onStartEdit={() => onStartEdit?.()}
            onCommit={(value) => onCommit?.(value)}
            onCancel={() => onCancel?.()}
            onDragStart={(event) => onDragStart?.(event)}
          />
        </g>
      )}
      {interactive &&
        (layout.showGap ? (
          <>
            <line
              x1={layout.segment1Start.x}
              y1={layout.segment1Start.y}
              x2={layout.segment1End.x}
              y2={layout.segment1End.y}
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
              style={{
                pointerEvents: "stroke",
                cursor: showHandles ? "move" : "pointer",
              }}
              onPointerDown={handleLinePointerDown}
            />
            <line
              x1={layout.segment2Start.x}
              y1={layout.segment2Start.y}
              x2={layout.segment2End.x}
              y2={layout.segment2End.y}
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
              style={{
                pointerEvents: "stroke",
                cursor: showHandles ? "move" : "pointer",
              }}
              onPointerDown={handleLinePointerDown}
            />
          </>
        ) : (
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="transparent"
            strokeWidth={16}
            strokeLinecap="round"
            style={{
              pointerEvents: "stroke",
              cursor: showHandles ? "move" : "pointer",
            }}
            onPointerDown={handleLinePointerDown}
          />
        ))}
      {showEndpointHandles && onEndpointPointerDown && (
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
              onEndpointPointerDown("start", event);
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
              onEndpointPointerDown("end", event);
            }}
          />
        </>
      )}
    </g>
  );
}

interface PreviewDimensionLineProps {
  start: Point2D;
  end: Point2D;
  label: string;
}

export function PreviewDimensionLine({ start, end, label }: PreviewDimensionLineProps) {
  const labelWidth = estimateLabelWidth(label);
  const layout = computeDimensionLayout(start, end, labelWidth, ARROW_LEN);
  const color = "#94a3b8";

  const segments = layout.showGap
    ? [
        [layout.segment1Start, layout.segment1End] as const,
        [layout.segment2Start, layout.segment2End] as const,
      ]
    : [[layout.fullStart, layout.fullEnd] as const];

  return (
    <g pointerEvents="none">
      {segments.map(([a, b], i) => (
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      ))}
      <polygon
        points={arrowPolygonPoints(layout.arrowStart, ARROW_LEN, ARROW_HALF_WIDTH)}
        fill={color}
      />
      <polygon
        points={arrowPolygonPoints(layout.arrowEnd, ARROW_LEN, ARROW_HALF_WIDTH)}
        fill={color}
      />
      {label !== "—" && (
        <g
          transform={`rotate(${layout.angleDeg}, ${layout.labelCenter.x}, ${layout.labelCenter.y})`}
        >
          <text
            x={layout.labelCenter.x}
            y={layout.labelCenter.y}
            fill={color}
            stroke="#ffffff"
            strokeWidth={3}
            fontSize={12}
            fontWeight={600}
            fontFamily="var(--font-geist-mono), monospace"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ paintOrder: "stroke" }}
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
