import type { Point2D } from "@/app/types";

/** id of the <g> holding the rendered markups, mirrored live inside the loupe. */
export const ANNOTATION_ROOT_ID = "markup-annotation-root";

/**
 * Live info from the mounted document viewer for app-level shortcuts (paste).
 * Points are in overlay coordinates (CSS px from the page's top-left corner).
 */
export const viewerBridge: {
  /** Pointer position over the page, or null when the pointer is off it. */
  cursor: Point2D | null;
  /** Centre of the visible part of the page. */
  getVisibleCenter: (() => Point2D | null) | null;
  /** Zoom that fits the page on screen. */
  getFitZoom: ((mode: "page" | "width") => number | null) | null;
  /** Scrolls a document point to the middle of the view, unless it is already well inside it. */
  revealDocPoint: ((point: Point2D) => void) | null;
} = { cursor: null, getVisibleCenter: null, getFitZoom: null, revealDocPoint: null };

let pendingReveal: Point2D | null = null;

/** Document point to reveal when the next sheet opens. */
export function revealOnNextSheet(point: Point2D | null) {
  pendingReveal = point;
}

export function takePendingReveal(): Point2D | null {
  const point = pendingReveal;
  pendingReveal = null;
  return point;
}
