import type { DocumentTab, UndoSnapshot } from "@/app/types";

const MAX_HISTORY = 50;
/** Whole PDF copies undo may hold: each erase keeps the file as it was (plan sets run to 100s of MB). */
const MAX_FILE_VERSIONS = 10;

export function createUndoSnapshot(
  tab: Pick<
    DocumentTab,
    "measurements" | "rectangles" | "notes" | "shapes" | "groups" | "scales" | "selectedIds" | "page" | "fileBytes"
  >,
): UndoSnapshot {
  // Reducers never mutate state in place, so sharing references is safe, and
  // cloning would copy every snapshot image (MBs each) into all 50 steps.
  const { measurements, rectangles, notes, shapes, groups, scales, selectedIds, page, fileBytes } = tab;
  return { measurements, rectangles, notes, shapes, groups, scales, selectedIds, page, fileBytes };
}

export function appendHistory(tab: DocumentTab): UndoSnapshot[] {
  const history = [...tab.history, createUndoSnapshot(tab)].slice(-MAX_HISTORY);
  // Past the limit the oldest steps go, so undo can't reach back before the 10th-last erase.
  const files = new Set<Uint8Array | null>();
  for (let i = history.length - 1; i >= 0; i--) {
    files.add(history[i].fileBytes);
    if (files.size > MAX_FILE_VERSIONS) return history.slice(i + 1);
  }
  return history;
}
