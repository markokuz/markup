import type { PageViewport } from "pdfjs-dist";
import type { Point2D } from "@/app/types";

export function toPdfPoint(
  viewport: PageViewport,
  localX: number,
  localY: number,
): Point2D {
  const [x, y] = viewport.convertToPdfPoint(localX, localY);
  return { x, y };
}

export function toScreenPoint(
  viewport: PageViewport,
  pdfX: number,
  pdfY: number,
): Point2D {
  const [x, y] = viewport.convertToViewportPoint(pdfX, pdfY);
  return { x, y };
}

export function pdfDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getLocalCoords(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): Point2D {
  const rect = element.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function distanceToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  );
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;

  return Math.hypot(point.x - projX, point.y - projY);
}
