import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Measurement, Scale, Unit } from "@/app/types";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { midpoint, pdfDistance } from "@/app/utils/coordinates";

function getMeasurementLabel(
  measurement: Measurement,
  scale: Scale,
  displayUnit: Unit,
): string {
  const dist = pdfDistance(measurement.start, measurement.end);
  const value = convertUnits(
    dist * scale.unitsPerPdfPoint,
    scale.calibrationUnit,
    displayUnit,
  );
  return formatDistance(value, displayUnit);
}

export async function exportMarkedUpPdf(
  pdfBytes: Uint8Array,
  measurements: Measurement[],
  scale: Scale | null,
  displayUnit: Unit,
  fileName: string,
): Promise<void> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
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
  const blob = new Blob([output.buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `marked-up-${fileName.replace(/\.pdf$/i, "")}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
