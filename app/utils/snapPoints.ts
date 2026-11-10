import type { Measurement, Point2D, RectMeasurement, ShapeAnnotation } from "@/app/types";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { areaRings } from "@/app/utils/geometry";
import { getTransformFrame } from "@/app/utils/transform";
import { toDocPoint } from "@/app/utils/coordinates";

export type SnapKind = "end" | "intersection" | "midpoint" | "line";

export interface SnapHit {
  point: Point2D;
  kind: SnapKind;
}

/** Line work as flat x1,y1,x2,y2 runs, in doc units. */
export interface SnapSegments {
  coords: Float32Array;
  /** 1: the chord of a curve, so only its two ends are really on the drawing. */
  curve: Uint8Array;
  count: number;
}

export interface SegmentIndex extends SnapSegments {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  /** Segments of cell `c` are entries[cellStart[c]] up to entries[cellStart[c + 1]]. */
  cellStart: Int32Array;
  entries: Int32Array;
  /** Query scratch: a long segment is listed in many cells but should be looked at once. */
  seen: Int32Array;
  stamp: number;
}

/** A markup's edge. `id` lets a markup being drawn or dragged not snap to itself. */
export interface MarkupSegment {
  id: string;
  a: Point2D;
  b: Point2D;
}

type Matrix = [number, number, number, number, number, number];

/** Curve flattening noise and vector text: too short to be worth aiming at. */
const MIN_SEGMENT = 1.5;
/** A filled path smaller than this is a letter drawn as an outline, not line work. */
const MIN_FILLED_PATH = 12;
/** shortcut: past this the rest of the sheet is ignored to bound memory; split into pages if real sheets hit it. */
const MAX_SEGMENTS = 2_000_000;
/** Grid cells along the sheet's longer side. */
const GRID_CELLS = 256;
/** Points on a sheet closer than this don't count as different when comparing distances. */
const SAME_DISTANCE = 0.01;
/** Most segments checked against each other for crossings, so dense hatching stays quick. */
const MAX_CROSSING_CANDIDATES = 48;
/** Lesser kinds pull from less far, so they don't get in the way of placing a point by eye. */
const MIDPOINT_RADIUS = 0.75;
const ALONG_LINE_RADIUS = 0.6;
/** A midpoint this close to its own ends (in radii) is just the same spot again. */
const MIN_MIDPOINT_LENGTH = 3;

const multiply = (m: Matrix, n: readonly number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The operator codes this reads, from pdf.js's OPS table. */
export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  endPath: number;
  fill: number;
  eoFill: number;
}

/**
 * Every straight segment a PDF page draws, from pdf.js's operator list. Paths in there
 * are flat arrays of pdf.js's DrawOPS codes (0 move, 1 line, 2 cubic, 3 quadratic, 4 close).
 */
export function extractSegments(
  ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> },
  OPS: PdfOps,
): SnapSegments {
  let capacity = 4096;
  let coords = new Float32Array(capacity * 4);
  let curve = new Uint8Array(capacity);
  let count = 0;
  const minSquared = MIN_SEGMENT * MIN_SEGMENT;

  const add = (x1: number, y1: number, x2: number, y2: number, isCurve: boolean) => {
    if ((x2 - x1) ** 2 + (y2 - y1) ** 2 < minSquared || count >= MAX_SEGMENTS) return;
    if (count === capacity) {
      capacity *= 2;
      const moreCoords = new Float32Array(capacity * 4);
      moreCoords.set(coords);
      coords = moreCoords;
      const moreCurve = new Uint8Array(capacity);
      moreCurve.set(curve);
      curve = moreCurve;
    }
    coords.set([x1, y1, x2, y2], count * 4);
    curve[count] = isCurve ? 1 : 0;
    count++;
  };

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  const forms: Matrix[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) {
      saved.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = saved.pop() ?? ctm;
    } else if (fn === OPS.transform && args) {
      ctm = multiply(ctm, args as number[]);
    } else if (fn === OPS.paintFormXObjectBegin && args) {
      forms.push(ctm);
      if (args[0]) ctm = multiply(ctm, args[0] as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = forms.pop() ?? ctm;
    } else if (fn === OPS.constructPath && args) {
      const [paint, paths, box] = args as [number, ArrayLike<number>[] | null, ArrayLike<number> | null];
      const data = paths?.[0];
      // endPath is a clip: nothing was drawn along it.
      if (!data || paint === OPS.endPath) continue;
      if ((paint === OPS.fill || paint === OPS.eoFill) && box) {
        const w = box[2] - box[0];
        const h = box[3] - box[1];
        const across = Math.abs(w * ctm[0]) + Math.abs(h * ctm[2]);
        const down = Math.abs(w * ctm[1]) + Math.abs(h * ctm[3]);
        if (Math.max(across, down) < MIN_FILLED_PATH) continue;
      }
      const [a, b, c, d, e, f] = ctm;
      let cx = 0;
      let cy = 0;
      let sx = 0;
      let sy = 0;
      const to = (x: number, y: number, isCurve: boolean) => {
        const nx = a * x + c * y + e;
        const ny = b * x + d * y + f;
        add(cx, cy, nx, ny, isCurve);
        cx = nx;
        cy = ny;
      };
      for (let p = 0; p < data.length; ) {
        switch (data[p++]) {
          case 0:
            cx = sx = a * data[p] + c * data[p + 1] + e;
            cy = sy = b * data[p] + d * data[p + 1] + f;
            p += 2;
            break;
          case 1:
            to(data[p], data[p + 1], false);
            p += 2;
            break;
          case 2:
            to(data[p + 4], data[p + 5], true);
            p += 6;
            break;
          case 3:
            to(data[p + 2], data[p + 3], true);
            p += 4;
            break;
          case 4:
            add(cx, cy, sx, sy, false);
            cx = sx;
            cy = sy;
            break;
          default:
            // An unknown code means the format changed; the rest of this path can't be read.
            p = data.length;
        }
      }
    }
  }

  return { coords: coords.slice(0, count * 4), curve: curve.slice(0, count), count };
}

/** Calls `visit` for each grid cell along a segment, roughly in order (a cell can repeat apart). */
function walkCells(index: Pick<SegmentIndex, "minX" | "minY" | "cell" | "cols">, c: Float32Array, s: number, visit: (cell: number) => void) {
  const { minX, minY, cell, cols } = index;
  const x1 = c[s * 4];
  const y1 = c[s * 4 + 1];
  const dx = c[s * 4 + 2] - x1;
  const dy = c[s * 4 + 3] - y1;
  const steps = Math.ceil(Math.hypot(dx, dy) / (cell / 2)) + 1;
  let last = -1;
  for (let i = 0; i <= steps; i++) {
    const col = Math.floor((x1 + (dx * i) / steps - minX) / cell);
    const row = Math.floor((y1 + (dy * i) / steps - minY) / cell);
    const at = row * cols + col;
    if (at !== last) visit(at);
    last = at;
  }
}

/** Puts the segments in a grid, so finding the ones under the cursor doesn't look at them all. */
export function buildSegmentIndex(segments: SnapSegments): SegmentIndex {
  const { coords, count } = segments;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count * 4; i += 2) {
    if (coords[i] < minX) minX = coords[i];
    if (coords[i] > maxX) maxX = coords[i];
    if (coords[i + 1] < minY) minY = coords[i + 1];
    if (coords[i + 1] > maxY) maxY = coords[i + 1];
  }
  if (count === 0) minX = minY = maxX = maxY = 0;
  const cell = Math.max(1, Math.max(maxX - minX, maxY - minY) / GRID_CELLS);
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const rows = Math.floor((maxY - minY) / cell) + 1;
  const grid = { minX, minY, cell, cols };

  const cellStart = new Int32Array(cols * rows + 1);
  for (let s = 0; s < count; s++) walkCells(grid, coords, s, (at) => cellStart[at + 1]++);
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c];
  const entries = new Int32Array(cellStart[cols * rows]);
  const next = cellStart.slice();
  for (let s = 0; s < count; s++) walkCells(grid, coords, s, (at) => (entries[next[at]++] = s));

  return { ...segments, ...grid, rows, cellStart, entries, seen: new Int32Array(count), stamp: 0 };
}

/** Where segments a and b cross, or null. Parallel ones don't count, even if they overlap. */
function crossing(a: Float64Array | number[], b: Float64Array | number[]): Point2D | null {
  const ax = a[2] - a[0];
  const ay = a[3] - a[1];
  const bx = b[2] - b[0];
  const by = b[3] - b[1];
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < 1e-6 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return null;
  const t = ((b[0] - a[0]) * by - (b[1] - a[1]) * bx) / denominator;
  const u = ((b[0] - a[0]) * ay - (b[1] - a[1]) * ax) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a[0] + t * ax, y: a[1] + t * ay };
}

/**
 * The point to snap to within `radius` of `cursor`: a line end or crossing if there is
 * one, else a midpoint, else (with `alongLines`) the nearest point on a line.
 */
export function findSnap(
  cursor: Point2D,
  radius: number,
  drawing: SegmentIndex | null,
  markups: MarkupSegment[],
  options: { alongLines: boolean; excludeId?: string | null },
): SnapHit | null {
  let bestEnd: Point2D | null = null;
  let bestEndDist = radius;
  let bestMid: Point2D | null = null;
  let bestMidDist = radius * MIDPOINT_RADIUS;
  let bestLine: Point2D | null = null;
  let bestLineDist = radius * ALONG_LINE_RADIUS;
  const nearby: { line: number[]; dist: number }[] = [];
  const { x, y } = cursor;

  const look = (x1: number, y1: number, x2: number, y2: number, isCurve: boolean) => {
    const toA = Math.hypot(x1 - x, y1 - y);
    const toB = Math.hypot(x2 - x, y2 - y);
    if (toA < bestEndDist) {
      bestEnd = { x: x1, y: y1 };
      bestEndDist = toA;
    }
    if (toB < bestEndDist) {
      bestEnd = { x: x2, y: y2 };
      bestEndDist = toB;
    }
    if (isCurve) return;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return;
    const t = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
    const onX = x1 + t * dx;
    const onY = y1 + t * dy;
    const toLine = Math.hypot(onX - x, onY - y);
    if (toLine > radius) return;
    nearby.push({ line: [x1, y1, x2, y2], dist: toLine });
    if (toLine < bestLineDist) {
      bestLine = { x: onX, y: onY };
      bestLineDist = toLine;
    }
    if (Math.sqrt(lengthSquared) < radius * MIN_MIDPOINT_LENGTH) return;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const toMid = Math.hypot(midX - x, midY - y);
    if (toMid < bestMidDist) {
      bestMid = { x: midX, y: midY };
      bestMidDist = toMid;
    }
  };

  for (const segment of markups) {
    if (segment.id !== options.excludeId) look(segment.a.x, segment.a.y, segment.b.x, segment.b.y, false);
  }

  if (drawing && drawing.count > 0) {
    const { coords, curve, cell, cols, rows, minX, minY, cellStart, entries, seen } = drawing;
    // One cell wider all round: a segment clipping a cell's corner may not be listed in it.
    const left = Math.max(0, Math.floor((x - radius - minX) / cell) - 1);
    const right = Math.min(cols - 1, Math.floor((x + radius - minX) / cell) + 1);
    const top = Math.max(0, Math.floor((y - radius - minY) / cell) - 1);
    const bottom = Math.min(rows - 1, Math.floor((y + radius - minY) / cell) + 1);
    const stamp = ++drawing.stamp;
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const at = row * cols + col;
        for (let e = cellStart[at]; e < cellStart[at + 1]; e++) {
          const s = entries[e];
          if (seen[s] === stamp) continue;
          seen[s] = stamp;
          look(coords[s * 4], coords[s * 4 + 1], coords[s * 4 + 2], coords[s * 4 + 3], curve[s] === 1);
        }
      }
    }
  }

  const closest =
    nearby.length > MAX_CROSSING_CANDIDATES
      ? nearby.sort((a, b) => a.dist - b.dist).slice(0, MAX_CROSSING_CANDIDATES)
      : nearby;
  let bestCrossing: Point2D | null = null;
  let bestCrossingDist = radius;
  for (let i = 0; i < closest.length; i++) {
    for (let j = i + 1; j < closest.length; j++) {
      const point = crossing(closest[i].line, closest[j].line);
      if (!point) continue;
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist < bestCrossingDist) {
        bestCrossing = point;
        bestCrossingDist = dist;
      }
    }
  }

  // Where lines simply meet at a corner both are the same spot, and "end" reads better.
  if (bestCrossing && bestCrossingDist < bestEndDist - radius * SAME_DISTANCE) {
    return { point: bestCrossing, kind: "intersection" };
  }
  if (bestEnd) return { point: bestEnd, kind: "end" };
  if (bestMid) return { point: bestMid, kind: "midpoint" };
  if (bestLine && options.alongLines) return { point: bestLine, kind: "line" };
  return null;
}

/** The edges of the sheet's measuring markups, to snap to. Freehand and text have no useful points. */
export function markupSnapSegments(
  source: { measurements: Measurement[]; rectangles: RectMeasurement[]; shapes: ShapeAnnotation[] },
  viewport: DocumentViewport,
): MarkupSegment[] {
  const segments: MarkupSegment[] = [];
  const addPath = (id: string, points: Point2D[], closed: boolean) => {
    for (let i = 0; i + 1 < points.length; i++) segments.push({ id, a: points[i], b: points[i + 1] });
    if (closed && points.length > 2) segments.push({ id, a: points[points.length - 1], b: points[0] });
  };
  for (const m of source.measurements) {
    if (!m.isCalibration) addPath(m.id, [m.start, m.end], false);
  }
  for (const r of source.rectangles) {
    // shortcut: an ellipse gives no snap points; sample its outline if snapping to it is wanted.
    if (r.ellipse) continue;
    // Through the frame, because a turned rectangle's corners aren't its stored ones.
    const frame = getTransformFrame({ kind: "rect", item: r }, viewport);
    if (frame) addPath(r.id, frame.corners.map((p) => toDocPoint(viewport, p.x, p.y)), true);
  }
  for (const s of source.shapes) {
    if (s.kind === "polyline") addPath(s.id, s.points, false);
    if (s.kind === "area") for (const ring of areaRings(s)) addPath(s.id, ring, true);
  }
  return segments;
}
