import {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
  LineJoinStyle,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  LineCapStyle,
  setLineCap,
  setLineJoin,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type {
  DocumentType,
  Measurement,
  NoteAnnotation,
  Point2D,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
  Unit,
} from "@/app/types";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import {
  DEFAULT_ANNOTATION_COLOR,
  hexToRgb,
} from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import {
  computeDimensionLayout,
  computeInlineEdgeSegments,
  computePdfLabelAngleDeg,
  docDistance,
  midpoint,
  MIDPOINT_TICK_HALF_PX,
  midpointTickEnds,
  type ArrowSpec,
} from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import { loadImageSource } from "@/app/utils/loadImage";
import {
  getScreenAxes,
  NOTE_CARD,
  noteTextWidth,
  rotateScreenUp,
  TEXT_DEFAULT_SIZE,
  TEXT_LINE_HEIGHT,
  textFont,
  textLines,
  wrapNoteText,
} from "@/app/utils/noteLayout";
import {
  areaRings,
  cloudOutline,
  cloudPath,
  polygonCentroid,
  polylineMidpoint,
  polylinePath,
  ringsPath,
  splitStrokes,
  strokesPath,
} from "@/app/utils/geometry";
import {
  areaOutline,
  CALLOUT_LEADER_OFFSET,
  countStartAt,
  DRAW_DEFAULT_WIDTH,
  drawWidth,
  getShapeLabel,
} from "@/app/utils/shapeMetrics";

interface ExportStyle {
  lineWidth: number;
  borderWidth: number;
  fontSize: number;
  arrowLen: number;
  arrowHalfWidth: number;
  midpointTickHalf: number;
}

/**
 * Markup sizes for a save, in document units: the on-screen 2 px stroke and 12 px label
 * as they'd look at `zoom`. Scaling by page size instead makes markups huge on
 * large-format drawings.
 */
function getExportStyle(zoom: number): ExportStyle {
  const scale = 1 / Math.max(zoom, 0.0001);
  return {
    lineWidth: 2 * scale,
    borderWidth: 2 * scale,
    fontSize: 12 * scale,
    arrowLen: 9 * scale,
    arrowHalfWidth: 4 * scale,
    midpointTickHalf: MIDPOINT_TICK_HALF_PX * scale,
  };
}

/**
 * Doc-space direction that reads as "up" on screen. Keeps labels lifted off short
 * lines on the same side as the editor, whatever the doc's y-axis or view rotation.
 */
export function getScreenUpDocDirection(
  viewport: DocumentViewport | null,
  fileType: DocumentType,
): Point2D {
  if (viewport) {
    const a = viewport.convertToDocPoint(0, 0);
    const b = viewport.convertToDocPoint(0, -1);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0) return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  }
  // Unrotated defaults: PDF space is y-up, image pixels are y-down.
  return fileType === "pdf" ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

function getMeasurementLabel(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): string {
  const dist = docDistance(measurement.start, measurement.end);
  const value = convertUnits(
    dist * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}

function getRectDimensionLabel(
  docLength: number,
  scale: Scale,
  displayUnit: Unit,
): string {
  const value = convertUnits(
    docLength * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}

function getExportMeasurements(measurements: Measurement[]): Measurement[] {
  return measurements.filter((m) => !m.isCalibration);
}

function getLineColor(measurement: Measurement): string {
  return measurement.color ?? DEFAULT_ANNOTATION_COLOR;
}

function getRectangleColor(rectangle: RectMeasurement): string {
  return rectangle.color ?? DEFAULT_ANNOTATION_COLOR;
}

function getNoteColor(note: NoteAnnotation): string {
  return note.color ?? DEFAULT_ANNOTATION_COLOR;
}

/**
 * Tight label width for exports: just enough gap for the text to sit in without
 * leaving empty space on either side. Unlike the on-screen version there is no
 * pill background here, so a fixed min-width would leave visible gaps around
 * short labels ("35", '13"', etc.).
 */
function measureCanvasLabelWidth(
  context: CanvasRenderingContext2D,
  label: string,
  fontSize: number,
): number {
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  return context.measureText(label).width + fontSize * 0.5;
}

function measurePdfLabelWidth(font: PDFFont, label: string, fontSize: number): number {
  return font.widthOfTextAtSize(label, fontSize) + fontSize * 0.5;
}

function drawDocLineSegment(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function fillArrowOnCanvas(
  context: CanvasRenderingContext2D,
  arrow: ArrowSpec,
  arrowLen: number,
  arrowHalfWidth: number,
  color: string,
) {
  if (arrowLen <= 0) return;
  const { tip, dir } = arrow;
  const perp = { x: -dir.y, y: dir.x };
  const baseX = tip.x - dir.x * arrowLen;
  const baseY = tip.y - dir.y * arrowLen;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(baseX + perp.x * arrowHalfWidth, baseY + perp.y * arrowHalfWidth);
  context.lineTo(baseX - perp.x * arrowHalfWidth, baseY - perp.y * arrowHalfWidth);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawInlineLineOnCanvas(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
  lineWidth: number,
  label: string | null,
  fontSize: number,
  arrowLen: number,
  arrowHalfWidth: number,
  upDir: Point2D,
) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;

  const labelWidth = label ? measureCanvasLabelWidth(context, label, fontSize) : 0;
  const layout = computeDimensionLayout(start, end, labelWidth, arrowLen, 4, upDir);

  if (layout.showGap && label) {
    drawDocLineSegment(context, layout.segment1Start, layout.segment1End);
    drawDocLineSegment(context, layout.segment2Start, layout.segment2End);
  } else {
    drawDocLineSegment(context, layout.fullStart, layout.fullEnd);
  }

  fillArrowOnCanvas(context, layout.arrowStart, arrowLen, arrowHalfWidth, color);
  fillArrowOnCanvas(context, layout.arrowEnd, arrowLen, arrowHalfWidth, color);

  if (!label) return;

  const center = layout.labelCenter;
  context.save();
  context.translate(center.x, center.y);
  context.rotate((layout.angleDeg * Math.PI) / 180);
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = Math.max(fontSize * 0.25, 1);
  context.strokeStyle = "#ffffff";
  context.lineJoin = "round";
  context.strokeText(label, 0, 0);
  context.fillStyle = color;
  context.fillText(label, 0, 0);
  context.restore();
}

function fillArrowOnPdf(
  page: PDFPage,
  arrow: ArrowSpec,
  arrowLen: number,
  arrowHalfWidth: number,
  color: ReturnType<typeof rgb>,
) {
  if (arrowLen <= 0) return;
  const { tip, dir } = arrow;
  const perp = { x: -dir.y, y: dir.x };
  const baseX = tip.x - dir.x * arrowLen;
  const baseY = tip.y - dir.y * arrowLen;
  const c1 = { x: baseX + perp.x * arrowHalfWidth, y: baseY + perp.y * arrowHalfWidth };
  const c2 = { x: baseX - perp.x * arrowHalfWidth, y: baseY - perp.y * arrowHalfWidth };
  // drawSvgPath maps a path point (px,py) to PDF (x+px, y-py); negate y to land
  // the triangle at absolute PDF coordinates.
  const path = `M ${tip.x} ${-tip.y} L ${c1.x} ${-c1.y} L ${c2.x} ${-c2.y} Z`;
  page.drawSvgPath(path, { x: 0, y: 0, scale: 1, color, borderWidth: 0 });
}

function drawInlineLineOnPdf(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: ReturnType<typeof rgb>,
  thickness: number,
  label: string | null,
  fontSize: number,
  font: PDFFont,
  arrowLen: number,
  arrowHalfWidth: number,
  upDir: Point2D,
) {
  const labelWidth = label ? measurePdfLabelWidth(font, label, fontSize) : 0;
  const layout = computeDimensionLayout(start, end, labelWidth, arrowLen, 4, upDir);

  if (layout.showGap && label) {
    page.drawLine({ start: layout.segment1Start, end: layout.segment1End, thickness, color });
    page.drawLine({ start: layout.segment2Start, end: layout.segment2End, thickness, color });
  } else {
    page.drawLine({ start: layout.fullStart, end: layout.fullEnd, thickness, color });
  }

  fillArrowOnPdf(page, layout.arrowStart, arrowLen, arrowHalfWidth, color);
  fillArrowOnPdf(page, layout.arrowEnd, arrowLen, arrowHalfWidth, color);

  if (!label) return;

  const angleDeg = computePdfLabelAngleDeg(start, end);
  const rad = (angleDeg * Math.PI) / 180;
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  const baselineOffset = fontSize * 0.35;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = layout.labelCenter.x;
  const cy = layout.labelCenter.y;
  const x = cx - (textWidth / 2) * cos + baselineOffset * sin;
  const y = cy - (textWidth / 2) * sin - baselineOffset * cos;

  page.drawText(label, {
    x,
    y,
    size: fontSize,
    font,
    color,
    rotate: degrees(angleDeg),
  });
}

function drawRotatedLabelOnPdf(
  page: PDFPage,
  center: { x: number; y: number },
  label: string,
  angleDeg: number,
  fontSize: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  const baselineOffset = fontSize * 0.35;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = center.x - (textWidth / 2) * cos + baselineOffset * sin;
  const y = center.y - (textWidth / 2) * sin - baselineOffset * cos;

  page.drawText(label, {
    x,
    y,
    size: fontSize,
    font,
    color,
    rotate: degrees(angleDeg),
  });
}

function drawRotatedLabelOnCanvas(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  label: string,
  angleDeg: number,
  fontSize: number,
  color: string,
) {
  context.save();
  context.translate(center.x, center.y);
  context.rotate((angleDeg * Math.PI) / 180);
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 0);
  context.restore();
}

function drawMeasurementOnCanvas(
  context: CanvasRenderingContext2D,
  measurement: Measurement,
  scale: Scale | null,
  displayUnit: Unit,
  style: ExportStyle,
  upDir: Point2D,
) {
  const color = getLineColor(measurement);
  const label =
    scale && !measurement.plain ? getMeasurementLabel(measurement, scale, displayUnit) : null;

  drawInlineLineOnCanvas(
    context,
    measurement.start,
    measurement.end,
    color,
    style.lineWidth,
    label,
    style.fontSize,
    measurement.plain ? 0 : style.arrowLen,
    style.arrowHalfWidth,
    upDir,
  );

  const tick =
    measurement.plain && measurement.midpointTick
      ? midpointTickEnds(measurement.start, measurement.end, style.midpointTickHalf)
      : null;
  if (tick) drawDocLineSegment(context, tick[0], tick[1]);
}

function drawRectangleOnCanvas(
  context: CanvasRenderingContext2D,
  rectangle: RectMeasurement,
  scale: Scale | null,
  displayUnit: Unit,
  style: ExportStyle,
) {
  const color = getRectangleColor(rectangle);
  const x = rectangle.topLeft.x;
  const y = rectangle.topLeft.y;
  const width = rectangle.bottomRight.x - rectangle.topLeft.x;
  const height = rectangle.bottomRight.y - rectangle.topLeft.y;

  const topLeft = { x, y };
  const topRight = { x: x + width, y };
  const bottomRight = { x: x + width, y: y + height };
  const bottomLeft = { x, y: y + height };

  context.strokeStyle = color;
  context.lineWidth = style.borderWidth;

  const docWidth = getRectDocWidth(rectangle);
  const docHeightValue = getRectDocHeight(rectangle);
  const widthLabel =
    scale && docWidth > 0 && !rectangle.plain
      ? getRectDimensionLabel(docWidth, scale, displayUnit)
      : null;
  const heightLabel =
    scale && docHeightValue > 0 && !rectangle.plain
      ? getRectDimensionLabel(docHeightValue, scale, displayUnit)
      : null;

  if (widthLabel) {
    const labelWidth = measureCanvasLabelWidth(context, widthLabel, style.fontSize);
    const topEdge = computeInlineEdgeSegments(topLeft, topRight, labelWidth);
    if (topEdge.showGap) {
      drawDocLineSegment(context, topEdge.segment1Start, topEdge.segment1End);
      drawDocLineSegment(context, topEdge.segment2Start, topEdge.segment2End);
    } else {
      drawDocLineSegment(context, topLeft, topRight);
    }
    drawRotatedLabelOnCanvas(
      context,
      topEdge.labelCenter,
      widthLabel,
      topEdge.angleDeg,
      style.fontSize,
      color,
    );
  } else {
    drawDocLineSegment(context, topLeft, topRight);
  }

  drawDocLineSegment(context, topRight, bottomRight);
  drawDocLineSegment(context, bottomRight, bottomLeft);

  if (heightLabel) {
    const labelWidth = measureCanvasLabelWidth(context, heightLabel, style.fontSize);
    const leftEdge = computeInlineEdgeSegments(topLeft, bottomLeft, labelWidth);
    if (leftEdge.showGap) {
      drawDocLineSegment(context, leftEdge.segment1Start, leftEdge.segment1End);
      drawDocLineSegment(context, leftEdge.segment2Start, leftEdge.segment2End);
    } else {
      drawDocLineSegment(context, topLeft, bottomLeft);
    }
    drawRotatedLabelOnCanvas(
      context,
      leftEdge.labelCenter,
      heightLabel,
      leftEdge.angleDeg,
      style.fontSize,
      color,
    );
  } else {
    drawDocLineSegment(context, topLeft, bottomLeft);
  }
}

interface NoteCardLayout {
  lines: string[];
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  accentWidth: number;
}

function layoutNoteCard(
  text: string,
  zoom: number,
  measureAtSize: (s: string, size: number) => number,
  cardWidth?: number,
): NoteCardLayout {
  const k = 1 / Math.max(zoom, 0.0001);
  const fontSize = NOTE_CARD.fontSize * k;
  const padX = NOTE_CARD.padX * k;
  const accentWidth = NOTE_CARD.accentWidth * k;
  const measure = (s: string) => measureAtSize(s, fontSize);
  const lines = wrapNoteText(text, measure, noteTextWidth(cardWidth) * k);
  const textWidth = Math.max(...lines.map(measure));
  return {
    lines,
    width: cardWidth
      ? cardWidth * k
      : Math.max(textWidth + padX * 2 + accentWidth, NOTE_CARD.minWidth * k),
    height: lines.length * NOTE_CARD.lineHeight * k + NOTE_CARD.padY * 2 * k,
    fontSize,
    lineHeight: NOTE_CARD.lineHeight * k,
    padX,
    padY: NOTE_CARD.padY * k,
    accentWidth,
  };
}

/** Draws a note card whose top-left sits at `anchor`, aligned to the screen view. */
function drawNoteCardOnCanvas(
  context: CanvasRenderingContext2D,
  anchor: Point2D,
  text: string,
  color: string,
  zoom: number,
  upDir: Point2D,
  cardWidth?: number,
) {
  const font = (size: number) => `${size}px Helvetica, Arial, sans-serif`;
  const layout = layoutNoteCard(
    text,
    zoom,
    (s, size) => {
      context.font = font(size);
      return context.measureText(s).width;
    },
    cardWidth,
  );
  const { right } = getScreenAxes(upDir, false);

  context.save();
  context.translate(anchor.x, anchor.y);
  context.rotate(Math.atan2(right.y, right.x));
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.fillRect(0, 0, layout.width, layout.height);
  context.strokeStyle = `${color}99`;
  context.lineWidth = layout.fontSize / 13;
  context.strokeRect(0, 0, layout.width, layout.height);
  context.fillStyle = color;
  context.fillRect(0, 0, layout.accentWidth, layout.height);

  context.font = font(layout.fontSize);
  context.fillStyle = NOTE_CARD.textColor;
  context.textBaseline = "middle";
  layout.lines.forEach((line, i) => {
    context.fillText(
      line,
      layout.accentWidth + layout.padX,
      layout.padY + (i + 0.5) * layout.lineHeight,
    );
  });
  context.restore();
}

const PDF_TEXT_SWAPS: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "→": "->",
  "←": "<-",
  "−": "-",
  "≠": "!=",
  "≈": "~",
  "⌀": "Ø",
  "′": "'",
  "″": '"',
  "\t": " ",
  "\r": "",
};

/**
 * `text` with anything the standard PDF font can't draw swapped out; drawing it would throw.
 * shortcut: other viewers show "?" for non-Latin text, embed a Unicode font if that matters.
 * The editable text saved in the PDF keeps the original, so reopening here shows it intact.
 */
function drawableText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text, (char) => {
    const swap = PDF_TEXT_SWAPS[char];
    if (swap !== undefined) return swap;
    return char === "\n" || supported.has(char.codePointAt(0)!) ? char : "?";
  }).join("");
}

function drawNoteCardOnPdf(
  page: PDFPage,
  anchor: Point2D,
  text: string,
  color: string,
  zoom: number,
  upDir: Point2D,
  font: PDFFont,
  cardWidth?: number,
) {
  const layout = layoutNoteCard(
    drawableText(font, text),
    zoom,
    (s, size) => font.widthOfTextAtSize(s, size),
    cardWidth,
  );
  const { right, down } = getScreenAxes(upDir, true);
  const rotate = degrees((Math.atan2(right.y, right.x) * 180) / Math.PI);
  const at = (dx: number, dy: number) => ({
    x: anchor.x + right.x * dx + down.x * dy,
    y: anchor.y + right.y * dx + down.y * dy,
  });
  const { r, g, b } = hexToRgb(color);
  const accent = rgb(r, g, b);
  // pdf-lib rotates rectangles and text about their bottom-left corner / baseline start.
  const bottomLeft = at(0, layout.height);

  page.drawRectangle({
    ...bottomLeft,
    width: layout.width,
    height: layout.height,
    rotate,
    color: rgb(1, 1, 1),
    opacity: 0.96,
    borderColor: accent,
    borderOpacity: 0.6,
    borderWidth: layout.fontSize / 13,
  });
  page.drawRectangle({
    ...bottomLeft,
    width: layout.accentWidth,
    height: layout.height,
    rotate,
    color: accent,
  });

  const { r: tr, g: tg, b: tb } = hexToRgb(NOTE_CARD.textColor);
  layout.lines.forEach((line, i) => {
    if (!line) return;
    // Baseline sits ~0.35em below the line's vertical centre.
    const baseline = layout.padY + (i + 0.5) * layout.lineHeight + layout.fontSize * 0.35;
    page.drawText(line, {
      ...at(layout.accentWidth + layout.padX, baseline),
      size: layout.fontSize,
      font,
      color: rgb(tr, tg, tb),
      rotate,
    });
  });
}

/** Screen-px sizes used on canvas, divided by zoom so exports match the editor. */
const SHAPE_PX = { cloudArc: 14, countRadius: 9, countFont: 10 };

function shapeColor(shape: ShapeAnnotation): string {
  return shape.color ?? DEFAULT_ANNOTATION_COLOR;
}

/** White pill with dark text, matching ShapeLabel on screen. */
function drawPillLabelOnCanvas(
  context: CanvasRenderingContext2D,
  center: Point2D,
  label: string,
  angleDeg: number,
  fontSize: number,
  color: string,
) {
  context.save();
  context.translate(center.x, center.y);
  context.rotate((angleDeg * Math.PI) / 180);
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  const width = context.measureText(label).width + fontSize * 1.2;
  const height = fontSize * 1.8;
  context.beginPath();
  context.roundRect(-width / 2, -height / 2, width, height, height / 2);
  context.fillStyle = "rgba(255, 255, 255, 0.95)";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = fontSize / 12;
  context.stroke();
  context.fillStyle = NOTE_CARD.textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 0);
  context.restore();
}

function drawPillLabelOnPdf(
  page: PDFPage,
  center: Point2D,
  label: string,
  upDir: Point2D,
  fontSize: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const { right, down } = getScreenAxes(upDir, true);
  const angleDeg = (Math.atan2(right.y, right.x) * 180) / Math.PI;
  const width = font.widthOfTextAtSize(label, fontSize) + fontSize * 1.2;
  const height = fontSize * 1.8;
  // pdf-lib rotates rectangles about their bottom-left corner.
  page.drawRectangle({
    x: center.x - (right.x * width) / 2 + (down.x * height) / 2,
    y: center.y - (right.y * width) / 2 + (down.y * height) / 2,
    width,
    height,
    rotate: degrees(angleDeg),
    color: rgb(1, 1, 1),
    opacity: 0.95,
    borderColor: color,
    borderWidth: fontSize / 12,
  });
  const { r, g, b } = hexToRgb(NOTE_CARD.textColor);
  drawRotatedLabelOnPdf(page, center, label, angleDeg, fontSize, font, rgb(r, g, b));
}

/** Snapshot markups: images whose points are their TL, TR, BR, BL corners in doc space. */
function getSnapshots(shapes: ShapeAnnotation[]) {
  return shapes.filter(
    (s): s is ShapeAnnotation & { image: string } =>
      s.kind === "image" && !!s.image && s.points.length === 4,
  );
}

/** The snapshot's pixels, with its linework recoloured when the user picked a colour. */
async function loadSnapshotImage(shape: { image: string; color?: string }) {
  const image = new Image();
  image.src = shape.image;
  await image.decode();
  if (!shape.color) return image;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return image;
  context.drawImage(image, 0, 0);
  // Keep each pixel's alpha (the linework), replace its colour.
  context.globalCompositeOperation = "source-in";
  context.fillStyle = shape.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

async function drawSnapshotsOnCanvas(context: CanvasRenderingContext2D, shapes: ShapeAnnotation[]) {
  for (const shape of getSnapshots(shapes)) {
    const image = await loadSnapshotImage(shape);
    const [tl, tr, , bl] = shape.points;
    context.save();
    // Unit square mapped onto the corners, so any 90° turn from a cross-tab paste is kept.
    context.transform(tr.x - tl.x, tr.y - tl.y, bl.x - tl.x, bl.y - tl.y, tl.x, tl.y);
    context.drawImage(image, 0, 0, 1, 1);
    context.restore();
  }
}

async function drawSnapshotsOnPdf(pdfDoc: PDFDocument, page: PDFPage, shapes: ShapeAnnotation[]) {
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const shape of getSnapshots(shapes)) {
    const key = `${shape.color ?? ""}|${shape.image}`;
    let image = embedded.get(key);
    if (!image) {
      const source = await loadSnapshotImage(shape);
      image = await pdfDoc.embedPng(
        source instanceof HTMLCanvasElement ? source.toDataURL("image/png") : shape.image,
      );
      embedded.set(key, image);
    }
    const name = page.node.newXObject("Image", image.ref);
    const [tl, tr, , bl] = shape.points;
    // PDF images fill the unit square from their bottom-left corner, y-up.
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(tr.x - tl.x, tr.y - tl.y, tl.x - bl.x, tl.y - bl.y, bl.x, bl.y),
      drawObject(name),
      popGraphicsState(),
    );
  }
}

function drawShapesOnCanvas(
  context: CanvasRenderingContext2D,
  shapes: ShapeAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  style: ExportStyle,
  zoom: number,
  upDir: Point2D,
) {
  const k = 1 / Math.max(zoom, 0.0001);
  const { right, down } = getScreenAxes(upDir, false);
  const textAngle = (Math.atan2(right.y, right.x) * 180) / Math.PI;

  for (const shape of shapes) {
    const color = shapeColor(shape);
    const label = getShapeLabel(shape, scale, displayUnit);
    context.strokeStyle = color;
    context.lineWidth = style.borderWidth;

    if (shape.kind === "area" && shape.points.length >= 3) {
      const path = new Path2D(ringsPath(areaRings(shape)));
      context.fillStyle = `${color}2e`;
      context.fill(path);
      context.stroke(path);
      if (label) {
        drawPillLabelOnCanvas(context, polygonCentroid(areaOutline(shape)), label, textAngle, style.fontSize, color);
      }
    } else if (shape.kind === "polyline" && shape.points.length >= 2) {
      const path = new Path2D();
      shape.points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
      context.save();
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke(path);
      context.restore();
      if (label) {
        drawPillLabelOnCanvas(context, polylineMidpoint(shape.points), label, textAngle, style.fontSize, color);
      }
    } else if (shape.kind === "count") {
      shape.points.forEach((p, i) => {
        context.beginPath();
        context.arc(p.x, p.y, SHAPE_PX.countRadius * k, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        drawRotatedLabelOnCanvas(context, p, String(countStartAt(shape) + i), textAngle, SHAPE_PX.countFont * k, "#ffffff");
      });
    } else if (shape.kind === "cloud" && shape.points.length >= 2) {
      const corners = cloudOutline(shape.points);
      // Scallops meet at cusps; the default miter join turns those into spikes.
      const cloud = new Path2D(cloudPath(corners, SHAPE_PX.cloudArc * k));
      context.save();
      context.fillStyle = `${color}1f`;
      context.fill(cloud);
      context.lineJoin = "round";
      context.stroke(cloud);
      context.restore();
    } else if (shape.kind === "draw" && shape.points.length >= 2) {
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = style.borderWidth * (drawWidth(shape) / DRAW_DEFAULT_WIDTH);
      context.stroke(new Path2D(strokesPath(splitStrokes(shape.points, shape.breaks))));
      context.restore();
    } else if (shape.kind === "callout" && shape.points.length === 2) {
      const [tip, anchor] = shape.points;
      const end = {
        x: anchor.x + down.x * CALLOUT_LEADER_OFFSET.y * k,
        y: anchor.y + down.y * CALLOUT_LEADER_OFFSET.y * k,
      };
      const len = Math.hypot(tip.x - end.x, tip.y - end.y) || 1;
      drawDocLineSegment(context, end, tip);
      fillArrowOnCanvas(
        context,
        { tip, dir: { x: (tip.x - end.x) / len, y: (tip.y - end.y) / len } },
        style.arrowLen,
        style.arrowHalfWidth,
        color,
      );
      drawNoteCardOnCanvas(context, anchor, shape.text ?? "", color, zoom, upDir);
    } else if (shape.kind === "text" && shape.points.length >= 1) {
      const size = shape.fontSize ?? TEXT_DEFAULT_SIZE;
      const anchor = shape.points[0];
      const turned = getScreenAxes(rotateScreenUp(upDir, shape.rotation ?? 0, false), false).right;
      context.save();
      context.translate(anchor.x, anchor.y);
      context.rotate(Math.atan2(turned.y, turned.x));
      context.font = textFont(size, shape.bold, shape.italic);
      context.fillStyle = color;
      context.textBaseline = "top";
      textLines(shape.text).forEach((line, i) => {
        context.fillText(line, 0, (i * TEXT_LINE_HEIGHT + (TEXT_LINE_HEIGHT - 1) / 2) * size);
      });
      context.restore();
    }
  }
}

/** Helvetica faces for free text, keyed "" | "b" | "i" | "bi". */
type TextFonts = Record<string, PDFFont>;

async function embedTextFonts(pdfDoc: PDFDocument, regular: PDFFont): Promise<TextFonts> {
  const [b, i, bi] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  ]);
  return { "": regular, b, i, bi };
}

function drawShapesOnPdf(
  page: PDFPage,
  shapes: ShapeAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  style: ExportStyle,
  zoom: number,
  upDir: Point2D,
  font: PDFFont,
  textFonts: TextFonts,
) {
  const k = 1 / Math.max(zoom, 0.0001);
  const { right, down } = getScreenAxes(upDir, true);
  const textAngle = (Math.atan2(right.y, right.x) * 180) / Math.PI;
  // drawSvgPath maps path (px, py) to PDF (px, -py); flip y so paths use absolute PDF coords.
  const flip = (p: Point2D) => ({ x: p.x, y: -p.y });

  for (const shape of shapes) {
    const { r, g, b } = hexToRgb(shapeColor(shape));
    const color = rgb(r, g, b);
    const label = getShapeLabel(shape, scale, displayUnit);

    if (shape.kind === "area" && shape.points.length >= 3) {
      page.drawSvgPath(ringsPath(areaRings(shape).map((ring) => ring.map(flip))), {
        x: 0,
        y: 0,
        color,
        opacity: 0.18,
        borderColor: color,
        borderWidth: style.borderWidth,
        borderOpacity: 1,
      });
      if (label) {
        drawPillLabelOnPdf(page, polygonCentroid(areaOutline(shape)), label, upDir, style.fontSize, font, color);
      }
    } else if (shape.kind === "polyline" && shape.points.length >= 2) {
      // Straight segments: strokesPath smooths, which would misdraw the run that was measured.
      page.drawSvgPath(polylinePath(shape.points.map(flip)), {
        x: 0,
        y: 0,
        borderColor: color,
        borderWidth: style.borderWidth,
      });
      if (label) {
        drawPillLabelOnPdf(page, polylineMidpoint(shape.points), label, upDir, style.fontSize, font, color);
      }
    } else if (shape.kind === "count") {
      shape.points.forEach((p, i) => {
        page.drawCircle({ x: p.x, y: p.y, size: SHAPE_PX.countRadius * k, color });
        drawRotatedLabelOnPdf(page, p, String(countStartAt(shape) + i), textAngle, SHAPE_PX.countFont * k, font, rgb(1, 1, 1));
      });
    } else if (shape.kind === "cloud" && shape.points.length >= 2) {
      const corners = cloudOutline(shape.points).map(flip);
      // Scallops meet at cusps; the default miter join turns those into spikes.
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      page.drawSvgPath(cloudPath(corners, SHAPE_PX.cloudArc * k), {
        x: 0,
        y: 0,
        color,
        opacity: 0.12,
        borderColor: color,
        borderWidth: style.borderWidth,
        borderOpacity: 1,
      });
      page.pushOperators(popGraphicsState());
    } else if (shape.kind === "draw" && shape.points.length >= 2) {
      page.pushOperators(pushGraphicsState(), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
      page.drawSvgPath(strokesPath(splitStrokes(shape.points.map(flip), shape.breaks)), {
        x: 0,
        y: 0,
        borderColor: color,
        borderWidth: style.borderWidth * (drawWidth(shape) / DRAW_DEFAULT_WIDTH),
        borderOpacity: 1,
      });
      page.pushOperators(popGraphicsState());
    } else if (shape.kind === "callout" && shape.points.length === 2) {
      const [tip, anchor] = shape.points;
      const end = {
        x: anchor.x + down.x * CALLOUT_LEADER_OFFSET.y * k,
        y: anchor.y + down.y * CALLOUT_LEADER_OFFSET.y * k,
      };
      const len = Math.hypot(tip.x - end.x, tip.y - end.y) || 1;
      page.drawLine({ start: end, end: tip, thickness: style.borderWidth, color });
      fillArrowOnPdf(
        page,
        { tip, dir: { x: (tip.x - end.x) / len, y: (tip.y - end.y) / len } },
        style.arrowLen,
        style.arrowHalfWidth,
        color,
      );
      drawNoteCardOnPdf(page, anchor, shape.text ?? "", shapeColor(shape), zoom, upDir, font);
    } else if (shape.kind === "text" && shape.points.length >= 1) {
      const size = shape.fontSize ?? TEXT_DEFAULT_SIZE;
      const textFace = textFonts[`${shape.bold ? "b" : ""}${shape.italic ? "i" : ""}`];
      const anchor = shape.points[0];
      const axes = getScreenAxes(rotateScreenUp(upDir, shape.rotation ?? 0, true), true);
      // drawText places the baseline; push each line down by its ascent from the top.
      const ascent = textFace.heightAtSize(size, { descender: false });
      textLines(drawableText(textFace, shape.text ?? "")).forEach((line, i) => {
        const offset = (i * TEXT_LINE_HEIGHT + (TEXT_LINE_HEIGHT - 1) / 2) * size + ascent;
        page.drawText(line, {
          x: anchor.x + axes.down.x * offset,
          y: anchor.y + axes.down.y * offset,
          size,
          font: textFace,
          color,
          rotate: degrees((Math.atan2(axes.right.y, axes.right.x) * 180) / Math.PI),
        });
      });
    }
  }
}

/** What to draw on one page of a PDF. */
export interface PageMarkups {
  /** Zero-based. */
  page: number;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  scale: Scale | null;
  /** Doc-space direction that reads as up on this page; see getScreenUpDocDirection. */
  screenUpDoc: Point2D;
}

/** Draws each page's markups onto an already-loaded PDF, using one set of fonts for them all. */
export async function drawMarkupsOnPdf(
  pdfDoc: PDFDocument,
  pages: PageMarkups[],
  displayUnit: Unit,
): Promise<void> {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textFonts = pages.some((p) => p.shapes.some((s) => s.kind === "text" && (s.bold || s.italic)))
    ? await embedTextFonts(pdfDoc, font)
    : { "": font, b: font, i: font, bi: font };
  for (const markups of pages) {
    await drawPageMarkupsOnPdf(pdfDoc, markups, displayUnit, font, textFonts);
  }
}

async function drawPageMarkupsOnPdf(
  pdfDoc: PDFDocument,
  { page: pageIndex, measurements, rectangles, notes, shapes, scale, screenUpDoc }: PageMarkups,
  displayUnit: Unit,
  font: PDFFont,
  textFonts: TextFonts,
): Promise<void> {
  // Labels are 12 pt on the sheet, whatever view the file happened to be saved from.
  const zoom = 1;
  const page = pdfDoc.getPage(pageIndex);
  const style = getExportStyle(zoom);
  await drawSnapshotsOnPdf(pdfDoc, page, shapes);

  for (const measurement of getExportMeasurements(measurements)) {
    const { r, g, b } = hexToRgb(getLineColor(measurement));
    const color = rgb(r, g, b);
    const label =
      scale && !measurement.plain ? getMeasurementLabel(measurement, scale, displayUnit) : null;

    drawInlineLineOnPdf(
      page,
      measurement.start,
      measurement.end,
      color,
      style.lineWidth,
      label,
      style.fontSize,
      font,
      measurement.plain ? 0 : style.arrowLen,
      style.arrowHalfWidth,
      screenUpDoc,
    );

    const tick =
      measurement.plain && measurement.midpointTick
        ? midpointTickEnds(measurement.start, measurement.end, style.midpointTickHalf)
        : null;
    if (tick) page.drawLine({ start: tick[0], end: tick[1], thickness: style.lineWidth, color });
  }

  for (const rectangle of rectangles) {
    if (rectangle.rotation) {
      // PDF space is y-up: a clockwise screen turn is a negative (clockwise) angle here.
      const c = midpoint(rectangle.topLeft, rectangle.bottomRight);
      const rad = (-rectangle.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(cos, sin, -sin, cos, c.x - cos * c.x + sin * c.y, c.y - sin * c.x - cos * c.y),
      );
    }
    const x = rectangle.topLeft.x;
    const y = rectangle.topLeft.y;
    const rectWidth = rectangle.bottomRight.x - rectangle.topLeft.x;
    const rectHeight = rectangle.bottomRight.y - rectangle.topLeft.y;
    const { r, g, b } = hexToRgb(getRectangleColor(rectangle));
    const color = rgb(r, g, b);

    const topLeft = { x, y: y + rectHeight };
    const topRight = { x: x + rectWidth, y: y + rectHeight };
    const bottomRight = { x: x + rectWidth, y };
    const bottomLeft = { x, y };

    const docWidth = getRectDocWidth(rectangle);
    const docHeightValue = getRectDocHeight(rectangle);
    const widthLabel =
      scale && docWidth > 0 && !rectangle.plain
        ? getRectDimensionLabel(docWidth, scale, displayUnit)
        : null;
    const heightLabel =
      scale && docHeightValue > 0 && !rectangle.plain
        ? getRectDimensionLabel(docHeightValue, scale, displayUnit)
        : null;

    if (widthLabel) {
      const labelWidth = measurePdfLabelWidth(font, widthLabel, style.fontSize);
      const topEdge = computeInlineEdgeSegments(topLeft, topRight, labelWidth);
      if (topEdge.showGap) {
        page.drawLine({
          start: topEdge.segment1Start,
          end: topEdge.segment1End,
          thickness: style.borderWidth,
          color,
        });
        page.drawLine({
          start: topEdge.segment2Start,
          end: topEdge.segment2End,
          thickness: style.borderWidth,
          color,
        });
      } else {
        page.drawLine({ start: topLeft, end: topRight, thickness: style.borderWidth, color });
      }
      drawRotatedLabelOnPdf(
        page,
        topEdge.labelCenter,
        widthLabel,
        computePdfLabelAngleDeg(topLeft, topRight),
        style.fontSize,
        font,
        color,
      );
    } else {
      page.drawLine({ start: topLeft, end: topRight, thickness: style.borderWidth, color });
    }

    page.drawLine({ start: topRight, end: bottomRight, thickness: style.borderWidth, color });
    page.drawLine({ start: bottomRight, end: bottomLeft, thickness: style.borderWidth, color });

    if (heightLabel) {
      const labelWidth = measurePdfLabelWidth(font, heightLabel, style.fontSize);
      const leftEdge = computeInlineEdgeSegments(topLeft, bottomLeft, labelWidth);
      if (leftEdge.showGap) {
        page.drawLine({
          start: leftEdge.segment1Start,
          end: leftEdge.segment1End,
          thickness: style.borderWidth,
          color,
        });
        page.drawLine({
          start: leftEdge.segment2Start,
          end: leftEdge.segment2End,
          thickness: style.borderWidth,
          color,
        });
      } else {
        page.drawLine({ start: topLeft, end: bottomLeft, thickness: style.borderWidth, color });
      }
      drawRotatedLabelOnPdf(
        page,
        leftEdge.labelCenter,
        heightLabel,
        computePdfLabelAngleDeg(topLeft, bottomLeft),
        style.fontSize,
        font,
        color,
      );
    } else {
      page.drawLine({ start: topLeft, end: bottomLeft, thickness: style.borderWidth, color });
    }
    if (rectangle.rotation) page.pushOperators(popGraphicsState());
  }

  drawShapesOnPdf(page, shapes, scale, displayUnit, style, zoom, screenUpDoc, font, textFonts);

  for (const note of notes) {
    drawNoteCardOnPdf(
      page,
      note.position,
      note.text,
      getNoteColor(note),
      zoom,
      rotateScreenUp(screenUpDoc, note.rotation ?? 0, true),
      font,
      note.width,
    );
  }

}

/** A pixel has no real-world size, so saved images get labels as if shown about this wide. */
const EXPORT_IMAGE_VIEW_PX = 1000;

export async function buildMarkedUpImageBlob(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  shapes: ShapeAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  screenUpDoc: Point2D = { x: 0, y: -1 },
): Promise<Blob | null> {
  const source = await loadImageSource(fileBytes, fileName, mimeType);
  const zoom = Math.min(1, EXPORT_IMAGE_VIEW_PX / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  source.draw(context, source.width, source.height);
  await drawSnapshotsOnCanvas(context, shapes);

  const style = getExportStyle(zoom);

  for (const measurement of getExportMeasurements(measurements)) {
    drawMeasurementOnCanvas(context, measurement, scale, displayUnit, style, screenUpDoc);
  }

  for (const rectangle of rectangles) {
    context.save();
    if (rectangle.rotation) {
      // Image space is y-down like the screen, so a clockwise screen turn is a clockwise turn here.
      const c = midpoint(rectangle.topLeft, rectangle.bottomRight);
      context.translate(c.x, c.y);
      context.rotate((rectangle.rotation * Math.PI) / 180);
      context.translate(-c.x, -c.y);
    }
    drawRectangleOnCanvas(context, rectangle, scale, displayUnit, style);
    context.restore();
  }

  drawShapesOnCanvas(context, shapes, scale, displayUnit, style, zoom, screenUpDoc);

  for (const note of notes) {
    drawNoteCardOnCanvas(
      context,
      note.position,
      note.text,
      getNoteColor(note),
      zoom,
      rotateScreenUp(screenUpDoc, note.rotation ?? 0, false),
      note.width,
    );
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

  return blob;
}
