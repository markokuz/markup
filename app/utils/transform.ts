import type { AppAction, NoteAnnotation, Point2D, RectMeasurement, ShapeAnnotation } from "@/app/types";
import { toDocPoint, toScreenPoint } from "@/app/utils/coordinates";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { cloudOutline, rotateAround } from "@/app/utils/geometry";
import { noteScreenCorners, rectScreenCorners, textScreenCorners } from "@/app/utils/selection";

/** A markup the resize/rotate handles can act on. */
export type Transformable =
  | { kind: "shape"; item: ShapeAnnotation }
  | { kind: "note"; item: NoteAnnotation }
  | { kind: "rect"; item: RectMeasurement };

/** The item's box on screen: corners TL, TR, BR, BL and its turn in degrees (clockwise). */
export interface TransformFrame {
  corners: Point2D[];
  angle: number;
  centre: Point2D;
  /** Corner handles resize it (rectangles keep their own edge/corner handles). */
  scalable: boolean;
  /** Resizing keeps the aspect ratio (text, snapshots). */
  uniform: boolean;
}

const MIN_SCALE = 0.05;

function angleOf(a: Point2D, b: Point2D): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function normalizeDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return Math.abs(d) < 1e-9 || Math.abs(d - 360) < 1e-9 ? 0 : d;
}

function frameFrom(corners: Point2D[], angle: number, scalable: boolean, uniform: boolean): TransformFrame {
  const centre = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  return { corners, angle, centre, scalable, uniform };
}

/** Points a shape is moved by; a two-corner cloud is expanded to its four corners first. */
function shapeSourcePoints(shape: ShapeAnnotation): Point2D[] {
  return shape.kind === "cloud" ? cloudOutline(shape.points) : shape.points;
}

export function getTransformFrame(
  target: Transformable,
  viewport: DocumentViewport,
): TransformFrame | null {
  const toScreen = (p: Point2D) => toScreenPoint(viewport, p.x, p.y);
  if (target.kind === "rect") {
    return frameFrom(rectScreenCorners(target.item, viewport), target.item.rotation ?? 0, false, false);
  }
  if (target.kind === "note") {
    return frameFrom(noteScreenCorners(target.item, viewport), target.item.rotation ?? 0, true, false);
  }
  const shape = target.item;
  if (shape.kind === "text" && shape.points.length >= 1) {
    return frameFrom(textScreenCorners(shape, viewport), shape.rotation ?? 0, true, true);
  }
  if (shape.kind === "image" && shape.points.length === 4) {
    const corners = shape.points.map(toScreen);
    return frameFrom(corners, angleOf(corners[0], corners[1]), true, true);
  }
  if ((shape.kind === "cloud" || shape.kind === "area") && shape.points.length >= 2) {
    // Bounding box in the shape's own frame, so a turned shape keeps a snug box.
    const angle = shape.rotation ?? 0;
    const origin = { x: 0, y: 0 };
    const local = shapeSourcePoints(shape).map((p) => rotateAround(toScreen(p), origin, -angle));
    const xs = local.map((p) => p.x);
    const ys = local.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ].map((p) => rotateAround(p, origin, angle));
    return frameFrom(corners, angle, true, false);
  }
  return null;
}

/** Update that turns `target` by `delta` degrees about its frame centre. */
export function rotateTarget(
  target: Transformable,
  frame: TransformFrame,
  delta: number,
  viewport: DocumentViewport,
): AppAction {
  const turn = (p: Point2D) => {
    const s = rotateAround(toScreenPoint(viewport, p.x, p.y), frame.centre, delta);
    return toDocPoint(viewport, s.x, s.y);
  };
  if (target.kind === "rect") {
    return {
      type: "UPDATE_RECTANGLE",
      id: target.item.id,
      updates: { rotation: normalizeDeg((target.item.rotation ?? 0) + delta) },
    };
  }
  if (target.kind === "note") {
    return {
      type: "UPDATE_NOTE",
      id: target.item.id,
      updates: {
        position: turn(target.item.position),
        rotation: normalizeDeg((target.item.rotation ?? 0) + delta),
      },
    };
  }
  const shape = target.item;
  return {
    type: "UPDATE_SHAPE",
    id: shape.id,
    updates: {
      points: (shape.kind === "text" ? shape.points : shapeSourcePoints(shape)).map(turn),
      ...(shape.kind === "image" ? {} : { rotation: normalizeDeg((shape.rotation ?? 0) + delta) }),
    },
  };
}

/** Update that resizes `target` by dragging frame corner `corner` to `pointer` (screen). */
export function scaleTarget(
  target: Transformable,
  frame: TransformFrame,
  corner: number,
  pointer: Point2D,
  viewport: DocumentViewport,
): AppAction | null {
  const fixed = frame.corners[(corner + 2) % 4];
  const toLocal = (p: Point2D) => {
    const r = rotateAround(p, fixed, -frame.angle);
    return { x: r.x - fixed.x, y: r.y - fixed.y };
  };
  const grabbed = toLocal(frame.corners[corner]);
  const now = toLocal(pointer);
  let sx: number;
  let sy: number;
  if (frame.uniform) {
    const lengthSq = grabbed.x * grabbed.x + grabbed.y * grabbed.y;
    if (lengthSq < 1e-6) return null;
    sx = sy = Math.max(MIN_SCALE, (now.x * grabbed.x + now.y * grabbed.y) / lengthSq);
  } else {
    sx = Math.abs(grabbed.x) < 1e-6 ? 1 : Math.max(MIN_SCALE, now.x / grabbed.x);
    // A note's height follows its text: resizing only changes how wide the box is.
    sy = target.kind === "note" || Math.abs(grabbed.y) < 1e-6 ? 1 : Math.max(MIN_SCALE, now.y / grabbed.y);
  }
  const map = (p: Point2D) => {
    const l = toLocal(toScreenPoint(viewport, p.x, p.y));
    const s = rotateAround({ x: fixed.x + l.x * sx, y: fixed.y + l.y * sy }, fixed, frame.angle);
    return toDocPoint(viewport, s.x, s.y);
  };

  if (target.kind === "rect") return null;
  if (target.kind === "note") {
    const width = Math.hypot(
      frame.corners[1].x - frame.corners[0].x,
      frame.corners[1].y - frame.corners[0].y,
    );
    return {
      type: "UPDATE_NOTE",
      id: target.item.id,
      updates: { position: map(target.item.position), width: Math.max(width * sx, 48) },
    };
  }
  const shape = target.item;
  if (shape.kind === "text") {
    return {
      type: "UPDATE_SHAPE",
      id: shape.id,
      updates: { points: shape.points.map(map), fontSize: (shape.fontSize ?? 0) * sx || undefined },
    };
  }
  return { type: "UPDATE_SHAPE", id: shape.id, updates: { points: shapeSourcePoints(shape).map(map) } };
}

/**
 * Corners for resizing a turned rectangle in its own frame: `moving` and `fixed` are
 * unturned screen points about the drag-start centre. Shifts the result so the fixed
 * corner stays where it was on screen once the rectangle turns about its new centre.
 */
export function turnedRectCorners(
  moving: Point2D,
  fixed: Point2D,
  angle: number,
  startCentre: Point2D,
): { moving: Point2D; fixed: Point2D } {
  if (!angle) return { moving, fixed };
  const newCentre = { x: (moving.x + fixed.x) / 2, y: (moving.y + fixed.y) / 2 };
  const want = rotateAround(fixed, startCentre, angle);
  const got = rotateAround(fixed, newCentre, angle);
  const dx = want.x - got.x;
  const dy = want.y - got.y;
  return {
    moving: { x: moving.x + dx, y: moving.y + dy },
    fixed: { x: fixed.x + dx, y: fixed.y + dy },
  };
}
