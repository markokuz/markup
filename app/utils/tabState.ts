import type { DocumentTab, TabsState } from "@/app/types";

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
    documentViewport: null,
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
  documentViewport: null,
};
