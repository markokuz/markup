import type {
  Measurement,
  NoteAnnotation,
  PendingMarquee,
  Point2D,
  RectMeasurement,
  Scale,
  Unit,
} from "@/app/types";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import type { ScreenRect } from "@/app/utils/coordinates";
import {
  distanceToSegment,
  docDistance,
  estimateLabelWidth,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import { convertUnits, formatDistance } from "@/app/utils/units";

export function screenRectFromPoints(a: Point2D, b: Point2D): ScreenRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Expand zero/thin marquee boxes so line and edge intersection tests stay reliable. */
export function normalizeMarqueeRect(rect: ScreenRect, minSize = 4): ScreenRect {
  if (rect.width >= minSize && rect.height >= minSize) {
    return rect;
  }

  const width = Math.max(rect.width, minSize);
  const height = Math.max(rect.height, minSize);

  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height,
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

function rectangleMatchesMarquee(
  bounds: ScreenRect,
  selectionRect: ScreenRect,
  mode: MarqueeSelectionMode,
): boolean {
  if (mode === "contain") {
    return (
      bounds.x >= selectionRect.x &&
      bounds.y >= selectionRect.y &&
      bounds.x + bounds.width <= selectionRect.x + selectionRect.width &&
      bounds.y + bounds.height <= selectionRect.y + selectionRect.height
    );
  }

  const { x, y, width, height } = bounds;
  const edges: [Point2D, Point2D][] = [
    [{ x, y }, { x: x + width, y }],
    [{ x: x + width, y }, { x: x + width, y: y + height }],
    [{ x: x + width, y: y + height }, { x, y: y + height }],
    [{ x, y: y + height }, { x, y }],
  ];

  return edges.some(([start, end]) =>
    segmentIntersectsRect(start, end, selectionRect),
  );
}

export function findAnnotationsInMarquee(
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  viewport: DocumentViewport,
  marquee: PendingMarquee,
  mode: MarqueeSelectionMode = "intersect",
): string[] {
  const selectionRect = normalizeMarqueeRect(
    screenRectFromPoints(marquee.start, marquee.current),
  );
  const ids: string[] = [];

  for (const measurement of measurements) {
    if (measurement.isCalibration) continue;

    const start = toScreenPoint(viewport, measurement.start.x, measurement.start.y);
    const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);

    if (lineMatchesMarquee(start, end, selectionRect, mode)) {
      ids.push(measurement.id);
    }
  }

  for (const rectangle of rectangles) {
    const bounds = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
    if (rectangleMatchesMarquee(bounds, selectionRect, mode)) {
      ids.push(rectangle.id);
    }
  }

  for (const note of notes) {
    const pos = toScreenPoint(viewport, note.position.x, note.position.y);
    const labelWidth = estimateLabelWidth(note.text || "Note");
    const noteRect: ScreenRect = {
      x: pos.x,
      y: pos.y,
      width: labelWidth,
      height: 28,
    };
    const selected =
      mode === "contain"
        ? noteRect.x >= selectionRect.x &&
          noteRect.y >= selectionRect.y &&
          noteRect.x + noteRect.width <= selectionRect.x + selectionRect.width &&
          noteRect.y + noteRect.height <= selectionRect.y + selectionRect.height
        : rectsIntersect(noteRect, selectionRect);
    if (selected) {
      ids.push(note.id);
    }
  }

  return ids;
}

const LINE_HIT_SLOP = 14;
const LABEL_HIT_PADDING = 4;

export function hitTestAnnotations(
  point: Point2D,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  viewport: DocumentViewport,
  scale: Scale | null,
  displayUnit: Unit,
): string | null {
  type HitCandidate = { id: string; area: number; dist: number };

  const candidates: HitCandidate[] = [];

  for (const note of notes) {
    const pos = toScreenPoint(viewport, note.position.x, note.position.y);
    const labelWidth = estimateLabelWidth(note.text || "Note");
    const rect: ScreenRect = { x: pos.x, y: pos.y, width: labelWidth, height: 28 };
    if (pointInRect(point, rect)) {
      candidates.push({
        id: note.id,
        area: labelWidth * 28,
        dist: Math.hypot(point.x - (rect.x + rect.width / 2), point.y - (rect.y + rect.height / 2)),
      });
    }
  }

  for (const measurement of measurements) {
    if (measurement.isCalibration) continue;

    const start = toScreenPoint(viewport, measurement.start.x, measurement.start.y);
    const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);
    const dist = distanceToSegment(point, start, end);

    if (dist <= LINE_HIT_SLOP) {
      candidates.push({
        id: measurement.id,
        area: Math.hypot(end.x - start.x, end.y - start.y) * 12,
        dist,
      });
    }

    if (scale) {
      const label =
        formatDistanceLabel(measurement, scale, displayUnit) ?? "—";
      const labelWidth = estimateLabelWidth(label);
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const labelRect: ScreenRect = {
        x: mid.x - labelWidth / 2 - LABEL_HIT_PADDING,
        y: mid.y - 14,
        width: labelWidth + LABEL_HIT_PADDING * 2,
        height: 28,
      };
      if (pointInRect(point, labelRect)) {
        candidates.push({
          id: measurement.id,
          area: labelWidth * 28,
          dist: Math.hypot(point.x - mid.x, point.y - mid.y),
        });
      }
    }
  }

  for (const rectangle of rectangles) {
    const bounds = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
    const onStroke =
      (point.x >= bounds.x - LINE_HIT_SLOP &&
        point.x <= bounds.x + bounds.width + LINE_HIT_SLOP &&
        point.y >= bounds.y - LINE_HIT_SLOP &&
        point.y <= bounds.y + bounds.height + LINE_HIT_SLOP) &&
      !(
        point.x > bounds.x + LINE_HIT_SLOP &&
        point.x < bounds.x + bounds.width - LINE_HIT_SLOP &&
        point.y > bounds.y + LINE_HIT_SLOP &&
        point.y < bounds.y + bounds.height - LINE_HIT_SLOP
      );

    if (onStroke) {
      const mid = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      candidates.push({
        id: rectangle.id,
        area: bounds.width * bounds.height,
        dist: Math.hypot(point.x - mid.x, point.y - mid.y),
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.area !== b.area) return a.area - b.area;
    return a.dist - b.dist;
  });

  return candidates[0].id;
}

function formatDistanceLabel(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): string | null {
  const dist = docDistance(measurement.start, measurement.end);
  const value = convertUnits(
    dist * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}
