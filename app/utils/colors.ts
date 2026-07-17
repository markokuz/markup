export const DEFAULT_ANNOTATION_COLOR = "#06b6d4";
export const CALIBRATION_COLOR = "#f59e0b";
export const SELECTION_ACCENT = "#22d3ee";

export const MARKUP_PALETTE = [
  "#06b6d4",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#94a3b8",
] as const;

export function getAnnotationColor(
  annotation: { color?: string },
  isSelected: boolean,
): string {
  const base = annotation.color ?? DEFAULT_ANNOTATION_COLOR;
  return isSelected ? SELECTION_ACCENT : base;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  const num = Number.parseInt(value, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}
