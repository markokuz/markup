import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { DocumentType, Measurement, Scale, Unit } from "@/app/types";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { docDistance, midpoint } from "@/app/utils/coordinates";
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

function drawMeasurementOnCanvas(
  context: CanvasRenderingContext2D,
  measurement: Measurement,
  scale: Scale | null,
  displayUnit: Unit,
  yOrigin: "top" | "bottom",
  docHeight = 0,
) {
  const color = measurement.isCalibration ? "#f59e0b" : "#06b6d4";
  const mapY = (y: number) => (yOrigin === "top" ? y : docHeight - y);

  context.strokeStyle = color;
  context.lineWidth = measurement.isCalibration ? 1.5 : 2;
  context.setLineDash(measurement.isCalibration ? [6, 4] : []);
  context.beginPath();
  context.moveTo(measurement.start.x, mapY(measurement.start.y));
  context.lineTo(measurement.end.x, mapY(measurement.end.y));
  context.stroke();
  context.setLineDash([]);

  if (!scale) return;

  const mid = midpoint(measurement.start, measurement.end);
  const label = measurement.isCalibration
    ? "Calibration"
    : getMeasurementLabel(measurement, scale, displayUnit);
  const labelX = mid.x + measurement.labelOffset.x;
  const labelY = mapY(mid.y + measurement.labelOffset.y);

  context.font = "600 12px Helvetica, Arial, sans-serif";
  context.fillStyle = color;
  context.fillText(label, labelX, labelY);
}

async function exportMarkedUpPdf(
  fileBytes: Uint8Array,
  measurements: Measurement[],
  scale: Scale | null,
  displayUnit: Unit,
  fileName: string,
): Promise<void> {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const page = pdfDoc.getPage(0);
  const { height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const lineColor = rgb(0.05, 0.75, 0.95);
  const calibrateColor = rgb(0.95, 0.55, 0.1);

  for (const measurement of measurements) {
    const color = measurement.isCalibration ? calibrateColor : lineColor;
    const start = { x: measurement.start.x, y: height - measurement.start.y };
    const end = { x: measurement.end.x, y: height - measurement.end.y };

    page.drawLine({
      start,
      end,
      thickness: measurement.isCalibration ? 1.5 : 2,
      color,
      dashArray: measurement.isCalibration ? [6, 4] : undefined,
    });

    if (scale) {
      const mid = midpoint(measurement.start, measurement.end);
      const label = getMeasurementLabel(measurement, scale, displayUnit);
      const labelX = mid.x + measurement.labelOffset.x;
      const labelY = height - (mid.y + measurement.labelOffset.y) - 4;

      page.drawText(label, {
        x: labelX,
        y: labelY,
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
    drawMeasurementOnCanvas(
      context,
      measurement,
      scale,
      displayUnit,
      "top",
      source.height,
    );
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
  scale: Scale | null,
  displayUnit: Unit,
): Promise<void> {
  if (fileType === "pdf") {
    await exportMarkedUpPdf(fileBytes, measurements, scale, displayUnit, fileName);
    return;
  }

  await exportMarkedUpImage(
    fileBytes,
    fileName,
    mimeType,
    measurements,
    scale,
    displayUnit,
  );
}
