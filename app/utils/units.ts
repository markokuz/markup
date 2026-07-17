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

export function formatDistance(value: number, unit: Unit): string {
  const decimals = unit === "mm" ? 0 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

export const UNIT_LABELS: Record<Unit, string> = {
  ft: "Feet (ft)",
  in: "Inches (in)",
  m: "Meters (m)",
  mm: "Millimeters (mm)",
};
