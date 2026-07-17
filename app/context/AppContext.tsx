"use client";

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  initialState,
  type AppAction,
  type AppState,
} from "@/app/types";
import { appendHistory } from "@/app/utils/history";

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        tool: action.tool,
        pendingPoint: null,
        pendingRectDrag: null,
        editingDimension: null,
        selectedId: action.tool === "select" ? state.selectedId : null,
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
      };
    case "SET_ZOOM":
      return { ...state, zoom: action.zoom };
    case "SET_PENDING_POINT":
      return { ...state, pendingPoint: action.point };
    case "SET_PENDING_RECT_DRAG":
      return { ...state, pendingRectDrag: action.drag };
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
        selectedId: state.selectedId === action.id ? null : state.selectedId,
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
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        editingDimension:
          state.editingDimension?.target === "rectangle" &&
          state.editingDimension.id === action.id
            ? null
            : state.editingDimension,
      };
    }
    case "SELECT_MEASUREMENT":
      return {
        ...state,
        selectedId: action.id,
        editingDimension: null,
      };
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
        selectedId: null,
        pendingPoint: null,
        pendingRectDrag: null,
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
        selectedId: snapshot.selectedId,
        pendingPoint: null,
        pendingRectDrag: null,
        editingDimension: null,
      };
    }
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
