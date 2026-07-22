import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type {
  DocumentType,
  Measurement,
  RectMeasurement,
  Scale,
  Unit,
} from "@/app/types";
import {
  CALIBRATION_COLOR,
  DEFAULT_ANNOTATION_COLOR,
  hexToRgb,
} from "@/app/utils/colors";
import { convertUnits, formatDistance } from "@/app/utils/units";
import {
  docDistance,
  getLineLabelDocPosition,
  getRectHeightLabelDocPosition,
  getRectWidthLabelDocPosition,
} from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import { loadImageSource } from "@/app/utils/loadImage";

/** US Letter width in PDF points — baseline for on-screen markup sizing. */
const REFERENCE_PAGE_MIN_DIMENSION = 612;

export type ExportSaveMode = "download" | "choose-location";

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

function getLineColor(measurement: Measurement): string {
  return measurement.isCalibration
    ? CALIBRATION_COLOR
    : measurement.color ?? DEFAULT_ANNOTATION_COLOR;
}

function getRectangleColor(rectangle: RectMeasurement): string {
  return rectangle.color ?? DEFAULT_ANNOTATION_COLOR;
}

function drawMeasurementOnCanvas(
  context: CanvasRenderingContext2D,
  measurement: Measurement,
  scale: Scale | null,
  displayUnit: Unit,
  style: ExportStyle,
) {
  const color = getLineColor(measurement);
  context.strokeStyle = color;
  context.lineWidth = measurement.isCalibration
    ? style.calibrationLineWidth
    : style.lineWidth;
  context.setLineDash(measurement.isCalibration ? style.calibrationDash : []);
  context.beginPath();
  context.moveTo(measurement.start.x, measurement.start.y);
  context.lineTo(measurement.end.x, measurement.end.y);
  context.stroke();
  context.setLineDash([]);

  if (!scale) return;

  const labelPos = getLineLabelDocPosition(measurement);
  const label = measurement.isCalibration
    ? "Calibration"
    : getMeasurementLabel(measurement, scale, displayUnit);

  context.font = `600 ${style.fontSize}px Helvetica, Arial, sans-serif`;
  context.fillStyle = color;
  context.fillText(label, labelPos.x, labelPos.y);
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

  context.strokeStyle = color;
  context.lineWidth = style.borderWidth;
  context.strokeRect(x, y, width, height);

  if (!scale) return;

  const docWidth = getRectDocWidth(rectangle);
  const docHeightValue = getRectDocHeight(rectangle);
  const widthLabel = getRectDimensionLabel(docWidth, scale, displayUnit);
  const heightLabel = getRectDimensionLabel(docHeightValue, scale, displayUnit);
  const widthLabelPos = getRectWidthLabelDocPosition(rectangle, "image");
  const heightLabelPos = getRectHeightLabelDocPosition(rectangle);

  context.font = `600 ${style.fontSize}px Helvetica, Arial, sans-serif`;
  context.fillStyle = color;
  context.fillText(widthLabel, widthLabelPos.x, widthLabelPos.y);
  context.fillText(heightLabel, heightLabelPos.x, heightLabelPos.y);
}

async function exportMarkedUpPdf(
  fileBytes: Uint8Array,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  scale: Scale | null,
  displayUnit: Unit,
  fileName: string,
  saveMode: ExportSaveMode,
): Promise<void> {
  const blob = await buildMarkedUpPdfBlob(
    fileBytes,
    measurements,
    rectangles,
    scale,
    displayUnit,
  );
  const outputFileName = getMarkedUpExportFileName("pdf", fileName);
  await persistExportedBlob(blob, outputFileName, saveMode);
}

async function buildMarkedUpPdfBlob(
  fileBytes: Uint8Array,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  scale: Scale | null,
  displayUnit: Unit,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const page = pdfDoc.getPage(0);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const style = getExportStyle(pageWidth, pageHeight);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const calibrateColor = hexToRgb(CALIBRATION_COLOR);

  for (const measurement of measurements) {
    const { r, g, b } = hexToRgb(getLineColor(measurement));
    const color = measurement.isCalibration
      ? rgb(calibrateColor.r, calibrateColor.g, calibrateColor.b)
      : rgb(r, g, b);

    page.drawLine({
      start: measurement.start,
      end: measurement.end,
      thickness: measurement.isCalibration
        ? style.calibrationLineWidth
        : style.lineWidth,
      color,
      dashArray: measurement.isCalibration ? style.calibrationDash : undefined,
    });

    if (scale) {
      const labelPos = getLineLabelDocPosition(measurement);
      const label = getMeasurementLabel(measurement, scale, displayUnit);

      page.drawText(label, {
        x: labelPos.x,
        y: labelPos.y,
        size: style.fontSize,
        font,
        color,
      });
    }
  }

  for (const rectangle of rectangles) {
    const x = rectangle.topLeft.x;
    const y = rectangle.topLeft.y;
    const rectWidth = rectangle.bottomRight.x - rectangle.topLeft.x;
    const rectHeight = rectangle.bottomRight.y - rectangle.topLeft.y;
    const { r, g, b } = hexToRgb(getRectangleColor(rectangle));
    const color = rgb(r, g, b);

    page.drawRectangle({
      x,
      y,
      width: rectWidth,
      height: rectHeight,
      borderColor: color,
      borderWidth: style.borderWidth,
    });

    if (scale) {
      const docWidth = getRectDocWidth(rectangle);
      const docHeightValue = getRectDocHeight(rectangle);
      const widthLabel = getRectDimensionLabel(docWidth, scale, displayUnit);
      const heightLabel = getRectDimensionLabel(docHeightValue, scale, displayUnit);
      const widthLabelPos = getRectWidthLabelDocPosition(rectangle, "pdf");
      const heightLabelPos = getRectHeightLabelDocPosition(rectangle);

      page.drawText(widthLabel, {
        x: widthLabelPos.x,
        y: widthLabelPos.y,
        size: style.fontSize,
        font,
        color,
      });
      page.drawText(heightLabel, {
        x: heightLabelPos.x,
        y: heightLabelPos.y,
        size: style.fontSize,
        font,
        color,
      });
    }
  }

  const output = await pdfDoc.save();
  return new Blob([output.buffer as ArrayBuffer], { type: "application/pdf" });
}

async function exportMarkedUpImage(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  scale: Scale | null,
  displayUnit: Unit,
  saveMode: ExportSaveMode,
): Promise<void> {
  const blob = await buildMarkedUpImageBlob(
    fileBytes,
    fileName,
    mimeType,
    measurements,
    rectangles,
    scale,
    displayUnit,
  );
  if (!blob) return;
  const outputFileName = getMarkedUpExportFileName("image", fileName);
  await persistExportedBlob(blob, outputFileName, saveMode);
}

async function buildMarkedUpImageBlob(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
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

  for (const measurement of measurements) {
    drawMeasurementOnCanvas(context, measurement, scale, displayUnit, style);
  }

  for (const rectangle of rectangles) {
    drawRectangleOnCanvas(context, rectangle, scale, displayUnit, style);
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

async function persistExportedBlob(
  blob: Blob,
  fileName: string,
  saveMode: ExportSaveMode,
): Promise<void> {
  if (saveMode === "choose-location" && typeof window.showSaveFilePicker === "function") {
    try {
      const isPdf = blob.type === "application/pdf";
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: isPdf ? "PDF document" : "PNG image",
            accept: isPdf
              ? { "application/pdf": [".pdf"] }
              : { "image/png": [".png"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
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
  scale: Scale | null,
  displayUnit: Unit,
  saveMode: ExportSaveMode = "download",
): Promise<void> {
  if (fileType === "pdf") {
    await exportMarkedUpPdf(
      fileBytes,
      measurements,
      rectangles,
      scale,
      displayUnit,
      fileName,
      saveMode,
    );
    return;
  }

  await exportMarkedUpImage(
    fileBytes,
    fileName,
    mimeType,
    measurements,
    rectangles,
    scale,
    displayUnit,
    saveMode,
  );
}
