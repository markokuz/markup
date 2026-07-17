"use client";

import type { RectMeasurement, Scale, Unit } from "@/app/types";
import { toScreenRect } from "@/app/utils/coordinates";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { getRectDocHeight, getRectDocWidth } from "@/app/utils/dimensions";
import { DimensionLabel } from "@/app/components/DimensionLabel";
import type { DocumentViewport } from "@/app/utils/documentViewport";

function getDisplayDistance(
  docLength: number,
  scale: Scale,
  displayUnit: Unit,
): string {
  const value = convertUnits(
    docLength * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}

type RectCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

interface RectangleAnnotationProps {
  rectangle: RectMeasurement;
  viewport: DocumentViewport;
  scale: Scale | null;
  displayUnit: Unit;
  isSelected: boolean;
  showHandles: boolean;
  editingField: "width" | "height" | null;
  onSelect: (id: string) => void;
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

export function RectangleAnnotation({
  rectangle,
  viewport,
  scale,
  displayUnit,
  isSelected,
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

  const color = isSelected ? "#22d3ee" : "#06b6d4";
  const strokeWidth = isSelected ? 2.5 : 2;

  const docWidth = getRectDocWidth(rectangle);
  const docHeight = getRectDocHeight(rectangle);

  const widthLabel =
    scale && docWidth > 0
      ? getDisplayDistance(docWidth, scale, displayUnit)
      : "—";
  const heightLabel =
    scale && docHeight > 0
      ? getDisplayDistance(docHeight, scale, displayUnit)
      : "—";

  const widthAnchor = {
    x: x + width / 2 + rectangle.widthLabelOffset.x,
    y: y + rectangle.widthLabelOffset.y,
  };
  const heightAnchor = {
    x: x + rectangle.heightLabelOffset.x,
    y: y + height / 2 + rectangle.heightLabelOffset.y,
  };

  const corners: { id: RectCorner; cx: number; cy: number }[] = [
    { id: "topLeft", cx: x, cy: y },
    { id: "topRight", cx: x + width, cy: y },
    { id: "bottomLeft", cx: x, cy: y + height },
    { id: "bottomRight", cx: x + width, cy: y + height },
  ];

  return (
    <g
      className="rectangle-annotation"
      onPointerDown={(event) => {
        if (showHandles) {
          event.stopPropagation();
          onSelect(rectangle.id);
        }
      }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: showHandles ? "all" : "none", cursor: showHandles ? "move" : "default" }}
        onPointerDown={(event) => {
          if (!showHandles) return;
          event.stopPropagation();
          onSelect(rectangle.id);
          onBodyPointerDown(rectangle.id, event);
        }}
      />
      <DimensionLabel
        x={widthAnchor.x}
        y={widthAnchor.y}
        label={widthLabel}
        color={color}
        displayUnit={displayUnit}
        isSelected={isSelected}
        showHandles={showHandles && !!scale}
        isEditing={editingField === "width"}
        onSelect={() => onSelect(rectangle.id)}
        onStartEdit={() => onStartEditWidth(rectangle.id)}
        onCommit={(value) => onCommitWidth(rectangle.id, value)}
        onCancel={onCancelEdit}
        onDragStart={(event) => onWidthLabelDragStart(rectangle.id, event)}
      />
      <DimensionLabel
        x={heightAnchor.x}
        y={heightAnchor.y}
        label={heightLabel}
        color={color}
        displayUnit={displayUnit}
        isSelected={isSelected}
        showHandles={showHandles && !!scale}
        isEditing={editingField === "height"}
        onSelect={() => onSelect(rectangle.id)}
        onStartEdit={() => onStartEditHeight(rectangle.id)}
        onCommit={(value) => onCommitHeight(rectangle.id, value)}
        onCancel={onCancelEdit}
        onDragStart={(event) => onHeightLabelDragStart(rectangle.id, event)}
      />
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
