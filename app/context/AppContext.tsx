"use client";

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { initialState, type AppAction, type AppState } from "@/app/types";
import { appendHistory } from "@/app/utils/history";

function removeIdsFromSelection(selectedIds: string[], removedIds: string[]): string[] {
  const removed = new Set(removedIds);
  return selectedIds.filter((id) => !removed.has(id));
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        tool: action.tool,
        pendingPoint: null,
        pendingRectDrag: null,
        pendingMarquee: null,
        editingDimension: null,
        selectedIds: action.tool === "select" ? state.selectedIds : [],
      };
    case "SET_DISPLAY_UNIT":
      return { ...state, displayUnit: action.unit };
    case "LOAD_FILE":
      return {
        ...initialState,
        fileBytes: action.bytes,
        fileName: action.fileName,
        fileType: action.fileType,
        fileMimeType: action.mimeType,
        zoom: 1,
        documentViewport: null,
      };
    case "SET_ZOOM":
      return { ...state, zoom: action.zoom };
    case "SET_PENDING_POINT":
      return { ...state, pendingPoint: action.point };
    case "SET_PENDING_RECT_DRAG":
      return { ...state, pendingRectDrag: action.drag };
    case "SET_PENDING_MARQUEE":
      return { ...state, pendingMarquee: action.marquee };
    case "ADD_MEASUREMENT":
      return {
        ...state,
        history: appendHistory(state),
        measurements: [...state.measurements, action.measurement],
        pendingPoint: null,
      };
    case "UPDATE_MEASUREMENT":
      return {
        ...state,
        measurements: state.measurements.map((m) =>
          m.id === action.id ? { ...m, ...action.updates } : m,
        ),
      };
    case "DELETE_MEASUREMENT": {
      const measurements = state.measurements.filter((m) => m.id !== action.id);
      return {
        ...state,
        history: appendHistory(state),
        measurements,
        selectedIds: removeIdsFromSelection(state.selectedIds, [action.id]),
        editingDimension:
          state.editingDimension?.target === "line" &&
          state.editingDimension.id === action.id
            ? null
            : state.editingDimension,
      };
    }
    case "ADD_RECTANGLE":
      return {
        ...state,
        history: appendHistory(state),
        rectangles: [...state.rectangles, action.rectangle],
        pendingRectDrag: null,
      };
    case "UPDATE_RECTANGLE":
      return {
        ...state,
        rectangles: state.rectangles.map((r) =>
          r.id === action.id ? { ...r, ...action.updates } : r,
        ),
      };
    case "DELETE_RECTANGLE": {
      const rectangles = state.rectangles.filter((r) => r.id !== action.id);
      return {
        ...state,
        history: appendHistory(state),
        rectangles,
        selectedIds: removeIdsFromSelection(state.selectedIds, [action.id]),
        editingDimension:
          state.editingDimension?.target === "rectangle" &&
          state.editingDimension.id === action.id
            ? null
            : state.editingDimension,
      };
    }
    case "SET_SELECTION":
      return {
        ...state,
        selectedIds: action.ids,
        editingDimension: null,
      };
    case "DELETE_SELECTED": {
      if (state.selectedIds.length === 0) return state;

      const selected = new Set(state.selectedIds);
      const measurements = state.measurements.filter(
        (m) => !selected.has(m.id) || m.isCalibration,
      );
      const rectangles = state.rectangles.filter((r) => !selected.has(r.id));

      return {
        ...state,
        history: appendHistory(state),
        measurements,
        rectangles,
        selectedIds: [],
        editingDimension: null,
      };
    }
    case "SET_ANNOTATION_COLOR": {
      const targetIds = new Set(action.ids);
      return {
        ...state,
        history: appendHistory(state),
        measurements: state.measurements.map((m) =>
          targetIds.has(m.id) && !m.isCalibration
            ? { ...m, color: action.color }
            : m,
        ),
        rectangles: state.rectangles.map((r) =>
          targetIds.has(r.id) ? { ...r, color: action.color } : r,
        ),
      };
    }
    case "SET_EDITING_DIMENSION":
      return { ...state, editingDimension: action.editing };
    case "CLEAR_EDITING_DIMENSION":
      return { ...state, editingDimension: null };
    case "SET_SCALE":
      return {
        ...state,
        history: appendHistory(state),
        scale: action.scale,
        measurements: [
          ...state.measurements.filter((m) => !m.isCalibration),
          action.calibrationMeasurement,
        ],
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
        pendingPoint: null,
        tool: "measure",
      };
    case "OPEN_CALIBRATE_DIALOG":
      return {
        ...state,
        calibrateDialogOpen: true,
        pendingCalibrationLine: action.line,
        pendingPoint: null,
      };
    case "CLOSE_CALIBRATE_DIALOG":
      return {
        ...state,
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
      };
    case "CLEAR_ALL":
      return {
        ...state,
        history: appendHistory(state),
        scale: null,
        measurements: [],
        rectangles: [],
        selectedIds: [],
        pendingPoint: null,
        pendingRectDrag: null,
        pendingMarquee: null,
        editingDimension: null,
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
      };
    case "RECORD_UNDO":
      return {
        ...state,
        history: appendHistory(state),
      };
    case "UNDO": {
      if (state.history.length === 0) return state;
      const snapshot = state.history[state.history.length - 1];
      return {
        ...state,
        history: state.history.slice(0, -1),
        measurements: snapshot.measurements,
        rectangles: snapshot.rectangles,
        scale: snapshot.scale,
        selectedIds: snapshot.selectedIds,
        pendingPoint: null,
        pendingRectDrag: null,
        pendingMarquee: null,
        editingDimension: null,
      };
    }
    case "SET_DOCUMENT_VIEWPORT":
      return { ...state, documentViewport: action.viewport };
    default:
      return state;
  }
}

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx;
}
