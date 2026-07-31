"use client";

import type { Point2D } from "@/app/types";
import {
  computeInlineLineSegments,
  estimateLabelWidth,
} from "@/app/utils/coordinates";
import { DimensionLabel } from "@/app/components/DimensionLabel";

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
  const layout = computeInlineLineSegments(start, end, labelWidth);

  const handleLinePointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    event.stopPropagation();
    if (showHandles && onBodyPointerDown) {
      onBodyPointerDown(event);
    } else {
      onSelect?.(event.shiftKey);
    }
  };

  return (
    <g>
      {layout.showGap ? (
        <>
          <line
            x1={layout.segment1Start.x}
            y1={layout.segment1Start.y}
            x2={layout.segment1End.x}
            y2={layout.segment1End.y}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinecap="round"
            style={{ pointerEvents: interactive ? "stroke" : "none" }}
            onPointerDown={handleLinePointerDown}
          />
          <line
            x1={layout.segment2Start.x}
            y1={layout.segment2Start.y}
            x2={layout.segment2End.x}
            y2={layout.segment2End.y}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinecap="round"
            style={{ pointerEvents: interactive ? "stroke" : "none" }}
            onPointerDown={handleLinePointerDown}
          />
        </>
      ) : (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          style={{ pointerEvents: interactive ? "stroke" : "none" }}
          onPointerDown={handleLinePointerDown}
        />
      )}
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
  const layout = computeInlineLineSegments(start, end, labelWidth);
  const color = "#94a3b8";

  return (
    <g pointerEvents="none">
      {layout.showGap ? (
        <>
          <line
            x1={layout.segment1Start.x}
            y1={layout.segment1Start.y}
            x2={layout.segment1End.x}
            y2={layout.segment1End.y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
          <line
            x1={layout.segment2Start.x}
            y1={layout.segment2Start.y}
            x2={layout.segment2End.x}
            y2={layout.segment2End.y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        </>
      ) : (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      )}
      {label !== "—" && (
        <g
          transform={`rotate(${layout.angleDeg}, ${layout.labelCenter.x}, ${layout.labelCenter.y})`}
        >
          <rect
            x={layout.labelCenter.x - labelWidth / 2}
            y={layout.labelCenter.y - 10}
            width={labelWidth}
            height={20}
            rx={4}
            fill="rgba(15, 23, 42, 0.85)"
            stroke={color}
            strokeWidth={1}
          />
          <text
            x={layout.labelCenter.x}
            y={layout.labelCenter.y}
            fill={color}
            fontSize={12}
            fontWeight={600}
            fontFamily="var(--font-geist-mono), monospace"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
