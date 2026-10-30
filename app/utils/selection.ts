import type {
  Measurement,
  NoteAnnotation,
  PendingMarquee,
  Point2D,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
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
import { cloudOutline, rotateAround, rotatedBoxCorners } from "@/app/utils/geometry";
import { noteCardSize, textScreenBox } from "@/app/utils/noteLayout";

/** Screen corners (TL, TR, BR, BL) of a note card, turned with the note. */
export function noteScreenCorners(note: NoteAnnotation, viewport: DocumentViewport): Point2D[] {
  const pos = toScreenPoint(viewport, note.position.x, note.position.y);
  const { width, height } = noteCardSize(note.text, note.width);
  return rotatedBoxCorners(pos, width, height, note.rotation ?? 0);
}

/** Screen corners of a rectangle, turned about its centre. */
export function rectScreenCorners(rectangle: RectMeasurement, viewport: DocumentViewport): Point2D[] {
  const r = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
  const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ].map((p) => rotateAround(p, centre, rectangle.rotation ?? 0));
}

/** Screen corners of a free-text box, turned about its anchor. */
export function textScreenCorners(shape: ShapeAnnotation, viewport: DocumentViewport): Point2D[] {
  const { x, y, width, height } = textScreenBox(shape, viewport);
  return rotatedBoxCorners({ x, y }, width, height, shape.rotation ?? 0);
}

function closedSegments(points: Point2D[]): [Point2D, Point2D][] {
  return points.map((p, i) => [p, points[(i + 1) % points.length]]);
}
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

/** Screen-space outline segments of a shape (closed for area and cloud). */
function shapeScreenSegments(
  shape: ShapeAnnotation,
  viewport: DocumentViewport,
): [Point2D, Point2D][] {
  const toScreen = (p: Point2D) => toScreenPoint(viewport, p.x, p.y);
  if (shape.kind === "text") return closedSegments(textScreenCorners(shape, viewport));
  if (shape.kind === "count") return shape.points.map((p) => [toScreen(p), toScreen(p)]);
  const pts = (shape.kind === "cloud" ? cloudOutline(shape.points) : shape.points).map(toScreen);
  const closed = shape.kind === "area" || shape.kind === "cloud" || shape.kind === "image";
  const segments: [Point2D, Point2D][] = [];
  for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
    segments.push([pts[i], pts[(i + 1) % pts.length]]);
  }
  return segments;
}

function calloutTextRect(shape: ShapeAnnotation, viewport: DocumentViewport): ScreenRect | null {
  if (shape.kind !== "callout" || shape.points.length < 2) return null;
  const pos = toScreenPoint(viewport, shape.points[1].x, shape.points[1].y);
  return { x: pos.x, y: pos.y, width: estimateLabelWidth(shape.text || "Callout"), height: 28 };
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function findAnnotationsInMarquee(
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  shapes: ShapeAnnotation[],
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

  const outlineMatches = (corners: Point2D[]) =>
    mode === "contain"
      ? corners.every((p) => pointInRect(p, selectionRect))
      : closedSegments(corners).some(([a, b]) => segmentIntersectsRect(a, b, selectionRect)) ||
        pointInPolygon(selectionRect, corners);

  for (const rectangle of rectangles) {
    const matches = rectangle.rotation
      ? outlineMatches(rectScreenCorners(rectangle, viewport))
      : rectangleMatchesMarquee(
          toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight),
          selectionRect,
          mode,
        );
    if (matches) ids.push(rectangle.id);
  }

  for (const note of notes) {
    if (outlineMatches(noteScreenCorners(note, viewport))) ids.push(note.id);
  }

  for (const shape of shapes) {
    const segments = shapeScreenSegments(shape, viewport);
    const textRect = calloutTextRect(shape, viewport);
    const selected =
      mode === "contain"
        ? segments.every(([a, b]) => pointInRect(a, selectionRect) && pointInRect(b, selectionRect))
        : segments.some(([a, b]) => segmentIntersectsRect(a, b, selectionRect)) ||
          (textRect !== null && rectsIntersect(textRect, selectionRect));
    if (segments.length > 0 && selected) {
      ids.push(shape.id);
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
  shapes: ShapeAnnotation[],
  viewport: DocumentViewport,
  scale: Scale | null,
  displayUnit: Unit,
): string | null {
  type HitCandidate = { id: string; area: number; dist: number };

  const candidates: HitCandidate[] = [];

  for (const note of notes) {
    const corners = noteScreenCorners(note, viewport);
    if (pointInPolygon(point, corners)) {
      const { width, height } = noteCardSize(note.text, note.width);
      const centre = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
      candidates.push({
        id: note.id,
        area: width * height,
        dist: Math.hypot(point.x - centre.x, point.y - centre.y),
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

    if (scale && !measurement.plain) {
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
    const centreOf = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    // Test in the rectangle's own (unturned) frame.
    const p = rectangle.rotation ? rotateAround(point, centreOf, -rectangle.rotation) : point;
    const onStroke =
      (p.x >= bounds.x - LINE_HIT_SLOP &&
        p.x <= bounds.x + bounds.width + LINE_HIT_SLOP &&
        p.y >= bounds.y - LINE_HIT_SLOP &&
        p.y <= bounds.y + bounds.height + LINE_HIT_SLOP) &&
      !(
        p.x > bounds.x + LINE_HIT_SLOP &&
        p.x < bounds.x + bounds.width - LINE_HIT_SLOP &&
        p.y > bounds.y + LINE_HIT_SLOP &&
        p.y < bounds.y + bounds.height - LINE_HIT_SLOP
      );

    if (onStroke) {
      candidates.push({
        id: rectangle.id,
        area: bounds.width * bounds.height,
        dist: Math.hypot(p.x - centreOf.x, p.y - centreOf.y),
      });
    }
  }

  for (const shape of shapes) {
    const segments = shapeScreenSegments(shape, viewport);
    if (segments.length === 0) continue;
    const points = segments.map(([a]) => a);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const boundsArea = Math.max(
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      24 * 24,
    );
    const centre = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const nearEdge = segments.some(([a, b]) => distanceToSegment(point, a, b) <= LINE_HIT_SLOP);
    const insideArea =
      (shape.kind === "area" || shape.kind === "image" || shape.kind === "text") &&
      points.length >= 3 &&
      pointInPolygon(point, points);
    const textRect = calloutTextRect(shape, viewport);
    const onText = textRect !== null && pointInRect(point, textRect);
    if (nearEdge || insideArea || onText) {
      candidates.push({
        id: shape.id,
        // Filled areas are big targets; let edges of smaller markups on top win.
        area: insideArea && !nearEdge ? boundsArea * 4 : boundsArea,
        dist: Math.hypot(point.x - centre.x, point.y - centre.y),
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
