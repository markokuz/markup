import type { DocumentTab, UndoSnapshot } from "@/app/types";

const MAX_HISTORY = 50;

export function createUndoSnapshot(
  tab: Pick<
    DocumentTab,
    "measurements" | "rectangles" | "notes" | "shapes" | "scale" | "selectedIds"
  >,
): UndoSnapshot {
  // Reducers never mutate state in place, so sharing references is safe, and
  // cloning would copy every snapshot image (MBs each) into all 50 steps.
  const { measurements, rectangles, notes, shapes, scale, selectedIds } = tab;
  return { measurements, rectangles, notes, shapes, scale, selectedIds };
}

export function appendHistory(tab: DocumentTab): UndoSnapshot[] {
  return [...tab.history, createUndoSnapshot(tab)].slice(-MAX_HISTORY);
}
