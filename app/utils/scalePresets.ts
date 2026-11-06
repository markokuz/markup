import type { Scale, Unit } from "@/app/types";
import { convertUnits } from "@/app/utils/units";

/** PDF points per inch of paper. */
const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

export interface ScalePreset {
  label: string;
  scale: Scale;
}

/** `paperInches` of paper stands for one foot, as in 1/4" = 1'-0". */
const architectural = (label: string, paperInches: number): ScalePreset => ({
  label: `${label} = 1'-0"`,
  scale: { unitsPerPdfPoint: 1 / paperInches / POINTS_PER_INCH, calibrationUnit: "ft" },
});

/** One inch of paper stands for `feet`, as in 1" = 20'. */
const engineering = (feet: number): ScalePreset => ({
  label: `1" = ${feet}'`,
  scale: { unitsPerPdfPoint: feet / POINTS_PER_INCH, calibrationUnit: "ft" },
});

const metric = (ratio: number): ScalePreset => ({
  label: `1:${ratio}`,
  scale: { unitsPerPdfPoint: (MM_PER_INCH * ratio) / POINTS_PER_INCH / 1000, calibrationUnit: "m" },
});

export const SCALE_PRESET_GROUPS: { name: string; presets: ScalePreset[] }[] = [
  {
    name: "Architectural",
    presets: [
      architectural('1/16"', 1 / 16),
      architectural('3/32"', 3 / 32),
      architectural('1/8"', 1 / 8),
      architectural('3/16"', 3 / 16),
      architectural('1/4"', 1 / 4),
      architectural('3/8"', 3 / 8),
      architectural('1/2"', 1 / 2),
      architectural('3/4"', 3 / 4),
      architectural('1"', 1),
      architectural('1 1/2"', 1.5),
      architectural('3"', 3),
    ],
  },
  { name: "Engineering", presets: [10, 20, 30, 40, 50, 60, 100].map(engineering) },
  { name: "Metric", presets: [10, 20, 50, 100, 200, 500, 1000].map(metric) },
];

/** Metres of real world per PDF point. */
const metersPerPoint = (scale: Scale) => convertUnits(scale.unitsPerPdfPoint, scale.calibrationUnit, "m");

const METRIC_UNITS: Unit[] = ["m", "mm"];
/** How far a scale set by hand can be from a standard one and still be called it. */
const NEAR_PRESET_TOLERANCE = 0.02;
/** Rounding noise only: this close is the preset itself. */
const SAME_PRESET_TOLERANCE = 1e-6;

/**
 * A PDF sheet's scale in the words on its title block: 1/4" = 1'-0", or ≈ that when
 * it was calibrated by hand and landed close to it.
 */
export function describeScale(scale: Scale): string {
  const target = metersPerPoint(scale);
  let nearest: ScalePreset | null = null;
  let nearestOff = Infinity;
  for (const preset of SCALE_PRESET_GROUPS.flatMap((group) => group.presets)) {
    const off = Math.abs(metersPerPoint(preset.scale) / target - 1);
    if (off < nearestOff) {
      nearest = preset;
      nearestOff = off;
    }
  }
  if (nearest && nearestOff <= SAME_PRESET_TOLERANCE) return nearest.label;
  if (nearest && nearestOff <= NEAR_PRESET_TOLERANCE) return `≈ ${nearest.label}`;
  if (METRIC_UNITS.includes(scale.calibrationUnit)) {
    return `1:${Math.round((target * POINTS_PER_INCH * 1000) / MM_PER_INCH)}`;
  }
  const feetPerPaperInch = convertUnits(scale.unitsPerPdfPoint, scale.calibrationUnit, "ft") * POINTS_PER_INCH;
  return `1" = ${Math.round(feetPerPaperInch * 100) / 100}'`;
}
