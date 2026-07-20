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

export function fromMeters(meters: number, unit: Unit): number {
  return meters / TO_METERS[unit];
}

export function convertUnits(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return fromMeters(toMeters(value, from), to);
}

function formatFeetAndInches(feetDecimal: number): string {
  const totalInches = Math.round(Math.max(0, feetDecimal) * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  if (feet === 0 && inches === 0) {
    return "0 ft";
  }
  if (feet === 0) {
    return `${inches} in`;
  }
  if (inches === 0) {
    return `${feet} ft`;
  }
  return `${feet} ft ${inches} in`;
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
  const decimals = unit === "mm" ? 0 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

export const UNIT_LABELS: Record<Unit, string> = {
  ft: "Feet (ft)",
  in: "Inches (in)",
  m: "Meters (m)",
  mm: "Millimeters (mm)",
};
