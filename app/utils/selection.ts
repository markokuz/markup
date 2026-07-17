import type { Measurement, PendingMarquee, Point2D, RectMeasurement } from "@/app/types";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import type { ScreenRect } from "@/app/utils/coordinates";
import { toScreenPoint, toScreenRect } from "@/app/utils/coordinates";

export function screenRectFromPoints(a: Point2D, b: Point2D): ScreenRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function pointInRect(point: Point2D, rect: ScreenRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: Point2D, b: Point2D, c: Point2D): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

function segmentsIntersect(p1: Point2D, q1: Point2D, p2: Point2D, q2: Point2D): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  // Endpoints must straddle the other segment (opposite signs), not merely differ in value.
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

export function segmentIntersectsRect(
  p1: Point2D,
  p2: Point2D,
  rect: ScreenRect,
): boolean {
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) return true;

  const corners: Point2D[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (segmentsIntersect(p1, p2, a, b)) return true;
  }

  return false;
}

export function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export type MarqueeSelectionMode = "intersect" | "contain";

function lineMatchesMarquee(
  start: Point2D,
  end: Point2D,
  selectionRect: ScreenRect,
  mode: MarqueeSelectionMode,
): boolean {
  if (mode === "contain") {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return pointInRect(mid, selectionRect);
  }

  return segmentIntersectsRect(start, end, selectionRect);
}

export function findAnnotationsInMarquee(
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  viewport: DocumentViewport,
  marquee: PendingMarquee,
  mode: MarqueeSelectionMode = "intersect",
): string[] {
  const selectionRect = screenRectFromPoints(marquee.start, marquee.current);
  const ids: string[] = [];

  for (const measurement of measurements) {
    if (measurement.isCalibration) continue;

    const start = toScreenPoint(viewport, measurement.start.x, measurement.start.y);
    const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);

    const selected = lineMatchesMarquee(start, end, selectionRect, mode);

    if (selected) {
      ids.push(measurement.id);
    }
  }

  for (const rectangle of rectangles) {
    const bounds = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
    const selected =
      mode === "contain"
        ? bounds.x >= selectionRect.x &&
          bounds.y >= selectionRect.y &&
          bounds.x + bounds.width <= selectionRect.x + selectionRect.width &&
          bounds.y + bounds.height <= selectionRect.y + selectionRect.height
        : rectsIntersect(bounds, selectionRect);
    if (selected) {
      ids.push(rectangle.id);
    }
  }

  return ids;
}
