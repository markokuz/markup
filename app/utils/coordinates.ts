import type { DocumentViewport } from "@/app/utils/documentViewport";
import type { DocumentType, Measurement, Point2D, RectMeasurement } from "@/app/types";

export function toDocPoint(
  viewport: DocumentViewport,
  localX: number,
  localY: number,
): Point2D {
  return viewport.convertToDocPoint(localX, localY);
}

export function toScreenPoint(
  viewport: DocumentViewport,
  docX: number,
  docY: number,
): Point2D {
  return viewport.convertToViewportPoint(docX, docY);
}

export function docDistance(a: Point2D, b: Point2D): number {
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

/** Convert a screen-space label position to a document-space offset from an anchor. */
export function computeDocOffsetFromScreen(
  viewport: DocumentViewport,
  anchorDoc: Point2D,
  labelScreen: Point2D,
): Point2D {
  const labelDoc = toDocPoint(viewport, labelScreen.x, labelScreen.y);
  return {
    x: labelDoc.x - anchorDoc.x,
    y: labelDoc.y - anchorDoc.y,
  };
}

/** Convert a document-space label offset to screen coordinates. */
export function docLabelToScreen(
  viewport: DocumentViewport,
  anchorDoc: Point2D,
  offsetDoc: Point2D,
): Point2D {
  return toScreenPoint(
    viewport,
    anchorDoc.x + offsetDoc.x,
    anchorDoc.y + offsetDoc.y,
  );
}

/** Default label offset (16px above anchor) stored in document space. */
export function defaultScreenLabelOffsetDoc(
  viewport: DocumentViewport,
  anchorDoc: Point2D,
  screenOffset: Point2D = { x: 0, y: -16 },
): Point2D {
  const anchorScreen = toScreenPoint(viewport, anchorDoc.x, anchorDoc.y);
  return computeDocOffsetFromScreen(viewport, anchorDoc, {
    x: anchorScreen.x + screenOffset.x,
    y: anchorScreen.y + screenOffset.y,
  });
}

export function getLineLabelAnchorDoc(measurement: Measurement): Point2D {
  return midpoint(measurement.start, measurement.end);
}

export function getLineLabelDocPosition(measurement: Measurement): Point2D {
  const anchor = getLineLabelAnchorDoc(measurement);
  return {
    x: anchor.x + measurement.labelOffset.x,
    y: anchor.y + measurement.labelOffset.y,
  };
}

export function getRectWidthLabelAnchorDoc(
  rectangle: RectMeasurement,
  fileType: DocumentType,
): Point2D {
  const centerX = (rectangle.topLeft.x + rectangle.bottomRight.x) / 2;
  const visualTopY =
    fileType === "image" ? rectangle.topLeft.y : rectangle.bottomRight.y;
  return { x: centerX, y: visualTopY };
}

export function getRectHeightLabelAnchorDoc(rectangle: RectMeasurement): Point2D {
  const centerY = (rectangle.topLeft.y + rectangle.bottomRight.y) / 2;
  return { x: rectangle.topLeft.x, y: centerY };
}

export function getRectWidthLabelDocPosition(
  rectangle: RectMeasurement,
  fileType: DocumentType,
): Point2D {
  const anchor = getRectWidthLabelAnchorDoc(rectangle, fileType);
  return {
    x: anchor.x + rectangle.widthLabelOffset.x,
    y: anchor.y + rectangle.widthLabelOffset.y,
  };
}

export function getRectHeightLabelDocPosition(rectangle: RectMeasurement): Point2D {
  const anchor = getRectHeightLabelAnchorDoc(rectangle);
  return {
    x: anchor.x + rectangle.heightLabelOffset.x,
    y: anchor.y + rectangle.heightLabelOffset.y,
  };
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert doc-space bounds to a screen-space rect with positive width/height. */
export function toScreenRect(
  viewport: DocumentViewport,
  topLeft: Point2D,
  bottomRight: Point2D,
): ScreenRect {
  const p1 = toScreenPoint(viewport, topLeft.x, topLeft.y);
  const p2 = toScreenPoint(viewport, bottomRight.x, bottomRight.y);
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  return {
    x,
    y,
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/** Doc lengths of the screen-aligned horizontal and vertical edges (rotation-aware). */
export function getScreenRectEdgeDocLengths(
  viewport: DocumentViewport,
  topLeft: Point2D,
  bottomRight: Point2D,
): { horizontal: number; vertical: number } {
  const screen = toScreenRect(viewport, topLeft, bottomRight);
  return {
    horizontal: docDistance(
      toDocPoint(viewport, screen.x, screen.y),
      toDocPoint(viewport, screen.x + screen.width, screen.y),
    ),
    vertical: docDistance(
      toDocPoint(viewport, screen.x, screen.y),
      toDocPoint(viewport, screen.x, screen.y + screen.height),
    ),
  };
}

export type ScreenCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

const OPPOSITE_SCREEN_CORNER: Record<ScreenCorner, ScreenCorner> = {
  topLeft: "bottomRight",
  topRight: "bottomLeft",
  bottomLeft: "topRight",
  bottomRight: "topLeft",
};

export function getScreenCornerPoint(
  corner: ScreenCorner,
  rect: ScreenRect,
): Point2D {
  switch (corner) {
    case "topLeft":
      return { x: rect.x, y: rect.y };
    case "topRight":
      return { x: rect.x + rect.width, y: rect.y };
    case "bottomLeft":
      return { x: rect.x, y: rect.y + rect.height };
    case "bottomRight":
      return { x: rect.x + rect.width, y: rect.y + rect.height };
  }
}

export function getOppositeScreenCorner(corner: ScreenCorner): ScreenCorner {
  return OPPOSITE_SCREEN_CORNER[corner];
}

/** Convert two opposite screen corners back to doc-space min/max bounds. */
export function docRectFromScreenCorners(
  viewport: DocumentViewport,
  cornerA: Point2D,
  cornerB: Point2D,
): { topLeft: Point2D; bottomRight: Point2D } {
  const minX = Math.min(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const maxY = Math.max(cornerA.y, cornerB.y);

  const docP1 = toDocPoint(viewport, minX, minY);
  const docP2 = toDocPoint(viewport, maxX, maxY);

  return {
    topLeft: {
      x: Math.min(docP1.x, docP2.x),
      y: Math.min(docP1.y, docP2.y),
    },
    bottomRight: {
      x: Math.max(docP1.x, docP2.x),
      y: Math.max(docP1.y, docP2.y),
    },
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

/** Estimate rendered label width in screen pixels (matches DimensionLabel). */
export function estimateLabelWidth(label: string): number {
  return Math.max(label.length * 7 + 12, 48);
}

export interface InlineLineLayout {
  segment1Start: Point2D;
  segment1End: Point2D;
  segment2Start: Point2D;
  segment2End: Point2D;
  labelCenter: Point2D;
  angleDeg: number;
  labelWidth: number;
  showGap: boolean;
}

/** Keep inline dimension labels readable (never upside down). */
export function normalizeLabelAngleDeg(angleDeg: number): number {
  let angle = angleDeg;
  while (angle <= -90) angle += 180;
  while (angle > 90) angle -= 180;
  return angle;
}

function angleDiffDeg(a: number, b: number): number {
  let diff = a - b;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return Math.abs(diff);
}

/**
 * Label rotation for pdf-lib export: pick the PDF rotation aligned with the line
 * that displays the same upright orientation as the on-screen UI (Y-down viewer).
 */
export function computePdfLabelAngleDeg(start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineAnglePdf = (Math.atan2(dy, dx) * 180) / Math.PI;
  const labelAngleScreen = normalizeLabelAngleDeg(
    (Math.atan2(-dy, dx) * 180) / Math.PI,
  );

  const aligned = lineAnglePdf;
  const flipped = lineAnglePdf + 180;
  if (angleDiffDeg(-aligned, labelAngleScreen) < 0.001) {
    return aligned;
  }
  if (angleDiffDeg(-flipped, labelAngleScreen) < 0.001) {
    return flipped;
  }
  return aligned;
}

/** Split a line at its midpoint to leave a gap for an inline dimension label. */
export function computeInlineLineSegments(
  start: Point2D,
  end: Point2D,
  labelWidth: number,
  labelPadding = 4,
): InlineLineLayout {
  const gapHalf = (labelWidth + labelPadding * 2) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const center = midpoint(start, end);
  const angleDeg = normalizeLabelAngleDeg(
    (Math.atan2(dy, dx) * 180) / Math.PI,
  );

  if (length <= gapHalf * 2 + 4) {
    return {
      segment1Start: start,
      segment1End: end,
      segment2Start: end,
      segment2End: end,
      labelCenter: center,
      angleDeg,
      labelWidth,
      showGap: false,
    };
  }

  const ux = dx / length;
  const uy = dy / length;
  const seg1End = { x: center.x - ux * gapHalf, y: center.y - uy * gapHalf };
  const seg2Start = { x: center.x + ux * gapHalf, y: center.y + uy * gapHalf };

  return {
    segment1Start: start,
    segment1End: seg1End,
    segment2Start: seg2Start,
    segment2End: end,
    labelCenter: center,
    angleDeg,
    labelWidth,
    showGap: true,
  };
}

export interface InlineEdgeLayout {
  segment1Start: Point2D;
  segment1End: Point2D;
  segment2Start: Point2D;
  segment2End: Point2D;
  labelCenter: Point2D;
  angleDeg: number;
  showGap: boolean;
}

/** Split a horizontal or vertical edge for an inline dimension label. */
export function computeInlineEdgeSegments(
  edgeStart: Point2D,
  edgeEnd: Point2D,
  labelWidth: number,
  labelPadding = 4,
): InlineEdgeLayout {
  return computeInlineLineSegments(edgeStart, edgeEnd, labelWidth, labelPadding);
}

// Backwards-compatible aliases used across the app
export const toPdfPoint = toDocPoint;
export const pdfDistance = docDistance;
