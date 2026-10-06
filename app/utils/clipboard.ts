import type {
  DocumentType,
  Measurement,
  NoteAnnotation,
  Point2D,
  RectMeasurement,
  Scale,
} from "@/app/types";
import {
  defaultScreenLabelOffsetDoc,
  getRectHeightLabelAnchorDoc,
  getRectWidthLabelAnchorDoc,
  midpoint,
} from "@/app/utils/coordinates";
import { normalizeRect } from "@/app/utils/dimensions";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { toMeters } from "@/app/utils/units";

/**
 * Copied markups, stored in the source tab's view units at zoom 1: screen-aligned
 * (rotation and PDF y-up vs image y-down already applied) with doc-unit magnitude.
 * That lets a paste land the same way up in any tab, whatever its file type.
 */
interface MarkupClipboard {
  lines: { start: Point2D; end: Point2D; color?: string }[];
  rects: { cornerA: Point2D; cornerB: Point2D; color?: string }[];
  notes: { position: Point2D; text: string; color?: string }[];
  /** Centre of the copied group's bounding box. */
  center: Point2D;
  /** Real-world metres per unit in the source tab (null if uncalibrated). */
  metersPerUnit: number | null;
}

let clipboard: MarkupClipboard | null = null;

export function hasClipboardContent(): boolean {
  return clipboard !== null;
}

function metersPerDocUnit(scale: Scale | null): number | null {
  if (!scale || scale.unitsPerPdfPoint <= 0) return null;
  return toMeters(scale.unitsPerPdfPoint, scale.calibrationUnit);
}

interface CopySource {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  selectedIds: string[];
  scale: Scale | null;
  zoom: number;
}

/** Copy the selected markups (calibration lines excluded). Returns how many were copied. */
export function copySelection(source: CopySource, viewport: DocumentViewport): number {
  const selected = new Set(source.selectedIds);
  const zoom = source.zoom || 1;
  const toView = (p: Point2D): Point2D => {
    const v = viewport.convertToViewportPoint(p.x, p.y);
    return { x: v.x / zoom, y: v.y / zoom };
  };

  const lines = source.measurements
    .filter((m) => selected.has(m.id) && !m.isCalibration)
    .map((m) => ({ start: toView(m.start), end: toView(m.end), color: m.color }));
  const rects = source.rectangles
    .filter((r) => selected.has(r.id))
    .map((r) => ({
      cornerA: toView(r.topLeft),
      cornerB: toView(r.bottomRight),
      color: r.color,
    }));
  const notes = source.notes
    .filter((n) => selected.has(n.id))
    .map((n) => ({ position: toView(n.position), text: n.text, color: n.color }));

  const points = [
    ...lines.flatMap((l) => [l.start, l.end]),
    ...rects.flatMap((r) => [r.cornerA, r.cornerB]),
    ...notes.map((n) => n.position),
  ];
  if (points.length === 0) return 0;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  clipboard = {
    lines,
    rects,
    notes,
    center: midpoint(
      { x: Math.min(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.max(...ys) },
    ),
    metersPerUnit: metersPerDocUnit(source.scale),
  };
  return lines.length + rects.length + notes.length;
}

interface PasteTarget {
  viewport: DocumentViewport;
  zoom: number;
  scale: Scale | null;
  fileType: DocumentType;
  /** Where the group's centre should land, in overlay (screen) coordinates. */
  targetScreen: Point2D;
}

/**
 * Build new markups from the clipboard for the target tab. Geometry is resized so
 * real-world lengths match under the target's calibration (a 10' line stays 10').
 */
export function buildPaste(target: PasteTarget): {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
} | null {
  if (!clipboard) return null;
  const clip = clipboard;
  const { viewport, targetScreen } = target;
  const zoom = target.zoom || 1;

  const destMetersPerUnit = metersPerDocUnit(target.scale);
  const sizeFactor =
    clip.metersPerUnit && destMetersPerUnit ? clip.metersPerUnit / destMetersPerUnit : 1;
  const toDoc = (p: Point2D): Point2D =>
    viewport.convertToDocPoint(
      targetScreen.x + (p.x - clip.center.x) * sizeFactor * zoom,
      targetScreen.y + (p.y - clip.center.y) * sizeFactor * zoom,
    );

  const measurements: Measurement[] = clip.lines.map((line) => {
    const start = toDoc(line.start);
    const end = toDoc(line.end);
    return {
      id: crypto.randomUUID(),
      start,
      end,
      labelOffset: defaultScreenLabelOffsetDoc(viewport, midpoint(start, end)),
      ...(line.color ? { color: line.color } : {}),
    };
  });

  const rectangles: RectMeasurement[] = clip.rects.map((rect) => {
    const bounds = normalizeRect(toDoc(rect.cornerA), toDoc(rect.cornerB));
    const base = {
      id: crypto.randomUUID(),
      ...bounds,
      widthLabelOffset: { x: 0, y: 0 },
      heightLabelOffset: { x: 0, y: 0 },
      ...(rect.color ? { color: rect.color } : {}),
    };
    return {
      ...base,
      widthLabelOffset: defaultScreenLabelOffsetDoc(
        viewport,
        getRectWidthLabelAnchorDoc(base, target.fileType),
        { x: 0, y: -16 },
      ),
      heightLabelOffset: defaultScreenLabelOffsetDoc(
        viewport,
        getRectHeightLabelAnchorDoc(base),
        { x: -16, y: 0 },
      ),
    };
  });

  const notes: NoteAnnotation[] = clip.notes.map((note) => ({
    id: crypto.randomUUID(),
    position: toDoc(note.position),
    text: note.text,
    ...(note.color ? { color: note.color } : {}),
  }));

  return { measurements, rectangles, notes };
}
