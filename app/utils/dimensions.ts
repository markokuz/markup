import type { Measurement, Point2D, RectMeasurement, Scale, Unit } from "@/app/types";
import { convertUnits } from "@/app/utils/units";

function parseFeetInchesInput(text: string): number | null {
  const feetInches = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(-?\d+(?:\.\d+)?)\s*(?:in|inches|")?$/i,
  );
  if (feetInches) {
    const feet = Number.parseFloat(feetInches[1]);
    const inches = Number.parseFloat(feetInches[2]);
    if (
      Number.isFinite(feet) &&
      Number.isFinite(inches) &&
      feet >= 0 &&
      inches >= 0 &&
      (feet > 0 || inches > 0)
    ) {
      const total = feet + inches / 12;
      return total > 0 ? total : null;
    }
  }

  const inchesOnly = text.match(/^(-?\d+(?:\.\d+)?)\s*(?:in|inches|")$/i);
  if (inchesOnly) {
    const inches = Number.parseFloat(inchesOnly[1]);
    if (Number.isFinite(inches) && inches > 0) {
      return inches / 12;
    }
  }

  return null;
}

export function parseDimensionInput(text: string, displayUnit: Unit): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (displayUnit === "ft") {
    const fromFeetInches = parseFeetInchesInput(trimmed);
    if (fromFeetInches !== null) {
      return fromFeetInches;
    }
  }

  const unitPattern = new RegExp(`\\s*${displayUnit}\\s*$`, "i");
  const numeric = trimmed.replace(unitPattern, "").trim();
  const value = Number.parseFloat(numeric);

  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function toDocLength(value: number, scale: Scale, displayUnit: Unit): number {
  return convertUnits(value, displayUnit, scale.calibrationUnit) / scale.unitsPerPdfPoint;
}

export function applyLineLength(
  measurement: Measurement,
  typedValue: number,
  scale: Scale,
  displayUnit: Unit,
): { end: Point2D } {
  const targetLength = toDocLength(typedValue, scale, displayUnit);
  const dx = measurement.end.x - measurement.start.x;
  const dy = measurement.end.y - measurement.start.y;
  const currentLength = Math.hypot(dx, dy);

  if (currentLength === 0) {
    return {
      end: {
        x: measurement.start.x + targetLength,
        y: measurement.start.y,
      },
    };
  }

  const scaleFactor = targetLength / currentLength;
  return {
    end: {
      x: measurement.start.x + dx * scaleFactor,
      y: measurement.start.y + dy * scaleFactor,
    },
  };
}

export function applyRectWidth(
  rect: RectMeasurement,
  typedValue: number,
  scale: Scale,
  displayUnit: Unit,
): { bottomRight: Point2D } {
  const targetWidth = toDocLength(typedValue, scale, displayUnit);
  return {
    bottomRight: {
      x: rect.topLeft.x + targetWidth,
      y: rect.bottomRight.y,
    },
  };
}

export function applyRectHeight(
  rect: RectMeasurement,
  typedValue: number,
  scale: Scale,
  displayUnit: Unit,
): { bottomRight: Point2D } {
  const targetHeight = toDocLength(typedValue, scale, displayUnit);
  return {
    bottomRight: {
      x: rect.bottomRight.x,
      y: rect.topLeft.y + targetHeight,
    },
  };
}

export function normalizeRect(start: Point2D, end: Point2D): {
  topLeft: Point2D;
  bottomRight: Point2D;
} {
  return {
    topLeft: {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
    },
    bottomRight: {
      x: Math.max(start.x, end.x),
      y: Math.max(start.y, end.y),
    },
  };
}

export function getRectDocWidth(rect: RectMeasurement): number {
  return Math.abs(rect.bottomRight.x - rect.topLeft.x);
}

export function getRectDocHeight(rect: RectMeasurement): number {
  return Math.abs(rect.bottomRight.y - rect.topLeft.y);
}
