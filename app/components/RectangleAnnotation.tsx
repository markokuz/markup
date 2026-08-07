"use client";

import type { DocumentType, RectMeasurement, Scale, Unit } from "@/app/types";
import {
  computeInlineEdgeSegments,
  estimateLabelWidth,
  getScreenRectEdgeDocLengths,
  toScreenRect,
} from "@/app/utils/coordinates";
import { getAnnotationColor } from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { DimensionLabel } from "@/app/components/DimensionLabel";
import type { DocumentViewport } from "@/app/utils/documentViewport";

function getDimensionValueInDisplayUnit(
  docLength: number,
  scale: Scale,
  displayUnit: Unit,
): number {
  return convertUnits(
    docLength * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
}

function getDisplayDistance(
  docLength: number,
  scale: Scale,
  displayUnit: Unit,
): string {
  return formatDistance(
    getDimensionValueInDisplayUnit(docLength, scale, displayUnit),
    displayUnit,
  );
}

type RectCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

interface RectangleAnnotationProps {
  rectangle: RectMeasurement;
  viewport: DocumentViewport;
  fileType: DocumentType;
  scale: Scale | null;
  displayUnit: Unit;
  isSelected: boolean;
  isSelectMode: boolean;
  showHandles: boolean;
  editingField: "width" | "height" | null;
  onSelect: (id: string, shiftKey: boolean) => void;
  onBodyPointerDown: (id: string, event: React.PointerEvent) => void;
  onCornerPointerDown: (
    id: string,
    corner: RectCorner,
    event: React.PointerEvent,
  ) => void;
  onWidthLabelDragStart: (id: string, event: React.PointerEvent) => void;
  onHeightLabelDragStart: (id: string, event: React.PointerEvent) => void;
  onStartEditWidth: (id: string) => void;
  onStartEditHeight: (id: string) => void;
  onCommitWidth: (id: string, value: number) => void;
  onCommitHeight: (id: string, value: number) => void;
  onCancelEdit: () => void;
}

interface EdgeLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  isSelectMode: boolean;
  showHandles: boolean;
  onEdgePointerDown: (event: React.PointerEvent) => void;
}

function EdgeLine({
  x1,
  y1,
  x2,
  y2,
  color,
  strokeWidth,
  isSelectMode,
  showHandles,
  onEdgePointerDown,
}: EdgeLineProps) {
  const interactive = isSelectMode || showHandles;

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={strokeWidth}
        style={{
          pointerEvents: interactive ? "stroke" : "none",
          cursor: showHandles ? "move" : isSelectMode ? "pointer" : "default",
        }}
        onPointerDown={onEdgePointerDown}
      />
      {showHandles && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={12}
          style={{ pointerEvents: "stroke", cursor: "move" }}
          onPointerDown={onEdgePointerDown}
        />
      )}
    </g>
  );
}

function renderEdgeSegment(
  layout: ReturnType<typeof computeInlineEdgeSegments>,
  color: string,
  strokeWidth: number,
  isSelectMode: boolean,
  showHandles: boolean,
  onEdgePointerDown: (event: React.PointerEvent) => void,
  key: string,
) {
  if (!layout.showGap) {
    return (
      <EdgeLine
        key={key}
        x1={layout.segment1Start.x}
        y1={layout.segment1Start.y}
        x2={layout.segment1End.x}
        y2={layout.segment1End.y}
        color={color}
        strokeWidth={strokeWidth}
        isSelectMode={isSelectMode}
        showHandles={showHandles}
        onEdgePointerDown={onEdgePointerDown}
      />
    );
  }
  return (
    <g key={key}>
      <EdgeLine
        x1={layout.segment1Start.x}
        y1={layout.segment1Start.y}
        x2={layout.segment1End.x}
        y2={layout.segment1End.y}
        color={color}
        strokeWidth={strokeWidth}
        isSelectMode={isSelectMode}
        showHandles={showHandles}
        onEdgePointerDown={onEdgePointerDown}
      />
      <EdgeLine
        x1={layout.segment2Start.x}
        y1={layout.segment2Start.y}
        x2={layout.segment2End.x}
        y2={layout.segment2End.y}
        color={color}
        strokeWidth={strokeWidth}
        isSelectMode={isSelectMode}
        showHandles={showHandles}
        onEdgePointerDown={onEdgePointerDown}
      />
    </g>
  );
}

export function RectangleAnnotation({
  rectangle,
  viewport,
  fileType: _fileType,
  scale,
  displayUnit,
  isSelected,
  isSelectMode,
  showHandles,
  editingField,
  onSelect,
  onBodyPointerDown,
  onCornerPointerDown,
  onWidthLabelDragStart,
  onHeightLabelDragStart,
  onStartEditWidth,
  onStartEditHeight,
  onCommitWidth,
  onCommitHeight,
  onCancelEdit,
}: RectangleAnnotationProps) {
  const { x, y, width, height } = toScreenRect(
    viewport,
    rectangle.topLeft,
    rectangle.bottomRight,
  );

  const color = getAnnotationColor(rectangle, isSelected);
  const strokeWidth = isSelected ? 2.5 : 2;

  const { horizontal: horizontalDocLength, vertical: verticalDocLength } =
    getScreenRectEdgeDocLengths(viewport, rectangle.topLeft, rectangle.bottomRight);

  const widthValueInDisplayUnit =
    scale && horizontalDocLength > 0
      ? getDimensionValueInDisplayUnit(horizontalDocLength, scale, displayUnit)
      : 0;
  const heightValueInDisplayUnit =
    scale && verticalDocLength > 0
      ? getDimensionValueInDisplayUnit(verticalDocLength, scale, displayUnit)
      : 0;

  const widthLabel =
    scale && horizontalDocLength > 0
      ? getDisplayDistance(horizontalDocLength, scale, displayUnit)
      : "—";
  const heightLabel =
    scale && verticalDocLength > 0
      ? getDisplayDistance(verticalDocLength, scale, displayUnit)
      : "—";

  const widthLabelWidth = estimateLabelWidth(widthLabel);
  const heightLabelWidth = estimateLabelWidth(heightLabel);

  const topLeft = { x, y };
  const topRight = { x: x + width, y };
  const bottomRight = { x: x + width, y: y + height };
  const bottomLeft = { x, y: y + height };

  const topEdge =
    widthLabel !== "—"
      ? computeInlineEdgeSegments(topLeft, topRight, widthLabelWidth)
      : null;
  const leftEdge =
    heightLabel !== "—"
      ? computeInlineEdgeSegments(topLeft, bottomLeft, heightLabelWidth)
      : null;

  const corners: { id: RectCorner; cx: number; cy: number }[] = [
    { id: "topLeft", cx: x, cy: y },
    { id: "topRight", cx: x + width, cy: y },
    { id: "bottomLeft", cx: x, cy: y + height },
    { id: "bottomRight", cx: x + width, cy: y + height },
  ];

  const handleEdgePointerDown = (event: React.PointerEvent) => {
    if (!isSelectMode && !showHandles) return;
    event.stopPropagation();
    onSelect(rectangle.id, event.shiftKey);
    if (showHandles) {
      onBodyPointerDown(rectangle.id, event);
    }
  };

  return (
    <g className="rectangle-annotation">
      {topEdge
        ? renderEdgeSegment(
            topEdge,
            color,
            strokeWidth,
            isSelectMode,
            showHandles,
            handleEdgePointerDown,
            "top",
          )
        : renderEdgeSegment(
            computeInlineEdgeSegments(topLeft, topRight, 0),
            color,
            strokeWidth,
            isSelectMode,
            showHandles,
            handleEdgePointerDown,
            "top-full",
          )}
      <EdgeLine
        x1={topRight.x}
        y1={topRight.y}
        x2={bottomRight.x}
        y2={bottomRight.y}
        color={color}
        strokeWidth={strokeWidth}
        isSelectMode={isSelectMode}
        showHandles={showHandles}
        onEdgePointerDown={handleEdgePointerDown}
      />
      <EdgeLine
        x1={bottomRight.x}
        y1={bottomRight.y}
        x2={bottomLeft.x}
        y2={bottomLeft.y}
        color={color}
        strokeWidth={strokeWidth}
        isSelectMode={isSelectMode}
        showHandles={showHandles}
        onEdgePointerDown={handleEdgePointerDown}
      />
      {leftEdge
        ? renderEdgeSegment(
            leftEdge,
            color,
            strokeWidth,
            isSelectMode,
            showHandles,
            handleEdgePointerDown,
            "left",
          )
        : renderEdgeSegment(
            computeInlineEdgeSegments(topLeft, bottomLeft, 0),
            color,
            strokeWidth,
            isSelectMode,
            showHandles,
            handleEdgePointerDown,
            "left-full",
          )}
      {widthLabel !== "—" && topEdge && (
        <g
          transform={`rotate(${topEdge.angleDeg}, ${topEdge.labelCenter.x}, ${topEdge.labelCenter.y})`}
        >
          <DimensionLabel
            x={topEdge.labelCenter.x}
            y={topEdge.labelCenter.y}
            label={widthLabel}
            valueInDisplayUnit={widthValueInDisplayUnit}
            color={color}
            displayUnit={displayUnit}
            isSelected={isSelected}
            showHandles={showHandles && !!scale}
            isEditing={editingField === "width"}
            inline
            clickable={isSelectMode && !showHandles}
            onSelect={() => onSelect(rectangle.id, false)}
            onStartEdit={() => onStartEditWidth(rectangle.id)}
            onCommit={(value) => onCommitWidth(rectangle.id, value)}
            onCancel={onCancelEdit}
            onDragStart={(event) => onWidthLabelDragStart(rectangle.id, event)}
          />
        </g>
      )}
      {heightLabel !== "—" && leftEdge && (
        <g
          transform={`rotate(${leftEdge.angleDeg}, ${leftEdge.labelCenter.x}, ${leftEdge.labelCenter.y})`}
        >
          <DimensionLabel
            x={leftEdge.labelCenter.x}
            y={leftEdge.labelCenter.y}
            label={heightLabel}
            valueInDisplayUnit={heightValueInDisplayUnit}
            color={color}
            displayUnit={displayUnit}
            isSelected={isSelected}
            showHandles={showHandles && !!scale}
            isEditing={editingField === "height"}
            inline
            clickable={isSelectMode && !showHandles}
            onSelect={() => onSelect(rectangle.id, false)}
            onStartEdit={() => onStartEditHeight(rectangle.id)}
            onCommit={(value) => onCommitHeight(rectangle.id, value)}
            onCancel={onCancelEdit}
            onDragStart={(event) => onHeightLabelDragStart(rectangle.id, event)}
          />
        </g>
      )}
      {showHandles && isSelected && (
        <>
          {corners.map((corner) => (
            <circle
              key={corner.id}
              cx={corner.cx}
              cy={corner.cy}
              r={7}
              fill="#0f172a"
              stroke={color}
              strokeWidth={2}
              style={{ cursor: "crosshair", pointerEvents: "all" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onCornerPointerDown(rectangle.id, corner.id, event);
              }}
            />
          ))}
        </>
      )}
    </g>
  );
}

export type { RectCorner };
