export type ToolMode = "calibrate" | "measure" | "select" | "pan";

export type Unit = "ft" | "in" | "m" | "mm";

export type DocumentType = "pdf" | "image";

export interface Point2D {
  x: number;
  y: number;
}

export interface Measurement {
  id: string;
  start: Point2D;
  end: Point2D;
  labelOffset: Point2D;
  isCalibration?: boolean;
}

export interface Scale {
  unitsPerPdfPoint: number;
  calibrationUnit: Unit;
}

export interface PendingCalibrationLine {
  start: Point2D;
  end: Point2D;
}

export interface UndoSnapshot {
  measurements: Measurement[];
  scale: Scale | null;
  selectedId: string | null;
}

export interface AppState {
  tool: ToolMode;
  displayUnit: Unit;
  scale: Scale | null;
  measurements: Measurement[];
  selectedId: string | null;
  pendingPoint: Point2D | null;
  fileBytes: Uint8Array | null;
  fileName: string | null;
  fileType: DocumentType | null;
  fileMimeType: string | null;
  zoom: number;
  calibrateDialogOpen: boolean;
  pendingCalibrationLine: PendingCalibrationLine | null;
  history: UndoSnapshot[];
}

export type AppAction =
  | { type: "SET_TOOL"; tool: ToolMode }
  | { type: "SET_DISPLAY_UNIT"; unit: Unit }
  | { type: "LOAD_FILE"; bytes: Uint8Array; fileName: string; fileType: DocumentType; mimeType: string }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_PENDING_POINT"; point: Point2D | null }
  | { type: "ADD_MEASUREMENT"; measurement: Measurement }
  | { type: "UPDATE_MEASUREMENT"; id: string; updates: Partial<Measurement> }
  | { type: "DELETE_MEASUREMENT"; id: string }
  | { type: "SELECT_MEASUREMENT"; id: string | null }
  | { type: "SET_SCALE"; scale: Scale; calibrationMeasurement: Measurement }
  | { type: "OPEN_CALIBRATE_DIALOG"; line: PendingCalibrationLine }
  | { type: "CLOSE_CALIBRATE_DIALOG" }
  | { type: "CLEAR_ALL" }
  | { type: "RECORD_UNDO" }
  | { type: "UNDO" };

export const initialState: AppState = {
  tool: "calibrate",
  displayUnit: "ft",
  scale: null,
  measurements: [],
  selectedId: null,
  pendingPoint: null,
  fileBytes: null,
  fileName: null,
  fileType: null,
  fileMimeType: null,
  zoom: 1,
  calibrateDialogOpen: false,
  pendingCalibrationLine: null,
  history: [],
};
