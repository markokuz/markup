import type { Point2D, Scale, ShapeAnnotation, Unit } from "@/app/types";
import { formatArea, polygonArea, polylineLength } from "@/app/utils/geometry";
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

/** On-canvas label: area + perimeter for areas, running total for counts. */
export function getShapeLabel(
  shape: ShapeAnnotation,
  scale: Scale | null,
  unit: Unit,
): string | null {
  if (shape.kind === "count") return `Count: ${shape.points.length}`;
  const metrics = getAreaMetrics(shape, scale, unit);
  if (!metrics) return null;
  return `${formatArea(metrics.area, unit)} · P ${formatDistance(metrics.perimeter, unit)}`;
}

export const SHAPE_KIND_LABELS: Record<ShapeAnnotation["kind"], string> = {
  area: "Area",
  count: "Count",
  cloud: "Cloud",
  callout: "Callout",
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
