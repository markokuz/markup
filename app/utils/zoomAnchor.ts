export type ZoomAnchor = { clientX: number; clientY: number } | "center";

/** Set before dispatching SET_ZOOM so PdfViewer can adjust scroll position. */
export const pendingZoomAnchor: { current: ZoomAnchor | null } = { current: null };

export function setZoomAnchor(anchor: ZoomAnchor) {
  pendingZoomAnchor.current = anchor;
}

/** The canvas's p-6 padding, in px. */
const CANVAS_PADDING = 24;

/** Where the page starts along one axis of the scroll area: centred if it fits, else after the padding. */
function pageStart(pageSize: number, clientSize: number): number {
  return Math.max(CANVAS_PADDING, (clientSize - pageSize) / 2);
}

/**
 * Scroll position (one axis) that keeps the page point under `anchor`, in px from the
 * scroll area's edge, in place when the page goes from `pageSize` to `pageSize * scale`.
 * The browser clamps it when the page doesn't overflow enough to get there.
 */
export function scrollAfterZoom(
  scroll: number,
  anchor: number,
  pageSize: number,
  scale: number,
  clientSize: number,
): number {
  const onPage = scroll + anchor - pageStart(pageSize, clientSize);
  return pageStart(pageSize * scale, clientSize) + onPage * scale - anchor;
}

/**
 * Transform origin (one axis, px from the page's edge) for the wheel-zoom preview. The
 * page grows around the cursor, but once it fits it lands in the middle where it will
 * settle, so it doesn't jump when the zoom is committed.
 */
export function previewOrigin(
  scroll: number,
  anchor: number,
  pageSize: number,
  scale: number,
  clientSize: number,
): number {
  const start = pageStart(pageSize, clientSize) - scroll;
  const centred = (clientSize - pageSize * scale) / 2;
  return centred < CANVAS_PADDING ? anchor - start : (centred - start) / (1 - scale);
}
