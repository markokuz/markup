import type { AppState, DocumentTab, TabsState } from "@/app/types";

export function createDocumentTab(
  file: {
    bytes: Uint8Array;
    fileName: string;
    fileType: import("@/app/types").DocumentType;
    mimeType: string;
  },
  id: string = crypto.randomUUID(),
): DocumentTab {
  return {
    id,
    fileBytes: file.bytes,
    fileName: file.fileName,
    fileType: file.fileType,
    fileMimeType: file.mimeType,
    scale: null,
    measurements: [],
    rectangles: [],
    notes: [],
    shapes: [],
    drawingShapeId: null,
    selectedIds: [],
    pendingPoint: null,
    pendingMarquee: null,
    editingDimension: null,
    editingNoteId: null,
    zoom: 1,
    rotation: 0,
    calibrateDialogOpen: false,
    pendingCalibrationLine: null,
    history: [],
    future: [],
    documentViewport: null,
    dirty: false,
    autoOrientPending: false,
    projectHandle: null,
    legacyRotationFixPending: false,
    toolColors: {},
  };
}

export function getActiveTab(state: TabsState): DocumentTab | null {
  if (!state.activeTabId) return null;
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function updateActiveTab(
  state: TabsState,
  updater: (tab: DocumentTab) => DocumentTab,
): TabsState {
  if (!state.activeTabId) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === state.activeTabId ? updater(tab) : tab,
    ),
  };
}

export function updateTabById(
  state: TabsState,
  tabId: string,
  updater: (tab: DocumentTab) => DocumentTab,
): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
  };
}

export const EMPTY_DOCUMENT_VIEW = {
  scale: null,
  measurements: [],
  rectangles: [],
  notes: [],
  shapes: [],
  drawingShapeId: null,
  selectedIds: [],
  pendingPoint: null,
  pendingMarquee: null,
  editingDimension: null,
  editingNoteId: null,
  fileBytes: null,
  fileName: null,
  fileType: null,
  fileMimeType: null,
  zoom: 1,
  rotation: 0 as const,
  calibrateDialogOpen: false,
  pendingCalibrationLine: null,
  history: [],
  future: [],
  documentViewport: null,
  dirty: false,
  autoOrientPending: false,
  projectHandle: null,
  legacyRotationFixPending: false,
  toolColors: {},
};

/** The active tab as stored in the tab list (useful for helpers that take a tab). */
export function getActiveTabFromAppState(state: AppState): DocumentTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}
