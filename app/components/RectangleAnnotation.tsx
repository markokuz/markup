"use client";

import type { DocumentType, RectMeasurement, Scale, Unit } from "@/app/types";
import {
  getRectHeightLabelDocPosition,
  getRectWidthLabelDocPosition,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import { getAnnotationColor } from "@/app/utils/colors";
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

export function RectangleAnnotation({
  rectangle,
  viewport,
  fileType,
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

  const widthLabelDoc = getRectWidthLabelDocPosition(rectangle, fileType);
  const heightLabelDoc = getRectHeightLabelDocPosition(rectangle);
  const widthAnchor = toScreenPoint(viewport, widthLabelDoc.x, widthLabelDoc.y);
  const heightAnchor = toScreenPoint(viewport, heightLabelDoc.x, heightLabelDoc.y);

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
        if (isSelectMode) {
          event.stopPropagation();
          onSelect(rectangle.id, event.shiftKey);
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
        style={{
          pointerEvents: isSelectMode ? "all" : "none",
          cursor: showHandles ? "move" : isSelectMode ? "pointer" : "default",
        }}
        onPointerDown={(event) => {
          if (!showHandles) return;
          event.stopPropagation();
          onSelect(rectangle.id, event.shiftKey);
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
        onSelect={() => onSelect(rectangle.id, false)}
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
        onSelect={() => onSelect(rectangle.id, false)}
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
