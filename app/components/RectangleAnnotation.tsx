"use client";

import type { Point2D, RectMeasurement, Scale, Unit } from "@/app/types";
import {
  computeInlineEdgeSegments,
  estimateLabelWidth,
  getScreenRectEdgeDocLengths,
  midpoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import { dashArray, getAnnotationColor, SELECTION_ACCENT } from "@/app/utils/colors";
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
type RectEdge = "top" | "right" | "bottom" | "left";

/** An unlabelled edge drawn as one unbroken segment (no gap for text). */
function fullEdge(a: Point2D, b: Point2D): ReturnType<typeof computeInlineEdgeSegments> {
  return { ...computeInlineEdgeSegments(a, b, 0), segment1Start: a, segment1End: b, showGap: false };
}

interface RectangleAnnotationProps {
  rectangle: RectMeasurement;
  viewport: DocumentViewport;
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
  /** Side handle: resizes along one axis only. */
  onEdgeHandlePointerDown: (id: string, edge: RectEdge, event: React.PointerEvent) => void;
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
  dash?: string;
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
  dash,
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
        strokeDasharray={dash}
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
  dash?: string,
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
        dash={dash}
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
        dash={dash}
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
        dash={dash}
      />
    </g>
  );
}

export function RectangleAnnotation({
  rectangle,
  viewport,
  scale,
  displayUnit,
  isSelected,
  isSelectMode,
  showHandles,
  editingField,
  onSelect,
  onBodyPointerDown,
  onCornerPointerDown,
  onEdgeHandlePointerDown,
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

  const color = getAnnotationColor(rectangle);
  const strokeWidth = isSelected ? 2.5 : 2;
  const dash = rectangle.dashed ? dashArray(2) : undefined;

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

  // Labelled edges carry their square beside the label so it never covers the number.
  const topHandle = topEdge?.showGap
    ? midpoint(topEdge.segment2Start, topEdge.segment2End)
    : { x: x + width / 2, y };
  const leftHandle = leftEdge?.showGap
    ? midpoint(leftEdge.segment2Start, leftEdge.segment2End)
    : { x, y: y + height / 2 };

  const allEdgeHandles: { id: RectEdge; cx: number; cy: number; cursor: string }[] = [
    { id: "top", cx: topHandle.x, cy: topHandle.y, cursor: "ns-resize" },
    { id: "bottom", cx: x + width / 2, cy: y + height, cursor: "ns-resize" },
    { id: "left", cx: leftHandle.x, cy: leftHandle.y, cursor: "ew-resize" },
    { id: "right", cx: x + width, cy: y + height / 2, cursor: "ew-resize" },
  ];
  // The edit box is wider than the label; hide that edge's square while typing.
  const edgeHandles = allEdgeHandles.filter(
    (handle) =>
      !(editingField === "width" && handle.id === "top") &&
      !(editingField === "height" && handle.id === "left"),
  );

  // Any unlocked rectangle can be grabbed and moved on the first press, like every markup.
  const grabbable = (isSelectMode || showHandles) && !rectangle.locked;

  const handleEdgePointerDown = (event: React.PointerEvent) => {
    if (!isSelectMode && !showHandles) return;
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    onSelect(rectangle.id, additive);
    if (grabbable && !additive) {
      onBodyPointerDown(rectangle.id, event);
    }
  };

  return (
    <g
      className="rectangle-annotation"
      transform={
        rectangle.rotation
          ? `rotate(${rectangle.rotation} ${x + width / 2} ${y + height / 2})`
          : undefined
      }
    >
      {rectangle.ellipse ? (
        <>
          {isSelected && (
            <ellipse
              cx={x + width / 2}
              cy={y + height / 2}
              rx={Math.abs(width) / 2}
              ry={Math.abs(height) / 2}
              fill="none"
              stroke={SELECTION_ACCENT}
              strokeWidth={strokeWidth + 6}
              opacity={0.3}
              style={{ pointerEvents: "none" }}
            />
          )}
          {/* The outline, then a wider see-through band that is easier to grab. */}
          {[
            { stroke: color, w: strokeWidth, d: dash },
            ...(grabbable ? [{ stroke: "transparent", w: 12, d: undefined }] : []),
          ].map((layer, i) => (
            <ellipse
              key={i}
              cx={x + width / 2}
              cy={y + height / 2}
              rx={Math.abs(width) / 2}
              ry={Math.abs(height) / 2}
              fill="none"
              stroke={layer.stroke}
              strokeWidth={layer.w}
              strokeDasharray={layer.d}
              style={{
                pointerEvents: isSelectMode || grabbable ? "stroke" : "none",
                cursor: grabbable ? "move" : isSelectMode ? "pointer" : "default",
              }}
              onPointerDown={handleEdgePointerDown}
            />
          ))}
        </>
      ) : (
        <>
          {isSelected && (
            <rect
              x={Math.min(x, x + width) - 4}
              y={Math.min(y, y + height) - 4}
              width={Math.abs(width) + 8}
              height={Math.abs(height) + 8}
              fill="none"
              stroke={SELECTION_ACCENT}
              strokeWidth={strokeWidth + 6}
              opacity={0.3}
              style={{ pointerEvents: "none" }}
            />
          )}
          {topEdge
            ? renderEdgeSegment(
                topEdge,
                color,
                strokeWidth,
                isSelectMode,
                grabbable,
                handleEdgePointerDown,
                "top",
                dash,
              )
            : renderEdgeSegment(
                fullEdge(topLeft, topRight),
                color,
                strokeWidth,
                isSelectMode,
                grabbable,
                handleEdgePointerDown,
                "top-full",
                dash,
              )}
          <EdgeLine
            x1={topRight.x}
            y1={topRight.y}
            x2={bottomRight.x}
            y2={bottomRight.y}
            color={color}
            strokeWidth={strokeWidth}
            isSelectMode={isSelectMode}
            showHandles={grabbable}
            onEdgePointerDown={handleEdgePointerDown}
            dash={dash}
          />
          <EdgeLine
            x1={bottomRight.x}
            y1={bottomRight.y}
            x2={bottomLeft.x}
            y2={bottomLeft.y}
            color={color}
            strokeWidth={strokeWidth}
            isSelectMode={isSelectMode}
            showHandles={grabbable}
            onEdgePointerDown={handleEdgePointerDown}
            dash={dash}
          />
          {leftEdge
            ? renderEdgeSegment(
                leftEdge,
                color,
                strokeWidth,
                isSelectMode,
                grabbable,
                handleEdgePointerDown,
                "left",
                dash,
              )
            : renderEdgeSegment(
                fullEdge(topLeft, bottomLeft),
                color,
                strokeWidth,
                isSelectMode,
                grabbable,
                handleEdgePointerDown,
                "left-full",
                dash,
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
                clickable={isSelectMode && !showHandles}
                onSelect={(additive) => onSelect(rectangle.id, additive ?? false)}
                onStartEdit={() => onStartEditWidth(rectangle.id)}
                onCommit={(value) => onCommitWidth(rectangle.id, value)}
                onCancel={onCancelEdit}
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
                clickable={isSelectMode && !showHandles}
                onSelect={(additive) => onSelect(rectangle.id, additive ?? false)}
                onStartEdit={() => onStartEditHeight(rectangle.id)}
                onCommit={(value) => onCommitHeight(rectangle.id, value)}
                onCancel={onCancelEdit}
              />
            </g>
          )}
        </>
      )}
      {/* A locked rectangle shows no resize handles. */}
      {showHandles && isSelected && !rectangle.locked && (
        <>
          {edgeHandles.map((handle) => (
            <rect
              key={handle.id}
              x={handle.cx - 5}
              y={handle.cy - 5}
              width={10}
              height={10}
              rx={2}
              fill="#0f172a"
              stroke={color}
              strokeWidth={2}
              style={{ cursor: handle.cursor, pointerEvents: "all" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onEdgeHandlePointerDown(rectangle.id, handle.id, event);
              }}
            />
          ))}
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

export type { RectCorner, RectEdge };
