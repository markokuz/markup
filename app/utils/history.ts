import type { DocumentTab, UndoSnapshot } from "@/app/types";

const MAX_HISTORY = 50;

export function createUndoSnapshot(
  tab: Pick<
    DocumentTab,
    "measurements" | "rectangles" | "notes" | "scale" | "selectedIds"
  >,
): UndoSnapshot {
  return {
    measurements: structuredClone(tab.measurements),
    rectangles: structuredClone(tab.rectangles),
    notes: structuredClone(tab.notes),
    scale: tab.scale ? { ...tab.scale } : null,
    selectedIds: [...tab.selectedIds],
  };
}

export function appendHistory(tab: DocumentTab): UndoSnapshot[] {
  return [...tab.history, createUndoSnapshot(tab)].slice(-MAX_HISTORY);
}
