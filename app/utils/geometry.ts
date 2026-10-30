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
