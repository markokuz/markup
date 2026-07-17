import type { AppState, UndoSnapshot } from "@/app/types";

const MAX_HISTORY = 50;

export function createUndoSnapshot(state: AppState): UndoSnapshot {
  return {
    measurements: structuredClone(state.measurements),
    rectangles: structuredClone(state.rectangles),
    scale: state.scale ? { ...state.scale } : null,
    selectedId: state.selectedId,
  };
}

export function appendHistory(state: AppState): UndoSnapshot[] {
  return [...state.history, createUndoSnapshot(state)].slice(-MAX_HISTORY);
}
