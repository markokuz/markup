import type { Point2D, Scale, ShapeAnnotation, Unit } from "@/app/types";
import { distanceToSegment } from "@/app/utils/coordinates";
import {
  areaRings,
  formatArea,
  joinStrokes,
  pointInPolygon,
  polygonArea,
  polylineLength,
  splitStrokes,
} from "@/app/utils/geometry";
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
  const [outline, ...holes] = areaRings(shape);
  const net = polygonArea(outline) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  return {
    area: Math.max(0, net) * k * k,
    // The outer edge only: an opening doesn't add to the room's edge.
    perimeter: polylineLength(outline, true) * k,
  };
}

/** An area's outer ring, without its cutouts. */
export function areaOutline(shape: ShapeAnnotation): Point2D[] {
  return areaRings(shape)[0] ?? shape.points;
}

/** How many cutouts an area has. */
export function cutoutCount(shape: ShapeAnnotation): number {
  return shape.kind === "area" ? Math.max(0, areaRings(shape).length - 1) : 0;
}

/**
 * The update that fills in the area's cutout nearest `point` (being inside one counts as
 * nearest), or null if it has none. `breaks` is always present so a merge can't keep the old value.
 */
export function withoutNearestCutout(
  shape: ShapeAnnotation,
  point: Point2D,
): Pick<ShapeAnnotation, "points" | "breaks"> | null {
  if (cutoutCount(shape) === 0) return null;
  const [outline, ...cutouts] = areaRings(shape);
  const distanceTo = (ring: Point2D[]) =>
    pointInPolygon(point, ring)
      ? 0
      : Math.min(...ring.map((p, i) => distanceToSegment(point, p, ring[(i + 1) % ring.length])));
  const nearest = cutouts.reduce((best, ring) => (distanceTo(ring) < distanceTo(best) ? ring : best));
  return { breaks: undefined, ...joinStrokes([outline, ...cutouts.filter((ring) => ring !== nearest)]) };
}

/** A run's total length along all its segments, in display units. */
export function getPolylineLength(
  shape: ShapeAnnotation,
  scale: Scale | null,
  unit: Unit,
): number | null {
  if (shape.kind !== "polyline" || !scale || shape.points.length < 2) return null;
  return polylineLength(shape.points, false) * displayPerDoc(scale, unit);
}

/** On-canvas label: area + perimeter for areas, total length for runs (counts show only their numbered dots). */
export function getShapeLabel(
  shape: ShapeAnnotation,
  scale: Scale | null,
  unit: Unit,
): string | null {
  const length = getPolylineLength(shape, scale, unit);
  if (length !== null) return formatDistance(length, unit);
  const metrics = getAreaMetrics(shape, scale, unit);
  if (!metrics) return null;
  return `${formatArea(metrics.area, unit)} · P ${formatDistance(metrics.perimeter, unit)}`;
}

export const SHAPE_KIND_LABELS: Record<ShapeAnnotation["kind"], string> = {
  area: "Area",
  // "Length", not its own type: a run's total belongs with the two-point lines in the summary.
  polyline: "Length",
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
