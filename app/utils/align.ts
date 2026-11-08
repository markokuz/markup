import type {
  AppAction,
  Measurement,
  NoteAnnotation,
  Point2D,
  RectMeasurement,
  ShapeAnnotation,
} from "@/app/types";
import type { ScreenRect } from "@/app/utils/coordinates";

export type AlignDot = "left" | "centre" | "right" | "top" | "middle" | "bottom";

export const ALIGN_DOT_LABELS: Record<AlignDot, string> = {
  left: "Line up left edges",
  centre: "Centre left to right",
  right: "Line up right edges",
  top: "Line up top edges",
  middle: "Centre top to bottom",
  bottom: "Line up bottom edges",
};

/** Each dot's axis, and how far across the box (0 = left/top, 1 = right/bottom) it lines up. */
const DOT_LINES: Record<AlignDot, ["x" | "y", number]> = {
  left: ["x", 0],
  centre: ["x", 0.5],
  right: ["x", 1],
  top: ["y", 0],
  middle: ["y", 0.5],
  bottom: ["y", 1],
};

export type AlignableMarkup = Measurement | RectMeasurement | NoteAnnotation | ShapeAnnotation;

export interface AlignItem {
  id: string;
  box: ScreenRect;
  locked?: boolean;
}

/** Past this many screen px an item counts as moved; below it is only rounding. */
const MOVE_EPSILON = 0.01;
/** Dots stay this far from a page corner along their rail, so the two rails can't meet there. */
const RAIL_PAGE_MARGIN = 40;
/** How close a rail may sit to the page edge. */
const RAIL_EDGE_MARGIN = 12;
const RAIL_OFFSET = 16;
const MIN_DOT_GAP = 28;
const MIN_RAIL_CLEARANCE = 16;

export function unionBox(boxes: ScreenRect[]): ScreenRect {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Screen shift that lines `box` up with `reference` at `dot`. */
export function alignShift(box: ScreenRect, reference: ScreenRect, dot: AlignDot): Point2D {
  const [axis, fraction] = DOT_LINES[dot];
  const size = axis === "x" ? "width" : "height";
  const shift = reference[axis] + reference[size] * fraction - (box[axis] + box[size] * fraction);
  return axis === "x" ? { x: shift, y: 0 } : { x: 0, y: shift };
}

/** The item the others line up to: the chosen anchor, else a locked item, since it can't move. */
export function alignAnchor<T extends AlignItem>(items: T[], anchorId: string | null): T | null {
  return items.find((item) => item.id === anchorId) ?? items.find((item) => item.locked) ?? null;
}

/** The items that would move for `dot`, each with its screen shift. */
export function alignMoves<T extends AlignItem>(
  items: T[],
  anchorId: string | null,
  dot: AlignDot,
): { item: T; shift: Point2D }[] {
  const anchor = alignAnchor(items, anchorId);
  const reference = anchor ? anchor.box : unionBox(items.map((item) => item.box));
  return items
    .filter((item) => !item.locked && item !== anchor)
    .map((item) => ({ item, shift: alignShift(item.box, reference, dot) }))
    .filter(({ shift }) => Math.abs(shift.x) > MOVE_EPSILON || Math.abs(shift.y) > MOVE_EPSILON);
}

/** Margin and dot gap along a rail, shrunk on a page too small for the usual ones (far zoomed out). */
function railSpacing(pageSize: number): { margin: number; gap: number } {
  return { margin: Math.min(RAIL_PAGE_MARGIN, pageSize * 0.2), gap: Math.min(MIN_DOT_GAP, pageSize * 0.3) };
}

/** Three spots along a rail: the box's visible span, widened if the dots would crowd. */
function railSpots(start: number, size: number, pageSize: number): [number, number, number] {
  const { margin, gap } = railSpacing(pageSize);
  let low = Math.max(margin, start);
  let high = Math.min(pageSize - margin, start + size);
  if (high - low < gap * 2) {
    const lowest = margin + gap;
    const highest = Math.max(lowest, pageSize - margin - gap);
    const mid = Math.min(highest, Math.max(lowest, (low + high) / 2));
    low = mid - gap;
    high = mid + gap;
  }
  return [low, (low + high) / 2, high];
}

/** Which side of the box a rail sits on: the preferred one, else the other, else against the edge. */
function railSide(preferred: number, other: number, pageSize: number): number {
  const fits = (at: number) => at >= RAIL_EDGE_MARGIN && at <= pageSize - RAIL_EDGE_MARGIN;
  if (fits(preferred)) return preferred;
  if (fits(other)) return other;
  return Math.min(pageSize - RAIL_EDGE_MARGIN, Math.max(RAIL_EDGE_MARGIN, preferred));
}

/** Where each dot goes on screen. The SVG clips at the page, so they always stay on it. */
// shortcut: dots stay on the page, not in the scrolled view, so a huge selection can need a zoom out; follow the scroll if that gets in the way.
export function alignDotLayout(box: ScreenRect, pageWidth: number, pageHeight: number): Record<AlignDot, Point2D> {
  const rowY = railSide(box.y + box.height + RAIL_OFFSET, box.y - RAIL_OFFSET, pageHeight);
  const columnX = railSide(box.x - RAIL_OFFSET, box.x + box.width + RAIL_OFFSET, pageWidth);
  let [left, centre, right] = railSpots(box.x, box.width, pageWidth);
  const [top, middle, bottom] = railSpots(box.y, box.height, pageHeight);
  // A small box in a page corner pushes both rails to the same spot: slide the row clear.
  const crowded = [left, centre, right].some((x) =>
    [top, middle, bottom].some((y) => Math.hypot(x - columnX, y - rowY) < MIN_RAIL_CLEARANCE),
  );
  if (crowded) {
    const { gap } = railSpacing(pageWidth);
    const span = right - left;
    const after = columnX + gap;
    const wanted = after + span <= pageWidth - RAIL_EDGE_MARGIN ? after : columnX - gap - span;
    // On a tiny page there may be no clear side; staying on the page matters more.
    const start = Math.max(0, Math.min(pageWidth - span, wanted));
    [left, centre, right] = [start, start + span / 2, start + span];
  }
  return {
    left: { x: left, y: rowY },
    centre: { x: centre, y: rowY },
    right: { x: right, y: rowY },
    top: { x: columnX, y: top },
    middle: { x: columnX, y: middle },
    bottom: { x: columnX, y: bottom },
  };
}

/** Update that shifts a markup by a document-space amount. */
export function moveMarkupAction(markup: AlignableMarkup, dx: number, dy: number): AppAction {
  const shifted = (p: Point2D) => ({ x: p.x + dx, y: p.y + dy });
  if ("start" in markup) {
    return {
      type: "UPDATE_MEASUREMENT",
      id: markup.id,
      updates: { start: shifted(markup.start), end: shifted(markup.end) },
    };
  }
  if ("topLeft" in markup) {
    return {
      type: "UPDATE_RECTANGLE",
      id: markup.id,
      updates: { topLeft: shifted(markup.topLeft), bottomRight: shifted(markup.bottomRight) },
    };
  }
  if ("position" in markup) {
    return { type: "UPDATE_NOTE", id: markup.id, updates: { position: shifted(markup.position) } };
  }
  return {
    type: "UPDATE_SHAPE",
    id: markup.id,
    updates: {
      // A callout's arrows keep pointing at what they mark: only its card (index 1) lines up.
      points: markup.points.map((p, i) => (markup.kind === "callout" && i !== 1 ? p : shifted(p))),
    },
  };
}
