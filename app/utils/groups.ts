import type {
  MarkupGroup,
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  ShapeAnnotation,
} from "@/app/types";
import { SHAPE_KIND_LABELS } from "@/app/utils/shapeMetrics";
import { UNIT_LABELS } from "@/app/utils/units";

interface MarkupSource {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
}

/** Ids of every markup that can be in a group (the calibration line can't). */
export function markupIds(source: MarkupSource): Set<string> {
  return new Set([
    ...source.measurements.filter((m) => !m.isCalibration).map((m) => m.id),
    ...source.rectangles.map((r) => r.id),
    ...source.notes.map((n) => n.id),
    ...source.shapes.map((s) => s.id),
  ]);
}

/** A group's members that still exist (a deleted markup drops out; undo brings it back). */
export function liveMembers(group: MarkupGroup, existing: Set<string>): string[] {
  return group.memberIds.filter((id) => existing.has(id));
}

/** Groups directly inside `parentId` (null: the top level, including orphans). */
export function childGroups(groups: MarkupGroup[], parentId: string | null): MarkupGroup[] {
  const ids = new Set(groups.map((g) => g.id));
  return groups.filter((g) =>
    parentId === null ? !g.parentId || !ids.has(g.parentId) : g.parentId === parentId,
  );
}

/** `groupId` and every group nested anywhere inside it. */
export function groupSubtree(groups: MarkupGroup[], groupId: string): MarkupGroup[] {
  const result: MarkupGroup[] = [];
  const visit = (id: string) => {
    const group = groups.find((g) => g.id === id);
    if (!group || result.includes(group)) return;
    result.push(group);
    for (const child of childGroups(groups, id)) visit(child.id);
  };
  visit(groupId);
  return result;
}

/** Every live markup in `groupId` or its subgroups, once each. */
export function subtreeMembers(groups: MarkupGroup[], groupId: string, existing: Set<string>): string[] {
  return [...new Set(groupSubtree(groups, groupId).flatMap((g) => liveMembers(g, existing)))];
}

/** Putting `groupId` inside `parentId` would loop (itself, or one of its own subgroups). */
export function wouldNestInItself(groups: MarkupGroup[], groupId: string, parentId: string): boolean {
  return groupSubtree(groups, groupId).some((g) => g.id === parentId);
}

/** "Group N", one past the highest number already used in this document. */
export function nextGroupName(groups: MarkupGroup[]): string {
  let highest = 0;
  for (const group of groups) {
    const match = /^Group (\d+)$/.exec(group.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Group ${highest + 1}`;
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null;
const isPoint = (value: unknown) =>
  isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const isUnit = (value: unknown) => typeof value === "string" && Object.hasOwn(UNIT_LABELS, value);
const hasValidColor = (markup: Loose) =>
  markup.color == null || (typeof markup.color === "string" && /^#[0-9a-f]{3,8}$/i.test(markup.color));
const isListOf = (value: unknown, check: (item: Loose) => boolean) =>
  Array.isArray(value) && value.every((item) => isObject(item) && check(item));

/**
 * Markup data read from a file is outside input: anything that would crash the app later
 * has to be caught here. Only checks that, so older files with fewer fields still open.
 */
export function isValidMarkupData(data: unknown): boolean {
  if (!isObject(data)) return false;
  const { scale, zoom } = data;
  return (
    isListOf(data.measurements, (m) => isPoint(m.start) && isPoint(m.end) && hasValidColor(m)) &&
    isListOf(data.rectangles, (r) => isPoint(r.topLeft) && isPoint(r.bottomRight) && hasValidColor(r)) &&
    isListOf(data.notes, (n) => isPoint(n.position) && typeof n.text === "string" && hasValidColor(n)) &&
    (data.shapes == null ||
      isListOf(
        data.shapes,
        (s) =>
          typeof s.kind === "string" &&
          Object.hasOwn(SHAPE_KIND_LABELS, s.kind) &&
          Array.isArray(s.points) &&
          s.points.every(isPoint) &&
          (s.text == null || typeof s.text === "string") &&
          // Only embedded images: a URL here would load from a stranger's server on open.
          (s.image == null || (typeof s.image === "string" && s.image.startsWith("data:image/"))) &&
          hasValidColor(s),
      )) &&
    (data.groups == null || isListOf(data.groups, (g) => Array.isArray(g.memberIds))) &&
    (scale === null ||
      (isObject(scale) &&
        Number.isFinite(scale.unitsPerPdfPoint) &&
        (scale.unitsPerPdfPoint as number) > 0 &&
        isUnit(scale.calibrationUnit))) &&
    isUnit(data.displayUnit) &&
    [0, 90, 180, 270].includes(data.rotation as number) &&
    Number.isFinite(zoom) &&
    (zoom as number) > 0
  );
}

type LegacyGrouped = { id: string; groupId?: string; groupName?: string };

/** Loaded markups plus their groups, converting files saved before groups were a list. */
export function withGroups<T extends MarkupSource & { groups?: MarkupGroup[] }>(
  data: T,
): T & { groups: MarkupGroup[] } {
  if (data.groups) return { ...data, groups: data.groups };
  const { groups, markups } = groupsFromLegacy(data);
  return { ...markups, groups };
}

/**
 * Groups from files saved when each markup carried its own `groupId`/`groupName`,
 * plus the markups with those fields stripped.
 */
export function groupsFromLegacy<T extends MarkupSource>(
  source: T,
): { groups: MarkupGroup[]; markups: T } {
  const groups = new Map<string, MarkupGroup>();
  const strip = <M extends LegacyGrouped>(markup: M): M => {
    if (!markup.groupId) return markup;
    const group = groups.get(markup.groupId) ?? {
      id: markup.groupId,
      name: markup.groupName || "Group",
      memberIds: [],
    };
    group.memberIds.push(markup.id);
    groups.set(markup.groupId, group);
    // JSON drops the undefined fields when the file is next saved.
    return { ...markup, groupId: undefined, groupName: undefined };
  };
  const markups = {
    ...source,
    measurements: source.measurements.map(strip),
    rectangles: source.rectangles.map(strip),
    notes: source.notes.map(strip),
    shapes: source.shapes.map(strip),
  };
  return { groups: [...groups.values()], markups };
}
