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
  computeInlineEdgeSegments,
  computeInlineLineSegments,
  docDistance,
} from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import { loadImageSource } from "@/app/utils/loadImage";
import { writeBlobWithSaveFilePicker } from "@/app/utils/saveFilePicker";

/** US Letter width in PDF points — baseline for on-screen markup sizing. */
const REFERENCE_PAGE_MIN_DIMENSION = 612;

export type ExportSaveMode = "download" | "choose-location";
export { supportsSaveFilePicker } from "@/app/utils/saveFilePicker";

export interface ExportStyle {
  lineWidth: number;
  calibrationLineWidth: number;
  borderWidth: number;
  fontSize: number;
  calibrationDash: [number, number];
}

/** Scale line/text styling so markups stay readable on large pages when viewed zoomed out. */
export function getExportStyle(pageWidth: number, pageHeight: number): ExportStyle {
  const scale = Math.max(1, Math.min(pageWidth, pageHeight) / REFERENCE_PAGE_MIN_DIMENSION);
  return {
    lineWidth: 2 * scale,
    calibrationLineWidth: 1.5 * scale,
    borderWidth: 2 * scale,
    fontSize: 12 * scale,
    calibrationDash: [6 * scale, 4 * scale],
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

function measureCanvasLabelWidth(
  context: CanvasRenderingContext2D,
  label: string,
  fontSize: number,
): number {
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  return Math.max(context.measureText(label).width + 12, 48);
}

function measurePdfLabelWidth(font: PDFFont, label: string, fontSize: number): number {
  return Math.max(font.widthOfTextAtSize(label, fontSize) + 12, 48);
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

function drawInlineLineOnCanvas(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
  lineWidth: number,
  label: string | null,
  fontSize: number,
) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;

  if (!label) {
    drawDocLineSegment(context, start, end);
    return;
  }

  const labelWidth = measureCanvasLabelWidth(context, label, fontSize);
  const layout = computeInlineLineSegments(start, end, labelWidth);

  if (layout.showGap) {
    drawDocLineSegment(context, layout.segment1Start, layout.segment1End);
    drawDocLineSegment(context, layout.segment2Start, layout.segment2End);
  } else {
    drawDocLineSegment(context, start, end);
  }

  const center = layout.labelCenter;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.save();
  context.translate(center.x, center.y);
  context.rotate(angle);
  context.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 0);
  context.restore();
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
) {
  if (!label) {
    page.drawLine({ start, end, thickness, color });
    return;
  }

  const labelWidth = measurePdfLabelWidth(font, label, fontSize);
  const layout = computeInlineLineSegments(start, end, labelWidth);

  if (layout.showGap) {
    page.drawLine({ start: layout.segment1Start, end: layout.segment1End, thickness, color });
    page.drawLine({ start: layout.segment2Start, end: layout.segment2End, thickness, color });
  } else {
    page.drawLine({ start, end, thickness, color });
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angleDeg = layout.angleDeg;
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
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const page = pdfDoc.getPage(0);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const style = getExportStyle(pageWidth, pageHeight);
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
        topEdge.angleDeg,
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
        leftEdge.angleDeg,
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
): Promise<Blob | null> {
  const source = await loadImageSource(fileBytes, fileName, mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  source.draw(context, source.width, source.height);

  const style = getExportStyle(source.width, source.height);

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
        );

  if (!blob) return;

  const outputFileName = getMarkedUpExportFileName(fileType, fileName);
  await persistExportedBlob(blob, outputFileName, saveMode);
}
