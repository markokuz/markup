export const DEFAULT_ANNOTATION_COLOR = "#06b6d4";
export const CALIBRATION_COLOR = "#f59e0b";
export const SELECTION_ACCENT = "#22d3ee";
/** Clouds and callouts start red, the redline convention. */
export const REDLINE_COLOR = "#dc2626";
/** The palette's earlier, lighter red; saved tool colours still holding it move to REDLINE_COLOR. */
export const LEGACY_REDLINE_COLOR = "#ef4444";
/** Highlighter yellow, drawn see-through. */
export const HIGHLIGHT_COLOR = "#facc15";
/** How opaque a highlight stroke is drawn. */
export const HIGHLIGHT_OPACITY = 0.4;

export const MARKUP_PALETTE = [
  "#06b6d4",
  REDLINE_COLOR,
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#94a3b8",
] as const;

/** Dash pattern for a dashed outline `width` px thick, so dashes grow with the line. */
export function dashArray(width: number): string {
  return dashPattern(width).join(" ");
}

/** Dash and gap lengths for a dashed line `width` thick (screen px, or doc units in an export). */
export function dashPattern(width: number): [number, number] {
  return [width * 4, width * 2.5];
}

export function getAnnotationColor(annotation: { color?: string }): string {
  return annotation.color ?? DEFAULT_ANNOTATION_COLOR;
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
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
