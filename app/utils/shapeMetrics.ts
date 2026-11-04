import type { Point2D, Scale, ShapeAnnotation, Unit } from "@/app/types";
import { formatArea, polygonArea, polylineLength, splitStrokes } from "@/app/utils/geometry";
import { NOTE_CARD } from "@/app/utils/noteLayout";
import { convertUnits, formatDistance } from "@/app/utils/units";

/** Display units per document unit under the calibration. */
function displayPerDoc(scale: Scale, unit: Unit): number {
  return convertUnits(scale.unitsPerPdfPoint, scale.calibrationUnit, unit);
}

export function getAreaMetrics(
  shape: ShapeAnnotation,
  scale: Scale | null,
  unit: Unit,
): { area: number; perimeter: number } | null {
  if (shape.kind !== "area" || !scale || shape.points.length < 3) return null;
  const k = displayPerDoc(scale, unit);
  return {
    area: polygonArea(shape.points) * k * k,
    perimeter: polylineLength(shape.points, true) * k,
  };
}

/** On-canvas label: area + perimeter for areas (counts show only their numbered dots). */
export function getShapeLabel(
  shape: ShapeAnnotation,
  scale: Scale | null,
  unit: Unit,
): string | null {
  const metrics = getAreaMetrics(shape, scale, unit);
  if (!metrics) return null;
  return `${formatArea(metrics.area, unit)} · P ${formatDistance(metrics.perimeter, unit)}`;
}

export const SHAPE_KIND_LABELS: Record<ShapeAnnotation["kind"], string> = {
  area: "Area",
  count: "Count",
  cloud: "Cloud",
  draw: "Drawing",
  callout: "Callout",
  text: "Text",
  image: "Snapshot",
};

/** Clicking within this many screen px of an area's first vertex closes it. */
export const CLOSE_AREA_PX = 10;

/** Number on a count group's first marker. */
export function countStartAt(shape: ShapeAnnotation): number {
  return shape.startAt ?? 1;
}

/** Screen offset (px) from a callout's card anchor to where its leader line attaches. */
export const CALLOUT_LEADER_OFFSET: Point2D = {
  x: 0,
  y: NOTE_CARD.padY + NOTE_CARD.lineHeight / 2,
};

/** Draw tool line thickness, in screen px at any zoom like every markup's stroke. */
export const DRAW_DEFAULT_WIDTH = 2;
export const DRAW_MIN_WIDTH = 1;
export const DRAW_MAX_WIDTH = 20;

export function drawWidth(shape: ShapeAnnotation): number {
  return shape.strokeWidth ?? DRAW_DEFAULT_WIDTH;
}

/** A drawing's separate pieces (more than one once the eraser has cut through it). */
export function drawPieces(shape: ShapeAnnotation): Point2D[][] {
  return splitStrokes(shape.points, shape.breaks);
}

/** Eraser diameter in screen px; each stroke is also cut half its thickness wider. */
export const ERASER_DEFAULT_SIZE = 16;
export const ERASER_MIN_SIZE = 4;
export const ERASER_MAX_SIZE = 80;
