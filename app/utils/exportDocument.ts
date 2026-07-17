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
  getLineLabelAnchorDoc,
  getLineLabelDocPosition,
  getRectHeightLabelAnchorDoc,
  getRectHeightLabelDocPosition,
  getRectWidthLabelAnchorDoc,
  getRectWidthLabelDocPosition,
} from "@/app/utils/coordinates";
import {
  getRectDocHeight,
  getRectDocWidth,
} from "@/app/utils/dimensions";
import { loadImageSource } from "@/app/utils/loadImage";

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
) {
  const color = getLineColor(measurement);
  context.strokeStyle = color;
  context.lineWidth = measurement.isCalibration ? 1.5 : 2;
  context.setLineDash(measurement.isCalibration ? [6, 4] : []);
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

  context.font = "600 12px Helvetica, Arial, sans-serif";
  context.fillStyle = color;
  context.fillText(label, labelPos.x, labelPos.y);
}

function drawRectangleOnCanvas(
  context: CanvasRenderingContext2D,
  rectangle: RectMeasurement,
  scale: Scale | null,
  displayUnit: Unit,
) {
  const color = getRectangleColor(rectangle);
  const x = rectangle.topLeft.x;
  const y = rectangle.topLeft.y;
  const width = rectangle.bottomRight.x - rectangle.topLeft.x;
  const height = rectangle.bottomRight.y - rectangle.topLeft.y;

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);

  if (!scale) return;

  const docWidth = getRectDocWidth(rectangle);
  const docHeightValue = getRectDocHeight(rectangle);
  const widthLabel = getRectDimensionLabel(docWidth, scale, displayUnit);
  const heightLabel = getRectDimensionLabel(docHeightValue, scale, displayUnit);
  const widthLabelPos = getRectWidthLabelDocPosition(rectangle, "image");
  const heightLabelPos = getRectHeightLabelDocPosition(rectangle);

  context.font = "600 12px Helvetica, Arial, sans-serif";
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
): Promise<void> {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const page = pdfDoc.getPage(0);
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
      thickness: measurement.isCalibration ? 1.5 : 2,
      color,
      dashArray: measurement.isCalibration ? [6, 4] : undefined,
    });

    if (scale) {
      const labelPos = getLineLabelDocPosition(measurement);
      const label = getMeasurementLabel(measurement, scale, displayUnit);

      page.drawText(label, {
        x: labelPos.x,
        y: labelPos.y,
        size: 10,
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
      borderWidth: 2,
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
        size: 10,
        font,
        color,
      });
      page.drawText(heightLabel, {
        x: heightLabelPos.x,
        y: heightLabelPos.y,
        size: 10,
        font,
        color,
      });
    }
  }

  const output = await pdfDoc.save();
  downloadBlob(
    new Blob([output.buffer as ArrayBuffer], { type: "application/pdf" }),
    `marked-up-${stripExtension(fileName)}.pdf`,
  );
}

async function exportMarkedUpImage(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  measurements: Measurement[],
  rectangles: RectMeasurement[],
  scale: Scale | null,
  displayUnit: Unit,
): Promise<void> {
  const source = await loadImageSource(fileBytes, fileName, mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d");
  if (!context) return;

  source.draw(context, source.width, source.height);

  for (const measurement of measurements) {
    drawMeasurementOnCanvas(context, measurement, scale, displayUnit);
  }

  for (const rectangle of rectangles) {
    drawRectangleOnCanvas(context, rectangle, scale, displayUnit);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

  if (!blob) return;

  downloadBlob(blob, `marked-up-${stripExtension(fileName)}.png`);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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
): Promise<void> {
  if (fileType === "pdf") {
    await exportMarkedUpPdf(
      fileBytes,
      measurements,
      rectangles,
      scale,
      displayUnit,
      fileName,
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
  );
}
