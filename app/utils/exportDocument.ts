import { PDFDocument, rgb, StandardFonts, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  DocumentType,
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  Scale,
  Unit,
} from "@/app/types";
import {
  DEFAULT_ANNOTATION_COLOR,
  hexToRgb,
} from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import {
  arrowPolygonPoints,
  computeDimensionLayout,
  computeInlineEdgeSegments,
  computePdfLabelAngleDeg,
  docDistance,
  type ArrowSpec,
} from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import { loadImageSource } from "@/app/utils/loadImage";
import { writeBlobWithSaveFilePicker } from "@/app/utils/saveFilePicker";

export type ExportSaveMode = "download" | "choose-location";
export { supportsSaveFilePicker } from "@/app/utils/saveFilePicker";

export interface ExportStyle {
  lineWidth: number;
  calibrationLineWidth: number;
  borderWidth: number;
  fontSize: number;
  calibrationDash: [number, number];
  arrowLen: number;
  arrowHalfWidth: number;
}

/**
 * Size markups in document units to visually match what the user drew on screen.
 * The on-screen stroke is 2 screen-px and label is 12 screen-px regardless of zoom,
 * so in document units that is `screenSize / zoom`. Scaling by page size instead
 * makes markups huge on large-format drawings.
 */
export function getExportStyle(zoom: number): ExportStyle {
  const scale = 1 / Math.max(zoom, 0.0001);
  return {
    lineWidth: 2 * scale,
    calibrationLineWidth: 1.5 * scale,
    borderWidth: 2 * scale,
    fontSize: 12 * scale,
    calibrationDash: [6 * scale, 4 * scale],
    arrowLen: 9 * scale,
    arrowHalfWidth: 4 * scale,
  };
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
) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;

  const labelWidth = label ? measureCanvasLabelWidth(context, label, fontSize) : 0;
  const layout = computeDimensionLayout(start, end, labelWidth, arrowLen);

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
) {
  const labelWidth = label ? measurePdfLabelWidth(font, label, fontSize) : 0;
  const layout = computeDimensionLayout(start, end, labelWidth, arrowLen);

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
) {
  const color = getLineColor(measurement);
  const label =
    scale ? getMeasurementLabel(measurement, scale, displayUnit) : null;

  drawInlineLineOnCanvas(
    context,
    measurement.start,
    measurement.end,
    color,
    style.lineWidth,
    label,
    style.fontSize,
    style.arrowLen,
    style.arrowHalfWidth,
  );
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
    scale && docWidth > 0 ? getRectDimensionLabel(docWidth, scale, displayUnit) : null;
  const heightLabel =
    scale && docHeightValue > 0
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

function drawNoteOnCanvas(
  context: CanvasRenderingContext2D,
  note: NoteAnnotation,
  style: ExportStyle,
) {
  const color = getNoteColor(note);
  const fontSize = style.fontSize;
  context.font = `500 ${fontSize}px Helvetica, Arial, sans-serif`;
  const textWidth = Math.max(context.measureText(note.text || " ").width + 16, 48);
  const textHeight = fontSize + 12;

  context.fillStyle = "rgba(15, 23, 42, 0.55)";
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.fillRect(note.position.x, note.position.y, textWidth, textHeight);
  context.strokeRect(note.position.x, note.position.y, textWidth, textHeight);

  context.fillStyle = color;
  context.textBaseline = "top";
  context.fillText(note.text, note.position.x + 8, note.position.y + 6);
}

function drawNoteOnPdf(
  page: PDFPage,
  note: NoteAnnotation,
  style: ExportStyle,
  font: PDFFont,
) {
  const colorHex = hexToRgb(getNoteColor(note));
  const color = rgb(colorHex.r, colorHex.g, colorHex.b);
  const fontSize = style.fontSize;
  const textWidth = Math.max(font.widthOfTextAtSize(note.text || " ", fontSize) + 16, 48);
  const textHeight = fontSize + 12;

  page.drawRectangle({
    x: note.position.x,
    y: note.position.y,
    width: textWidth,
    height: textHeight,
    color: rgb(0.06, 0.09, 0.16),
    opacity: 0.55,
    borderColor: color,
    borderWidth: 1,
  });

  page.drawText(note.text, {
    x: note.position.x + 8,
    y: note.position.y + 6,
    size: fontSize,
    font,
    color,
  });
}

export async function buildMarkedUpPdfBlob(
  fileBytes: Uint8Array,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  zoom: number,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const page = pdfDoc.getPage(0);
  const style = getExportStyle(zoom);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const measurement of getExportMeasurements(measurements)) {
    const { r, g, b } = hexToRgb(getLineColor(measurement));
    const color = rgb(r, g, b);
    const label = scale ? getMeasurementLabel(measurement, scale, displayUnit) : null;

    drawInlineLineOnPdf(
      page,
      measurement.start,
      measurement.end,
      color,
      style.lineWidth,
      label,
      style.fontSize,
      font,
      style.arrowLen,
      style.arrowHalfWidth,
    );
  }

  for (const rectangle of rectangles) {
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
      scale && docWidth > 0 ? getRectDimensionLabel(docWidth, scale, displayUnit) : null;
    const heightLabel =
      scale && docHeightValue > 0
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
  }

  for (const note of notes) {
    drawNoteOnPdf(page, note, style, font);
  }

  const output = await pdfDoc.save();
  return new Blob([output.buffer as ArrayBuffer], { type: "application/pdf" });
}

export async function buildMarkedUpImageBlob(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  zoom: number,
): Promise<Blob | null> {
  const source = await loadImageSource(fileBytes, fileName, mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  source.draw(context, source.width, source.height);

  const style = getExportStyle(zoom);

  for (const measurement of getExportMeasurements(measurements)) {
    drawMeasurementOnCanvas(context, measurement, scale, displayUnit, style);
  }

  for (const rectangle of rectangles) {
    drawRectangleOnCanvas(context, rectangle, scale, displayUnit, style);
  }

  for (const note of notes) {
    drawNoteOnCanvas(context, note, style);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

  return blob;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function getMarkedUpExportFileName(
  fileType: DocumentType,
  originalFileName: string,
): string {
  const base = stripExtension(originalFileName);
  return fileType === "pdf" ? `marked-up-${base}.pdf` : `marked-up-${base}.png`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function persistExportedBlob(
  blob: Blob,
  fileName: string,
  saveMode: ExportSaveMode,
): Promise<void> {
  if (saveMode === "choose-location") {
    try {
      const saved = await writeBlobWithSaveFilePicker(blob, fileName);
      if (saved) {
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  }

  downloadBlob(blob, fileName);
}

export async function exportMarkedUpDocument(
  fileBytes: Uint8Array,
  fileType: DocumentType,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  notes: NoteAnnotation[],
  scale: Scale | null,
  displayUnit: Unit,
  zoom: number,
  saveMode: ExportSaveMode = "download",
): Promise<void> {
  const blob =
    fileType === "pdf"
      ? await buildMarkedUpPdfBlob(
          fileBytes,
          measurements,
          rectangles,
          notes,
          scale,
          displayUnit,
          zoom,
        )
      : await buildMarkedUpImageBlob(
          fileBytes,
          fileName,
          mimeType,
          measurements,
          rectangles,
          notes,
          scale,
          displayUnit,
          zoom,
        );

  if (!blob) return;

  const outputFileName = getMarkedUpExportFileName(fileType, fileName);
  await persistExportedBlob(blob, outputFileName, saveMode);
}
