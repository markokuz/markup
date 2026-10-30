import type { ToolMode, Unit } from "@/app/types";
import { DEFAULT_ANNOTATION_COLOR, REDLINE_COLOR } from "@/app/utils/colors";

/** Tools that create a coloured markup. */
export type ColorTool = "measure" | "rectangle" | "area" | "count" | "cloud" | "callout" | "text" | "note";

export interface AppSettings {
  toolColors: Record<ColorTool, string>;
  /** Single lowercase key per tool; "" means no shortcut. */
  hotkeys: Record<ToolMode, string>;
  defaultUnit: Unit;
  /** Snap drawn lines to multiples of this angle. */
  snapStepDeg: 90 | 45;
  /** How close (degrees) a line must be before it snaps. */
  snapToleranceDeg: number;
  /** Draw the placed calibration line on the page (it is never exported). */
  showCalibrationLine: boolean;
}

/** Reserved for the magnifier toggle. */
export const RESERVED_KEYS = new Set(["l"]);

export const DEFAULT_SETTINGS: AppSettings = {
  toolColors: {
    measure: DEFAULT_ANNOTATION_COLOR,
    rectangle: DEFAULT_ANNOTATION_COLOR,
    area: DEFAULT_ANNOTATION_COLOR,
    count: DEFAULT_ANNOTATION_COLOR,
    cloud: REDLINE_COLOR,
    callout: REDLINE_COLOR,
    text: REDLINE_COLOR,
    note: DEFAULT_ANNOTATION_COLOR,
  },
  hotkeys: {
    measure: "m",
    area: "a",
    count: "c",
    rectangle: "r",
    cloud: "k",
    callout: "o",
    text: "t",
    note: "n",
    calibrate: "b",
    select: "v",
    pan: "h",
    snapshot: "g",
  },
  defaultUnit: "ft",
  snapStepDeg: 90,
  snapToleranceDeg: 5,
  showCalibrationLine: true,
};

export function isColorTool(tool: string): tool is ColorTool {
  return tool in DEFAULT_SETTINGS.toolColors;
}

const SETTINGS_KEY = "markup.settings";

/** Stored settings merged over defaults, so fields added later get their default. */
export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const stored = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      toolColors: { ...DEFAULT_SETTINGS.toolColors, ...stored.toolColors },
      hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...stored.hotkeys },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — keep the in-memory value.
  }
}

/** Tool whose shortcut is `key`, if any. */
export function toolForHotkey(hotkeys: AppSettings["hotkeys"], key: string): ToolMode | null {
  const entry = Object.entries(hotkeys).find(([, k]) => k && k === key);
  return entry ? (entry[0] as ToolMode) : null;
}
