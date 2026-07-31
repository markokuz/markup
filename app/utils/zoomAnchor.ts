export type ZoomAnchor = { clientX: number; clientY: number } | "center";

/** Set before dispatching SET_ZOOM so PdfViewer can adjust scroll position. */
export const pendingZoomAnchor: { current: ZoomAnchor | null } = { current: null };

export function setZoomAnchor(anchor: ZoomAnchor) {
  pendingZoomAnchor.current = anchor;
}
