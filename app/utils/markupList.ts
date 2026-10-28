import type {
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
  Unit,
} from "@/app/types";
import { DEFAULT_ANNOTATION_COLOR } from "@/app/utils/colors";
import { docDistance } from "@/app/utils/coordinates";
import { getRectDocHeight, getRectDocWidth } from "@/app/utils/dimensions";
import { formatArea } from "@/app/utils/geometry";
import { countStartAt, getAreaMetrics, SHAPE_KIND_LABELS } from "@/app/utils/shapeMetrics";
import { convertUnits, formatDistance } from "@/app/utils/units";

/** One row of the Markups list / CSV, like Bluebeam's Markups List. */
export interface MarkupRow {
  id: string;
  type: string;
  /** User-given name, empty when unnamed. */
  name: string;
  color: string;
  text: string;
  /** Human-readable value for the panel. */
  display: string;
  length?: number;
  area?: number;
  perimeter?: number;
  count?: number;
  /** Count only: first marker number. */
  startAt?: number;
}

export interface MarkupTotal {
  type: string;
  color: string;
  display: string;
}

interface MarkupSource {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  scale: Scale | null;
  displayUnit: Unit;
}

export function buildMarkupRows(source: MarkupSource): MarkupRow[] {
  const { scale, displayUnit: unit } = source;
  const k = scale ? convertUnits(scale.unitsPerPdfPoint, scale.calibrationUnit, unit) : null;
  const dist = (v: number) => formatDistance(v, unit);
  const colorOf = (a: { color?: string }) => a.color ?? DEFAULT_ANNOTATION_COLOR;
  const rows: MarkupRow[] = [];

  for (const m of source.measurements) {
    if (m.isCalibration) continue;
    if (m.plain) {
      rows.push({ id: m.id, type: "Line", name: m.label ?? "", color: colorOf(m), text: "", display: "—" });
      continue;
    }
    const length = k ? docDistance(m.start, m.end) * k : undefined;
    rows.push({
      id: m.id,
      type: "Length",
      name: m.label ?? "",
      color: colorOf(m),
      text: "",
      display: length !== undefined ? dist(length) : "Not calibrated",
      length,
    });
  }

  for (const r of source.rectangles) {
    if (r.plain) {
      rows.push({ id: r.id, type: "Box", name: r.label ?? "", color: colorOf(r), text: "", display: "—" });
      continue;
    }
    const w = k ? getRectDocWidth(r) * k : undefined;
    const h = k ? getRectDocHeight(r) * k : undefined;
    const ok = w !== undefined && h !== undefined;
    rows.push({
      id: r.id,
      type: "Rectangle",
      name: r.label ?? "",
      color: colorOf(r),
      text: "",
      display: ok ? `${dist(w)} × ${dist(h)} · ${formatArea(w * h, unit)}` : "Not calibrated",
      area: ok ? w * h : undefined,
      perimeter: ok ? 2 * (w + h) : undefined,
    });
  }

  for (const s of source.shapes) {
    const base = {
      id: s.id,
      type: SHAPE_KIND_LABELS[s.kind],
      name: s.label ?? "",
      color: colorOf(s),
      text: s.text ?? "",
    };
    if (s.kind === "area") {
      const metrics = getAreaMetrics(s, scale, unit);
      rows.push({
        ...base,
        display: metrics
          ? `${formatArea(metrics.area, unit)} · P ${dist(metrics.perimeter)}`
          : "Not calibrated",
        ...metrics,
      });
    } else if (s.kind === "count") {
      const n = s.points.length;
      const start = countStartAt(s);
      rows.push({
        ...base,
        display:
          start === 1 || n === 0
            ? String(n)
            : n === 1
              ? `1 (#${start})`
              : `${n} (#${start}–${start + n - 1})`,
        count: n,
        startAt: start,
      });
    } else {
      rows.push({ ...base, display: s.kind === "callout" ? s.text || "—" : "—" });
    }
  }

  for (const n of source.notes) {
    rows.push({
      id: n.id,
      type: "Note",
      name: n.label ?? "",
      color: colorOf(n),
      text: n.text,
      display: n.text || "—",
    });
  }

  return rows;
}

/** Sums lengths, areas and counts per type and color (the estimator's summary). */
export function summarizeRows(rows: MarkupRow[], unit: Unit): MarkupTotal[] {
  const groups = new Map<string, { type: string; color: string; length: number; area: number; count: number; n: number }>();
  for (const row of rows) {
    if (row.length === undefined && row.area === undefined && row.count === undefined) continue;
    const key = `${row.type}|${row.color}`;
    const g = groups.get(key) ?? { type: row.type, color: row.color, length: 0, area: 0, count: 0, n: 0 };
    g.length += row.length ?? 0;
    g.area += row.area ?? 0;
    g.count += row.count ?? 0;
    g.n += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    type: g.type,
    color: g.color,
    display:
      g.type === "Length"
        ? `${formatDistance(g.length, unit)} (${g.n})`
        : g.type === "Count"
          ? `${g.count}`
          : `${formatArea(g.area, unit)} (${g.n})`,
  }));
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = typeof value === "number" ? String(Math.round(value * 1000) / 1000) : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: MarkupRow[], unit: Unit): string {
  const header = [
    "Type",
    "Name",
    "Text",
    `Length (${unit})`,
    `Area (sq ${unit})`,
    `Perimeter (${unit})`,
    "Count",
    "Start #",
    "Color",
  ];
  const lines = rows.map((r) =>
    [r.type, r.name, r.text, r.length, r.area, r.perimeter, r.count, r.startAt, r.color]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
