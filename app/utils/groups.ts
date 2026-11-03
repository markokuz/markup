import type {
  MarkupFlags,
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  ShapeAnnotation,
} from "@/app/types";

interface GroupSource {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
}

function allMarkups(source: GroupSource): (MarkupFlags & { id: string })[] {
  return [
    ...source.measurements.filter((m) => !m.isCalibration),
    ...source.rectangles,
    ...source.notes,
    ...source.shapes,
  ];
}

/** groupId → member ids. A group left with one member counts as ungrouped. */
export function groupMembers(source: GroupSource): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const markup of allMarkups(source)) {
    if (!markup.groupId) continue;
    groups.set(markup.groupId, [...(groups.get(markup.groupId) ?? []), markup.id]);
  }
  for (const [groupId, ids] of groups) {
    if (ids.length < 2) groups.delete(groupId);
  }
  return groups;
}

/** The group each grouped markup is in (only groups of two or more). */
export function groupOf(source: GroupSource): Map<string, string> {
  const byId = new Map<string, string>();
  for (const [groupId, ids] of groupMembers(source)) {
    for (const id of ids) byId.set(id, groupId);
  }
  return byId;
}

/** `ids` plus every other member of any group they touch, in a stable order. */
export function expandToGroups(ids: string[], source: GroupSource): string[] {
  const members = groupMembers(source);
  const groupById = groupOf(source);
  const result = new Set<string>();
  for (const id of ids) {
    const groupId = groupById.get(id);
    for (const member of groupId ? members.get(groupId)! : [id]) result.add(member);
  }
  return [...result];
}

/** Whether Group / Ungroup apply to `selection` (Group needs 2+ markups not already one group). */
export function groupActions(
  selection: string[],
  source: GroupSource,
): { canGroup: boolean; canUngroup: boolean } {
  if (selection.length < 2) return { canGroup: false, canUngroup: false };
  const groupById = groupOf(source);
  const groups = new Set(selection.map((id) => groupById.get(id)).filter(Boolean));
  const isOneGroup = groups.size === 1 && selection.every((id) => groupById.has(id));
  return { canGroup: !isOneGroup, canUngroup: groups.size > 0 };
}

/** "Group N", one past the highest number already used in this document. */
export function nextGroupName(source: GroupSource): string {
  let highest = 0;
  for (const markup of allMarkups(source)) {
    const match = /^Group (\d+)$/.exec(markup.groupName ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Group ${highest + 1}`;
}
