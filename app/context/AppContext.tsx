"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  initialTabsState,
  type AppAction,
  type AppState,
  type Point2D,
  type TabsState,
} from "@/app/types";
import { appendHistory } from "@/app/utils/history";
import {
  loadAutoOrientPortrait,
  loadConfirmCloseUnsaved,
  loadSnapLines,
  saveAutoOrientPortrait,
  saveConfirmCloseUnsaved,
  saveSnapLines,
} from "@/app/utils/preferences";
import {
  createDocumentTab,
  EMPTY_DOCUMENT_VIEW,
  getActiveTab,
  updateActiveTab,
  updateTabById,
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
        tabs: [...state.tabs, { ...tab, autoOrientPending: state.autoOrientPortrait }],
        activeTabId: tab.id,
        tool: "calibrate",
      };
    }
    case "LOAD_PROJECT": {
      const base = createDocumentTab({
        bytes: action.bytes,
        fileName: action.fileName,
        fileType: action.fileType,
        mimeType: action.mimeType,
      });
      const tab = {
        ...base,
        scale: action.scale,
        measurements: action.measurements,
        rectangles: action.rectangles,
        notes: action.notes,
        zoom: action.zoom,
        rotation: action.rotation,
        projectHandle: action.handle ?? null,
        legacyRotationFixPending: action.legacyRotatedImage ?? false,
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        displayUnit: action.displayUnit,
        tool: action.scale ? "measure" : "calibrate",
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

      return {
        ...state,
        tabs,
        activeTabId,
        pendingCloseTabId:
          state.pendingCloseTabId === action.tabId ? null : state.pendingCloseTabId,
      };
    }
    case "REQUEST_CLOSE_TAB": {
      const tab = state.tabs.find((t) => t.id === action.tabId);
      if (!tab) return state;
      if (tab.dirty && state.confirmCloseUnsaved) {
        return { ...state, pendingCloseTabId: tab.id };
      }
      return tabsReducer(state, { type: "CLOSE_TAB", tabId: tab.id });
    }
    case "CANCEL_CLOSE_TAB":
      return { ...state, pendingCloseTabId: null };
    case "MARK_TAB_SAVED":
      return updateTabById(state, action.tabId, (tab) => ({ ...tab, dirty: false }));
    case "SET_CONFIRM_CLOSE_UNSAVED":
      return { ...state, confirmCloseUnsaved: action.enabled };
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
    case "NUDGE_SELECTED":
      return updateActiveTab(state, (tab) => {
        if (tab.selectedIds.length === 0) return tab;
        const selected = new Set(tab.selectedIds);
        const { dx, dy } = action;
        return {
          ...tab,
          history: action.recordUndo ? appendHistory(tab) : tab.history,
          measurements: tab.measurements.map((m) =>
            selected.has(m.id) && !m.isCalibration
              ? {
                  ...m,
                  start: { x: m.start.x + dx, y: m.start.y + dy },
                  end: { x: m.end.x + dx, y: m.end.y + dy },
                }
              : m,
          ),
          rectangles: tab.rectangles.map((r) =>
            selected.has(r.id)
              ? {
                  ...r,
                  topLeft: { x: r.topLeft.x + dx, y: r.topLeft.y + dy },
                  bottomRight: {
                    x: r.bottomRight.x + dx,
                    y: r.bottomRight.y + dy,
                  },
                }
              : r,
          ),
          notes: tab.notes.map((n) =>
            selected.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n,
          ),
        };
      });
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
    case "TOGGLE_LOUPE":
      return { ...state, loupeEnabled: !state.loupeEnabled };
    case "SET_MINIMAP_HIDDEN":
      return { ...state, minimapHidden: action.hidden };
    case "SET_SNAP_LINES":
      return { ...state, snapLines: action.enabled };
    case "SET_AUTO_ORIENT_PORTRAIT":
      return { ...state, autoOrientPortrait: action.enabled };
    case "APPLY_AUTO_ORIENT":
      return updateTabById(state, action.tabId, (tab) => ({
        ...tab,
        rotation: action.rotation,
        autoOrientPending: false,
      }));
    case "SET_PROJECT_HANDLE":
      return updateTabById(state, action.tabId, (tab) => ({
        ...tab,
        projectHandle: action.handle,
      }));
    case "FIX_LEGACY_ROTATION":
      return updateTabById(state, action.tabId, (tab) => {
        if (!tab.legacyRotationFixPending) return tab;
        // Pre-v2 rotated-image coords were offset by (height - width) along one
        // doc axis: x at 270°, y at 90°.
        const shift = action.height - action.width;
        const offset =
          tab.rotation === 270 ? { x: -shift, y: 0 } : tab.rotation === 90 ? { x: 0, y: shift } : null;
        if (!offset) return { ...tab, legacyRotationFixPending: false };
        const move = (p: Point2D): Point2D => ({ x: p.x + offset.x, y: p.y + offset.y });
        return {
          ...tab,
          legacyRotationFixPending: false,
          measurements: tab.measurements.map((m) => ({
            ...m,
            start: move(m.start),
            end: move(m.end),
          })),
          rectangles: tab.rectangles.map((r) => ({
            ...r,
            topLeft: move(r.topLeft),
            bottomRight: move(r.bottomRight),
          })),
          notes: tab.notes.map((n) => ({ ...n, position: move(n.position) })),
        };
      });
    case "PASTE_ANNOTATIONS": {
      const pastedIds = [
        ...action.measurements.map((m) => m.id),
        ...action.rectangles.map((r) => r.id),
        ...action.notes.map((n) => n.id),
      ];
      if (pastedIds.length === 0) return state;
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          history: appendHistory(tab),
          measurements: [...tab.measurements, ...action.measurements],
          rectangles: [...tab.rectangles, ...action.rectangles],
          notes: [...tab.notes, ...action.notes],
          selectedIds: pastedIds,
          pendingPoint: null,
          pendingMarquee: null,
          editingDimension: null,
          editingNoteId: null,
        })),
        tool: "select",
      };
    }
    default:
      return state;
  }
}

/** Flags tabs whose annotations or scale changed as a result of an action. */
function trackDirtyTabs(prev: TabsState, next: TabsState): TabsState {
  if (prev.tabs === next.tabs) return next;

  const prevById = new Map(prev.tabs.map((tab) => [tab.id, tab]));
  let changed = false;
  const tabs = next.tabs.map((tab) => {
    const before = prevById.get(tab.id);
    if (!before || tab.dirty) return tab;
    if (
      tab.measurements !== before.measurements ||
      tab.rectangles !== before.rectangles ||
      tab.notes !== before.notes ||
      tab.scale !== before.scale
    ) {
      changed = true;
      return { ...tab, dirty: true };
    }
    return tab;
  });

  return changed ? { ...next, tabs } : next;
}

function appReducer(state: TabsState, action: AppAction): TabsState {
  const next = tabsReducer(state, action);
  // Migrating an old project's coordinates isn't a user edit.
  if (action.type === "FIX_LEGACY_ROTATION") return next;
  return trackDirtyTabs(state, next);
}

function initTabsState(state: TabsState): TabsState {
  return {
    ...state,
    confirmCloseUnsaved: loadConfirmCloseUnsaved(),
    snapLines: loadSnapLines(),
    autoOrientPortrait: loadAutoOrientPortrait(),
  };
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
      loupeEnabled: state.loupeEnabled,
      minimapHidden: state.minimapHidden,
      confirmCloseUnsaved: state.confirmCloseUnsaved,
      pendingCloseTabId: state.pendingCloseTabId,
      snapLines: state.snapLines,
      autoOrientPortrait: state.autoOrientPortrait,
    };
  }

  const { id: _id, ...documentFields } = activeTab;
  return {
    ...documentFields,
    tool: state.tool,
    displayUnit: state.displayUnit,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    loupeEnabled: state.loupeEnabled,
    minimapHidden: state.minimapHidden,
    confirmCloseUnsaved: state.confirmCloseUnsaved,
    pendingCloseTabId: state.pendingCloseTabId,
    snapLines: state.snapLines,
    autoOrientPortrait: state.autoOrientPortrait,
  };
}

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabsState, dispatch] = useReducer(appReducer, initialTabsState, initTabsState);
  const appState = mergeActiveTabView(tabsState);

  useEffect(() => {
    saveConfirmCloseUnsaved(tabsState.confirmCloseUnsaved);
  }, [tabsState.confirmCloseUnsaved]);

  useEffect(() => {
    saveSnapLines(tabsState.snapLines);
  }, [tabsState.snapLines]);

  useEffect(() => {
    saveAutoOrientPortrait(tabsState.autoOrientPortrait);
  }, [tabsState.autoOrientPortrait]);

  // Warn before the browser tab itself closes or reloads with unsaved work.
  const hasUnsavedTabs = tabsState.tabs.some((tab) => tab.dirty);
  useEffect(() => {
    if (!hasUnsavedTabs || !tabsState.confirmCloseUnsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedTabs, tabsState.confirmCloseUnsaved]);

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
