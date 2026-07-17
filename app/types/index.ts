import type { DocumentViewport } from "@/app/utils/documentViewport";

export type ToolMode = "calibrate" | "measure" | "rectangle" | "select" | "pan";

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
  color?: string;
}

export interface RectMeasurement {
  id: string;
  topLeft: Point2D;
  bottomRight: Point2D;
  widthLabelOffset: Point2D;
  heightLabelOffset: Point2D;
  color?: string;
}

export interface Scale {
  unitsPerPdfPoint: number;
  calibrationUnit: Unit;
}

export interface PendingCalibrationLine {
  start: Point2D;
  end: Point2D;
}

export interface PendingRectDrag {
  start: Point2D;
  current: Point2D;
}

export interface PendingMarquee {
  start: Point2D;
  current: Point2D;
}

export interface EditingDimension {
  target: "line" | "rectangle";
  id: string;
  field: "length" | "width" | "height";
}

export interface UndoSnapshot {
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  scale: Scale | null;
  selectedIds: string[];
}

export interface AppState {
  tool: ToolMode;
  displayUnit: Unit;
  scale: Scale | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  selectedIds: string[];
  pendingPoint: Point2D | null;
  pendingRectDrag: PendingRectDrag | null;
  pendingMarquee: PendingMarquee | null;
  editingDimension: EditingDimension | null;
  fileBytes: Uint8Array | null;
  fileName: string | null;
  fileType: DocumentType | null;
  fileMimeType: string | null;
  zoom: number;
  calibrateDialogOpen: boolean;
  pendingCalibrationLine: PendingCalibrationLine | null;
  history: UndoSnapshot[];
  documentViewport: DocumentViewport | null;
}

export type AppAction =
  | { type: "SET_TOOL"; tool: ToolMode }
  | { type: "SET_DISPLAY_UNIT"; unit: Unit }
  | { type: "LOAD_FILE"; bytes: Uint8Array; fileName: string; fileType: DocumentType; mimeType: string }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_PENDING_POINT"; point: Point2D | null }
  | { type: "SET_PENDING_RECT_DRAG"; drag: PendingRectDrag | null }
  | { type: "SET_PENDING_MARQUEE"; marquee: PendingMarquee | null }
  | { type: "ADD_MEASUREMENT"; measurement: Measurement }
  | { type: "UPDATE_MEASUREMENT"; id: string; updates: Partial<Measurement> }
  | { type: "DELETE_MEASUREMENT"; id: string }
  | { type: "ADD_RECTANGLE"; rectangle: RectMeasurement }
  | { type: "UPDATE_RECTANGLE"; id: string; updates: Partial<RectMeasurement> }
  | { type: "DELETE_RECTANGLE"; id: string }
  | { type: "SET_SELECTION"; ids: string[] }
  | { type: "DELETE_SELECTED" }
  | { type: "SET_ANNOTATION_COLOR"; ids: string[]; color: string }
  | { type: "SET_EDITING_DIMENSION"; editing: EditingDimension | null }
  | { type: "CLEAR_EDITING_DIMENSION" }
  | { type: "SET_SCALE"; scale: Scale; calibrationMeasurement: Measurement }
  | { type: "OPEN_CALIBRATE_DIALOG"; line: PendingCalibrationLine }
  | { type: "CLOSE_CALIBRATE_DIALOG" }
  | { type: "CLEAR_ALL" }
  | { type: "RECORD_UNDO" }
  | { type: "UNDO" }
  | { type: "SET_DOCUMENT_VIEWPORT"; viewport: DocumentViewport | null };

export const initialState: AppState = {
  tool: "calibrate",
  displayUnit: "ft",
  scale: null,
  measurements: [],
  rectangles: [],
  selectedIds: [],
  pendingPoint: null,
  pendingRectDrag: null,
  pendingMarquee: null,
  editingDimension: null,
  fileBytes: null,
  fileName: null,
  fileType: null,
  fileMimeType: null,
  zoom: 1,
  calibrateDialogOpen: false,
  pendingCalibrationLine: null,
  history: [],
  documentViewport: null,
};
