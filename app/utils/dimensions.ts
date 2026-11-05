import type {
  DocumentRotation,
  Measurement,
  Point2D,
  RectMeasurement,
  Scale,
  Unit,
} from "@/app/types";
import { convertUnits } from "@/app/utils/units";

/** `5`, `5.5`, `.5`, `1/2` or `6 1/2`. */
const NUMBER = String.raw`(\d+\s+\d+/\d+|\d+/\d+|\d+\.?\d*|\.\d+)`;
const FEET = String.raw`(?:ft|feet|foot|'|’|′)`;
const INCHES = String.raw`(?:in|inch|inches|"|”|″)`;

const FEET_AND_INCHES = new RegExp(`^${NUMBER}\\s*${FEET}\\s*-?\\s*${NUMBER}\\s*${INCHES}?$`, "i");
const FEET_ONLY = new RegExp(`^${NUMBER}\\s*${FEET}$`, "i");
const INCHES_ONLY = new RegExp(`^${NUMBER}\\s*${INCHES}$`, "i");
const NUMBER_ONLY = new RegExp(`^${NUMBER}$`);
const WITH_OWN_UNIT: Record<Exclude<Unit, "ft">, RegExp> = {
  in: INCHES_ONLY,
  m: new RegExp(`^${NUMBER}\\s*m$`, "i"),
  mm: new RegExp(`^${NUMBER}\\s*mm$`, "i"),
};

function parseNumber(text: string): number {
  const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(text);
  if (!fraction) return Number(text);
  return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
}

function parseFeet(text: string): number | null {
  const both = FEET_AND_INCHES.exec(text);
  if (both) return parseNumber(both[1]) + parseNumber(both[2]) / 12;
  const inches = INCHES_ONLY.exec(text);
  if (inches) return parseNumber(inches[1]) / 12;
  const feet = FEET_ONLY.exec(text) ?? NUMBER_ONLY.exec(text);
  return feet ? parseNumber(feet[1]) : null;
}

/** A typed length in `displayUnit`. The whole text must read as a length, or this returns null. */
export function parseDimensionInput(text: string, displayUnit: Unit): number | null {
  const trimmed = text.trim();
  let value: number | null;
  if (displayUnit === "ft") {
    value = parseFeet(trimmed);
  } else {
    const match = NUMBER_ONLY.exec(trimmed) ?? WITH_OWN_UNIT[displayUnit].exec(trimmed);
    value = match ? parseNumber(match[1]) : null;
  }
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/** A length typed in display units, as a distance in document units. */
export function toDocLength(value: number, scale: Scale, displayUnit: Unit): number {
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

function applyRectWidth(
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

function applyRectHeight(
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

/** Horizontal edge length as seen on screen (top/bottom label). */
export function getRectHorizontalDocLength(
  rect: RectMeasurement,
  rotation: DocumentRotation,
): number {
  const width = getRectDocWidth(rect);
  const height = getRectDocHeight(rect);
  return rotation === 90 || rotation === 270 ? height : width;
}

/** Vertical edge length as seen on screen (left/right label). */
export function getRectVerticalDocLength(
  rect: RectMeasurement,
  rotation: DocumentRotation,
): number {
  const width = getRectDocWidth(rect);
  const height = getRectDocHeight(rect);
  return rotation === 90 || rotation === 270 ? width : height;
}

export function applyRectHorizontalEdgeLength(
  rect: RectMeasurement,
  typedValue: number,
  scale: Scale,
  displayUnit: Unit,
  rotation: DocumentRotation,
): { bottomRight: Point2D } {
  if (rotation === 90 || rotation === 270) {
    return applyRectHeight(rect, typedValue, scale, displayUnit);
  }
  return applyRectWidth(rect, typedValue, scale, displayUnit);
}

export function applyRectVerticalEdgeLength(
  rect: RectMeasurement,
  typedValue: number,
  scale: Scale,
  displayUnit: Unit,
  rotation: DocumentRotation,
): { bottomRight: Point2D } {
  if (rotation === 90 || rotation === 270) {
    return applyRectWidth(rect, typedValue, scale, displayUnit);
  }
  return applyRectHeight(rect, typedValue, scale, displayUnit);
}
