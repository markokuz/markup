"use client";

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  initialTabsState,
  type AppAction,
  type AppState,
  type TabsState,
} from "@/app/types";
import { appendHistory } from "@/app/utils/history";
import {
  createDocumentTab,
  EMPTY_DOCUMENT_VIEW,
  getActiveTab,
  updateActiveTab,
} from "@/app/utils/tabState";

function removeIdsFromSelection(selectedIds: string[], removedIds: string[]): string[] {
  const removed = new Set(removedIds);
  return selectedIds.filter((id) => !removed.has(id));
}

function tabsReducer(state: TabsState, action: AppAction): TabsState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          pendingPoint: null,
          pendingMarquee: null,
          editingDimension: null,
          editingNoteId: null,
          selectedIds: action.tool === "select" ? tab.selectedIds : [],
        })),
        tool: action.tool,
      };
    case "SET_DISPLAY_UNIT":
      return { ...state, displayUnit: action.unit };
    case "LOAD_FILE": {
      const tab = createDocumentTab({
        bytes: action.bytes,
        fileName: action.fileName,
        fileType: action.fileType,
        mimeType: action.mimeType,
      });
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        tool: "calibrate",
      };
    }
    case "SWITCH_TAB":
      if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    case "CLOSE_TAB": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1) return state;

      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      let activeTabId = state.activeTabId;

      if (state.activeTabId === action.tabId) {
        activeTabId =
          tabs.length === 0
            ? null
            : tabs[Math.min(index, tabs.length - 1)].id;
      }

      return { ...state, tabs, activeTabId };
    }
    case "SET_ZOOM":
      return updateActiveTab(state, (tab) => ({ ...tab, zoom: action.zoom }));
    case "SET_ROTATION":
      return updateActiveTab(state, (tab) => ({ ...tab, rotation: action.rotation }));
    case "SET_PENDING_POINT":
      return updateActiveTab(state, (tab) => ({ ...tab, pendingPoint: action.point }));
    case "SET_PENDING_MARQUEE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        pendingMarquee: action.marquee,
      }));
    case "ADD_MEASUREMENT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        measurements: [...tab.measurements, action.measurement],
        pendingPoint: null,
      }));
    case "UPDATE_MEASUREMENT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        measurements: tab.measurements.map((m) =>
          m.id === action.id ? { ...m, ...action.updates } : m,
        ),
      }));
    case "DELETE_MEASUREMENT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        measurements: tab.measurements.filter((m) => m.id !== action.id),
        selectedIds: removeIdsFromSelection(tab.selectedIds, [action.id]),
        editingDimension:
          tab.editingDimension?.target === "line" &&
          tab.editingDimension.id === action.id
            ? null
            : tab.editingDimension,
      }));
    case "ADD_RECTANGLE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        rectangles: [...tab.rectangles, action.rectangle],
        pendingPoint: null,
      }));
    case "UPDATE_RECTANGLE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        rectangles: tab.rectangles.map((r) =>
          r.id === action.id ? { ...r, ...action.updates } : r,
        ),
      }));
    case "DELETE_RECTANGLE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        rectangles: tab.rectangles.filter((r) => r.id !== action.id),
        selectedIds: removeIdsFromSelection(tab.selectedIds, [action.id]),
        editingDimension:
          tab.editingDimension?.target === "rectangle" &&
          tab.editingDimension.id === action.id
            ? null
            : tab.editingDimension,
      }));
    case "ADD_NOTE":
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          history: appendHistory(tab),
          notes: [...tab.notes, action.note],
          selectedIds: [action.note.id],
          editingNoteId: action.note.id,
        })),
        tool: "select",
      };
    case "UPDATE_NOTE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        notes: tab.notes.map((n) =>
          n.id === action.id ? { ...n, ...action.updates } : n,
        ),
      }));
    case "DELETE_NOTE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        notes: tab.notes.filter((n) => n.id !== action.id),
        selectedIds: removeIdsFromSelection(tab.selectedIds, [action.id]),
        editingNoteId: tab.editingNoteId === action.id ? null : tab.editingNoteId,
      }));
    case "SET_SELECTION":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        selectedIds: action.ids,
        editingDimension: null,
        editingNoteId: null,
      }));
    case "DELETE_SELECTED":
      return updateActiveTab(state, (tab) => {
        if (tab.selectedIds.length === 0) return tab;

        const selected = new Set(tab.selectedIds);
        return {
          ...tab,
          history: appendHistory(tab),
          measurements: tab.measurements.filter(
            (m) => !selected.has(m.id) || m.isCalibration,
          ),
          rectangles: tab.rectangles.filter((r) => !selected.has(r.id)),
          notes: tab.notes.filter((n) => !selected.has(n.id)),
          selectedIds: [],
          editingDimension: null,
          editingNoteId: null,
        };
      });
    case "SET_ANNOTATION_COLOR":
      return updateActiveTab(state, (tab) => {
        const targetIds = new Set(action.ids);
        return {
          ...tab,
          history: appendHistory(tab),
          measurements: tab.measurements.map((m) =>
            targetIds.has(m.id) && !m.isCalibration
              ? { ...m, color: action.color }
              : m,
          ),
          rectangles: tab.rectangles.map((r) =>
            targetIds.has(r.id) ? { ...r, color: action.color } : r,
          ),
          notes: tab.notes.map((n) =>
            targetIds.has(n.id) ? { ...n, color: action.color } : n,
          ),
        };
      });
    case "SET_EDITING_DIMENSION":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        editingDimension: action.editing,
        editingNoteId: null,
      }));
    case "CLEAR_EDITING_DIMENSION":
      return updateActiveTab(state, (tab) => ({ ...tab, editingDimension: null }));
    case "SET_EDITING_NOTE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        editingNoteId: action.id,
        editingDimension: null,
      }));
    case "SET_SCALE":
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          history: appendHistory(tab),
          scale: action.scale,
          measurements: [
            ...tab.measurements.filter((m) => !m.isCalibration),
            action.calibrationMeasurement,
          ],
          calibrateDialogOpen: false,
          pendingCalibrationLine: null,
          pendingPoint: null,
        })),
        tool: "measure",
      };
    case "OPEN_CALIBRATE_DIALOG":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        calibrateDialogOpen: true,
        pendingCalibrationLine: action.line,
        pendingPoint: null,
      }));
    case "CLOSE_CALIBRATE_DIALOG":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
      }));
    case "CLEAR_ALL":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        scale: null,
        measurements: [],
        rectangles: [],
        notes: [],
        selectedIds: [],
        pendingPoint: null,
        pendingMarquee: null,
        editingDimension: null,
        editingNoteId: null,
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
      }));
    case "RECORD_UNDO":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
      }));
    case "UNDO":
      return updateActiveTab(state, (tab) => {
        if (tab.history.length === 0) return tab;
        const snapshot = tab.history[tab.history.length - 1];
        return {
          ...tab,
          history: tab.history.slice(0, -1),
          measurements: snapshot.measurements,
          rectangles: snapshot.rectangles,
          notes: snapshot.notes,
          scale: snapshot.scale,
          selectedIds: snapshot.selectedIds,
          pendingPoint: null,
          pendingMarquee: null,
          editingDimension: null,
          editingNoteId: null,
        };
      });
    case "SET_DOCUMENT_VIEWPORT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        documentViewport: action.viewport,
      }));
    default:
      return state;
  }
}

function mergeActiveTabView(state: TabsState): AppState {
  const activeTab = getActiveTab(state);
  if (!activeTab) {
    return {
      ...EMPTY_DOCUMENT_VIEW,
      tool: state.tool,
      displayUnit: state.displayUnit,
      tabs: state.tabs,
      activeTabId: state.activeTabId,
    };
  }

  const { id: _id, ...documentFields } = activeTab;
  return {
    ...documentFields,
    tool: state.tool,
    displayUnit: state.displayUnit,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
  };
}

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const appState = mergeActiveTabView(tabsState);

  return (
    <AppStateContext.Provider value={appState}>
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
