import type { Unit } from "@/app/types";

const TO_METERS: Record<Unit, number> = {
  m: 1,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
};

export function toMeters(value: number, unit: Unit): number {
  return value * TO_METERS[unit];
}

function fromMeters(meters: number, unit: Unit): number {
  return meters / TO_METERS[unit];
}

export function convertUnits(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return fromMeters(toMeters(value, from), to);
}

/** Parts of an inch to round feet and inches to (1 = whole inches), or decimal feet. */
export type FeetPrecision = 1 | 2 | 4 | 8 | 16 | "decimal";

let feetPrecision: FeetPrecision = 1;

/**
 * Set from the settings as they change. Module-level so formatDistance's many callers,
 * exports included, all agree without each being passed it.
 */
export function setFeetPrecision(precision: FeetPrecision | undefined) {
  feetPrecision = precision ?? 1;
}

/** `3 1/2`, `3` or `1/2`, from a count of 1/`parts` inches; "" for zero. */
function formatInches(count: number, parts: number): string {
  const whole = Math.floor(count / parts);
  let numerator = count % parts;
  let denominator = parts;
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = numerator > 0 ? `${numerator}/${denominator}` : "";
  return [whole > 0 ? String(whole) : "", fraction].filter(Boolean).join(" ");
}

function formatFeetAndInches(feetDecimal: number): string {
  if (feetPrecision === "decimal") {
    return `${Math.max(0, feetDecimal).toFixed(2)} ft`;
  }
  const parts = feetPrecision;
  const total = Math.round(Math.max(0, feetDecimal) * 12 * parts);
  const feet = Math.floor(total / (12 * parts));
  const inches = formatInches(total % (12 * parts), parts);

  if (feet === 0 && !inches) {
    return "0'";
  }
  if (feet === 0) {
    return `${inches}"`;
  }
  if (!inches) {
    return `${feet}'`;
  }
  return `${feet}' ${inches}"`;
}

/** Value in display units for dimension edit fields (not necessarily equal to `formatDistance`). */
export function formatDistanceEditValue(value: number, unit: Unit): string {
  if (unit === "mm") {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

export function formatDistance(value: number, unit: Unit): string {
  if (unit === "ft") {
    return formatFeetAndInches(value);
  }
  if (unit === "in") {
    if (feetPrecision !== "decimal" && feetPrecision > 1) {
      return `${formatInches(Math.round(Math.max(0, value) * feetPrecision), feetPrecision) || "0"}"`;
    }
    const rounded = Math.round(value * 100) / 100;
    const text = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(2).replace(/\.?0+$/, "");
    return `${text}"`;
  }
  const decimals = unit === "mm" ? 0 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

/** Split a `10' 1"` or `10' 1 1/2"` label into its feet and inches parts (null for other labels). */
export function splitFeetInches(label: string): [string, string] | null {
  const match = /^(\d+')\s([\d /]+")$/.exec(label);
  return match ? [match[1], match[2]] : null;
}

export const UNIT_LABELS: Record<Unit, string> = {
  ft: "Feet (ft)",
  in: "Inches (in)",
  m: "Meters (m)",
  mm: "Millimeters (mm)",
};
