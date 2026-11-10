import type {
  MarkupGroup,
  Measurement,
  NoteAnnotation,
  Point2D,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
  Unit,
} from "@/app/types";
import { DEFAULT_ANNOTATION_COLOR } from "@/app/utils/colors";
import { docDistance } from "@/app/utils/coordinates";
import { getRectDocHeight, getRectDocWidth } from "@/app/utils/dimensions";
import { formatArea } from "@/app/utils/geometry";
import { pageOf } from "@/app/utils/pages";
import {
  countStartAt,
  cutoutCount,
  getAreaMetrics,
  getPolylineLength,
  SHAPE_KIND_LABELS,
} from "@/app/utils/shapeMetrics";
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
  /** Names of the Markups-panel groups it is in (CSV only). */
  groups?: string[];
  /** Locked in place (no move, resize or rotate). */
  locked?: boolean;
  /** Zero-based page it is on. */
  page?: number;
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
  groups?: MarkupGroup[];
  /** Per page: each markup is measured at its own sheet's scale. */
  scales: Record<number, Scale>;
  displayUnit: Unit;
}

export function buildMarkupRows(source: MarkupSource): MarkupRow[] {
  const { scales, displayUnit: unit } = source;
  const scaleOf = (markup: { page?: number }) => scales[pageOf(markup)] ?? null;
  const unitsPerDoc = (markup: { page?: number }) => {
    const scale = scaleOf(markup);
    return scale ? convertUnits(scale.unitsPerPdfPoint, scale.calibrationUnit, unit) : null;
  };
  const dist = (v: number) => formatDistance(v, unit);
  const colorOf = (a: { color?: string }) => a.color || DEFAULT_ANNOTATION_COLOR;
  const rows: MarkupRow[] = [];

  for (const m of source.measurements) {
    if (m.isCalibration) continue;
    if (m.plain) {
      rows.push({ id: m.id, type: m.arrow ? "Arrow" : "Line", name: m.label ?? "", color: colorOf(m), text: "", display: "—" });
      continue;
    }
    const k = unitsPerDoc(m);
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
      rows.push({ id: r.id, type: r.ellipse ? "Ellipse" : "Box", name: r.label ?? "", color: colorOf(r), text: "", display: "—" });
      continue;
    }
    const k = unitsPerDoc(r);
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
      type: s.kind === "area" && s.plain ? "Polygon" : s.highlight ? "Highlight" : SHAPE_KIND_LABELS[s.kind],
      name: s.label ?? "",
      color: colorOf(s),
      text: s.text ?? "",
    };
    if (s.kind === "area" && s.plain) {
      rows.push({ ...base, display: "—" });
    } else if (s.kind === "area") {
      const metrics = getAreaMetrics(s, scaleOf(s), unit);
      const cutouts = cutoutCount(s);
      rows.push({
        ...base,
        display: metrics
          ? `${formatArea(metrics.area, unit)} · P ${dist(metrics.perimeter)}${
              cutouts ? ` · ${cutouts} cutout${cutouts === 1 ? "" : "s"}` : ""
            }`
          : "Not calibrated",
        ...metrics,
      });
    } else if (s.kind === "polyline") {
      const length = getPolylineLength(s, scaleOf(s), unit) ?? undefined;
      rows.push({
        ...base,
        // A single point has no length yet, whatever the sheet's calibration.
        display: length !== undefined ? dist(length) : scaleOf(s) ? "—" : "Not calibrated",
        length,
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
      rows.push({
        ...base,
        display: s.kind === "callout" || s.kind === "text" ? s.text || "—" : "—",
      });
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

  // Tag each row with its lock and group names so the panel and CSV can show them.
  const groupNames = new Map<string, string[]>();
  for (const group of source.groups ?? []) {
    for (const id of group.memberIds) groupNames.set(id, [...(groupNames.get(id) ?? []), group.name]);
  }
  const markups = new Map<string, { locked?: boolean; page?: number }>(
    [...source.measurements, ...source.rectangles, ...source.notes, ...source.shapes].map((m) => [m.id, m]),
  );
  return rows.map((row) => {
    const markup = markups.get(row.id);
    const names = groupNames.get(row.id);
    return {
      ...row,
      ...(names ? { groups: names } : {}),
      ...(markup?.locked ? { locked: true } : {}),
      page: pageOf(markup ?? {}),
    };
  });
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

/** Middle of a markup's bounding box, for scrolling to it. Null for a shape with no points yet. */
export function markupCenter(
  markup: Measurement | RectMeasurement | NoteAnnotation | ShapeAnnotation,
): Point2D | null {
  const points =
    "start" in markup
      ? [markup.start, markup.end]
      : "topLeft" in markup
        ? [markup.topLeft, markup.bottomRight]
        : "position" in markup
          ? [markup.position]
          : markup.points;
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  // Excel runs a cell starting with these as a formula; a note in a shared file shouldn't get to.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: MarkupRow[], unit: Unit): string {
  const header = [
    "Groups",
    "Type",
    "Name",
    "Text",
    `Length (${unit})`,
    `Area (sq ${unit})`,
    `Perimeter (${unit})`,
    "Count",
    "Start #",
    "Color",
    // Last, so the columns before it stay where existing spreadsheets expect them.
    "Sheet",
  ];
  const lines = rows.map((r) =>
    [
      (r.groups ?? []).join("; "),
      r.type,
      r.name,
      r.text,
      r.length,
      r.area,
      r.perimeter,
      r.count,
      r.startAt,
      r.color,
      r.page === undefined ? undefined : r.page + 1,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
