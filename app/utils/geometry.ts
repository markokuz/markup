import type { Point2D, Unit } from "@/app/types";

// Kept free of runtime imports so `node app/utils/geometry.test.mjs` can load it directly.

/** Unsigned polygon area (shoelace), in squared input units. */
export function polygonArea(points: Point2D[]): number {
  return Math.abs(signedArea(points));
}

function signedArea(points: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polylineLength(points: Point2D[], closed: boolean): number {
  let total = 0;
  const segments = closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** The point halfway along an open polyline, measured along its segments. */
export function polylineMidpoint(points: Point2D[]): Point2D {
  let remaining = polylineLength(points, false) / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** Area-weighted centroid; falls back to the vertex average for degenerate polygons. */
export function polygonCentroid(points: Point2D[]): Point2D {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Four corners of the axis-aligned box spanned by two points. */
export function boxCorners(a: Point2D, b: Point2D): Point2D[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

/** A cloud's outline: two points are box corners, more are a freehand polygon. */
/** Rotates `p` about `c` by `deg`, clockwise on a y-down screen (counter-clockwise in y-up space). */
export function rotateAround(p: Point2D, c: Point2D, deg: number): Point2D {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Corners (TL, TR, BR, BL) of a w×h box whose top-left is `anchor`, turned `deg` about it. */
/** Where the line from an axis-aligned box's centre towards `target` crosses the box's border. */
export function boxEdgePoint(
  box: { x: number; y: number; width: number; height: number },
  target: Point2D,
): Point2D {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  const t = Math.min(box.width / 2 / Math.abs(dx), box.height / 2 / Math.abs(dy));
  return Number.isFinite(t) ? { x: centre.x + dx * t, y: centre.y + dy * t } : centre;
}

export function rotatedBoxCorners(anchor: Point2D, w: number, h: number, deg: number): Point2D[] {
  return [
    anchor,
    rotateAround({ x: anchor.x + w, y: anchor.y }, anchor, deg),
    rotateAround({ x: anchor.x + w, y: anchor.y + h }, anchor, deg),
    rotateAround({ x: anchor.x, y: anchor.y + h }, anchor, deg),
  ];
}

export function cloudOutline(points: Point2D[]): Point2D[] {
  return points.length === 2 ? boxCorners(points[0], points[1]) : points;
}

function distanceToLine(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the simplified line. */
export function simplifyPath(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToLine(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Chaikin corner cutting on a closed loop; each pass doubles the point count. */
export function smoothClosedPath(points: Point2D[], iterations = 2): Point2D[] {
  let pts = points;
  for (let n = 0; n < iterations; n++) {
    const next: Point2D[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
      );
    }
    pts = next;
  }
  return pts;
}

/** Points evenly spaced (about `spacing` apart) along a closed polygon's perimeter. */
function resampleClosed(points: Point2D[], spacing: number): Point2D[] {
  const perimeter = polylineLength(points, true);
  const n = Math.max(3, Math.round(perimeter / spacing));
  const step = perimeter / n;
  const out: Point2D[] = [];
  let edge = 0;
  let edgeStart = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    let a = points[edge];
    let b = points[(edge + 1) % points.length];
    let len = Math.hypot(b.x - a.x, b.y - a.y);
    while (edgeStart + len < target && edge < points.length - 1) {
      edgeStart += len;
      edge++;
      a = points[edge];
      b = points[(edge + 1) % points.length];
      len = Math.hypot(b.x - a.x, b.y - a.y);
    }
    const t = len > 0 ? (target - edgeStart) / len : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * SVG path of a revision cloud around a polygon: each edge becomes a row of
 * semicircular scallops about `arcSize` long, always bulging outward.
 */
export function cloudPath(corners: Point2D[], arcSize: number): string {
  // Positive signed area makes SVG sweep-flag 1 bulge outward in any coordinate system.
  const oriented = signedArea(corners) >= 0 ? corners : [...corners].reverse();
  // Freehand outlines have many short edges; respace them so scallops come out even.
  const pts = oriented.length > 4 ? resampleClosed(oriented, arcSize) : oriented;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / arcSize));
    const r = len / n / 2;
    for (let k = 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      d += ` A ${r} ${r} 0 0 1 ${x} ${y}`;
    }
  }
  return `${d} Z`;
}

/**
 * Smooth open SVG path through a freehand stroke: a quadratic curve bends at each
 * point and the curves meet halfway between points.
 */
export function strokePath(points: Point2D[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  const last = points[points.length - 1];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    d += ` Q ${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
  }
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * A drawing's pieces: `points` is every piece end to end and `breaks` lists the
 * index where each piece after the first starts. No breaks means one piece.
 */
export function splitStrokes(points: Point2D[], breaks?: number[]): Point2D[][] {
  if (!breaks?.length) return points.length ? [points] : [];
  const starts = [0, ...breaks, points.length];
  const pieces: Point2D[][] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const piece = points.slice(starts[i], starts[i + 1]);
    if (piece.length) pieces.push(piece);
  }
  return pieces;
}

/** Inverse of `splitStrokes`; `breaks` is left out when there is only one piece. */
export function joinStrokes(pieces: Point2D[][]): { points: Point2D[]; breaks?: number[] } {
  const points: Point2D[] = [];
  const breaks: number[] = [];
  for (const piece of pieces) {
    if (points.length) breaks.push(points.length);
    points.push(...piece);
  }
  return breaks.length ? { points, breaks } : { points };
}

/** An area's closed rings: the outline first, then its cutouts. Rings under 3 points don't count. */
export function areaRings(shape: { points: Point2D[]; breaks?: number[] }): Point2D[][] {
  return splitStrokes(shape.points, shape.breaks).filter((ring) => ring.length >= 3);
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
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

/** Inside the outline and not in one of its cutouts. */
export function pointInRings(point: Point2D, rings: Point2D[][]): boolean {
  const [outline, ...holes] = rings;
  return !!outline && pointInPolygon(point, outline) && !holes.some((hole) => pointInPolygon(point, hole));
}

/** The topmost unlocked area (not a plain polygon) `point` is inside, for starting a cutout there. */
export function areaToCutAt<T extends { kind: string; locked?: boolean; plain?: boolean; points: Point2D[]; breaks?: number[] }>(
  shapes: T[],
  point: Point2D,
): T | undefined {
  return shapes.findLast((s) => s.kind === "area" && !s.plain && !s.locked && pointInRings(point, areaRings(s)));
}

/** SVG path of straight segments through `points`, left open. */
export function polylinePath(points: Point2D[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * SVG path for an area's rings, with cutouts wound against the outline. That makes the
 * default nonzero fill leave them empty everywhere: pdf-lib's drawSvgPath has no even-odd.
 */
export function ringsPath(rings: Point2D[][]): string {
  const outlineSign = Math.sign(signedArea(rings[0] ?? []));
  return rings
    .map((ring, index) => {
      const sameWay = index > 0 && Math.sign(signedArea(ring)) === outlineSign;
      return `${polylinePath(sameWay ? [...ring].reverse() : ring)} Z`;
    })
    .join(" ");
}

/** SVG path for every piece of a drawing. */
export function strokesPath(pieces: Point2D[][]): string {
  return pieces
    .filter((piece) => piece.length >= 2)
    .map(strokePath)
    .join(" ");
}

function polylineSpan(points: Point2D[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

/**
 * Cut away every part of the pieces within `radius` of `centre`, splitting a piece
 * where the cut falls in its middle. Leftovers shorter than `minLength` are dropped.
 * Returns null when the circle touches nothing, so callers can skip the update.
 */
export function eraseFromStrokes(
  pieces: Point2D[][],
  centre: Point2D,
  radius: number,
  minLength = 0,
): Point2D[][] | null {
  const r2 = radius * radius;
  let touched = false;
  const out: Point2D[][] = [];
  const keep = (piece: Point2D[]) => {
    if (piece.length >= 2 && polylineSpan(piece) > minLength) out.push(piece);
  };

  for (const piece of pieces) {
    if (piece.length < 2) continue;
    let current: Point2D[] = [];
    for (let i = 0; i < piece.length - 1; i++) {
      const a = piece[i];
      const b = piece[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const fx = a.x - centre.x;
      const fy = a.y - centre.y;
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const qc = fx * fx + fy * fy - r2;
      // The part of a→b (t in 0..1) inside the circle, if any.
      let cut: [number, number] | null = null;
      if (qa === 0) {
        if (qc < 0) cut = [0, 1];
      } else {
        const disc = qb * qb - 4 * qa * qc;
        if (disc > 0) {
          const root = Math.sqrt(disc);
          const t0 = (-qb - root) / (2 * qa);
          const t1 = (-qb + root) / (2 * qa);
          if (t1 > 0 && t0 < 1) cut = [Math.max(0, t0), Math.min(1, t1)];
        }
      }
      const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });

      if (!cut) {
        if (current.length === 0) current.push(a);
        current.push(b);
        continue;
      }
      touched = true;
      const [s, e] = cut;
      if (s > 0) {
        if (current.length === 0) current.push(a);
        current.push(at(s));
      }
      keep(current);
      current = e < 1 ? [at(e), b] : [];
    }
    keep(current);
  }
  return touched ? out : null;
}

const AREA_SUFFIX: Record<Unit, string> = {
  ft: "sq ft",
  in: "sq in",
  m: "m²",
  mm: "mm²",
};

export function formatArea(value: number, unit: Unit): string {
  const decimals = unit === "mm" ? 0 : value < 100 ? 2 : 1;
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${text} ${AREA_SUFFIX[unit]}`;
}
