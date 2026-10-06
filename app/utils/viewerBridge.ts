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
} = { cursor: null, getVisibleCenter: null };
