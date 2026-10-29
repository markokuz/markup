import type { DocumentViewport } from "@/app/utils/documentViewport";
import { DEFAULT_SETTINGS, type AppSettings, type ColorTool } from "@/app/utils/settings";

export type ToolMode =
  | "calibrate"
  | "measure"
  | "rectangle"
  | "select"
  | "pan"
  | "note"
  | "area"
  | "count"
  | "cloud"
  | "callout"
  | "snapshot";

export type Unit = "ft" | "in" | "m" | "mm";

export type DocumentType = "pdf" | "image";

export type DocumentRotation = 0 | 90 | 180 | 270;

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
  /** User-given name shown in the Markups list (e.g. "Kitchen"). */
  label?: string;
  /** Drawn as a plain markup line: no dimension label or arrowheads. */
  plain?: boolean;
}

export interface RectMeasurement {
  id: string;
  topLeft: Point2D;
  bottomRight: Point2D;
  widthLabelOffset: Point2D;
  heightLabelOffset: Point2D;
  color?: string;
  label?: string;
  /** Drawn as a plain markup box: no dimension labels. */
  plain?: boolean;
}

export interface NoteAnnotation {
  id: string;
  position: Point2D;
  text: string;
  color?: string;
  label?: string;
}

export type ShapeKind = "area" | "count" | "cloud" | "callout" | "image";

/** Generic multi-point markup: area polygon, count group, revision cloud or callout. */
export interface ShapeAnnotation {
  id: string;
  kind: ShapeKind;
  /** area: vertices · count: markers · cloud: two corners · callout: [arrow tip, text anchor] */
  points: Point2D[];
  /** Callout text. */
  text?: string;
  color?: string;
  label?: string;
  /** Count only: number of the first marker (defaults to 1). */
  startAt?: number;
  /** Image (snapshot) only: PNG data URL; points are its TL, TR, BR, BL corners. */
  image?: string;
}

export type CloudMode = "rect" | "freehand";
/** Line and Rect tools: dimensioned measurement or plain markup. */
export type DrawMode = "measure" | "plain";

export interface Scale {
  unitsPerPdfPoint: number;
  calibrationUnit: Unit;
}

export interface PendingCalibrationLine {
  start: Point2D;
  end: Point2D;
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
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  scale: Scale | null;
  selectedIds: string[];
}

/** Per-document state stored in a tab. */
export interface DocumentTab {
  id: string;
  fileBytes: Uint8Array | null;
  fileName: string | null;
  fileType: DocumentType | null;
  fileMimeType: string | null;
  scale: Scale | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  /** Area polygon or count group still receiving clicks. */
  drawingShapeId: string | null;
  selectedIds: string[];
  pendingPoint: Point2D | null;
  pendingMarquee: PendingMarquee | null;
  editingDimension: EditingDimension | null;
  editingNoteId: string | null;
  zoom: number;
  rotation: DocumentRotation;
  calibrateDialogOpen: boolean;
  pendingCalibrationLine: PendingCalibrationLine | null;
  history: UndoSnapshot[];
  /** Undone states, newest last; cleared by any new edit. */
  future: UndoSnapshot[];
  documentViewport: DocumentViewport | null;
  /** Annotations or scale changed since the tab was opened or last saved. */
  dirty: boolean;
  /** Pick 0° or 270° from the page aspect once the document loads. */
  autoOrientPending: boolean;
  /** Linked .mkup file that Ctrl+S writes to (File System Access API). */
  projectHandle: FileSystemFileHandle | null;
  /** Opened from a v1 project with a rotated image; shift coords once size is known. */
  legacyRotationFixPending: boolean;
}

/** Internal reducer state. */
export interface TabsState {
  tool: ToolMode;
  displayUnit: Unit;
  tabs: DocumentTab[];
  activeTabId: string | null;
  /** Magnifier loupe enabled for the measure tool (calibrate always shows it). */
  loupeEnabled: boolean;
  /** Minimap manually hidden by the user. */
  minimapHidden: boolean;
  /** Ask before closing a tab that has unsaved changes. */
  confirmCloseUnsaved: boolean;
  /** Tab awaiting the "unsaved changes" confirmation. */
  pendingCloseTabId: string | null;
  /** Snap drawn lines to horizontal/vertical when close. */
  snapLines: boolean;
  /** Open portrait pages rotated to 270°. */
  autoOrientPortrait: boolean;
  /** Cloud tool: drag a rectangle or draw a freehand outline. */
  cloudMode: CloudMode;
  /** First marker number for new count groups; resets to 1 when the Count tool is picked. */
  countStart: number;
  lineMode: DrawMode;
  rectMode: DrawMode;
  settings: AppSettings;
}

/** Merged view of the active tab plus global settings (returned by useAppState). */
export type AppState = Omit<DocumentTab, "id"> & {
  tool: ToolMode;
  displayUnit: Unit;
  tabs: DocumentTab[];
  activeTabId: string | null;
  loupeEnabled: boolean;
  minimapHidden: boolean;
  confirmCloseUnsaved: boolean;
  pendingCloseTabId: string | null;
  snapLines: boolean;
  autoOrientPortrait: boolean;
  cloudMode: CloudMode;
  countStart: number;
  lineMode: DrawMode;
  rectMode: DrawMode;
  settings: AppSettings;
};

export type AppAction =
  | { type: "SET_TOOL"; tool: ToolMode }
  | { type: "SET_DISPLAY_UNIT"; unit: Unit }
  | {
      type: "LOAD_FILE";
      bytes: Uint8Array;
      fileName: string;
      fileType: DocumentType;
      mimeType: string;
    }
  | {
      type: "LOAD_PROJECT";
      bytes: Uint8Array;
      fileName: string;
      fileType: DocumentType;
      mimeType: string;
      scale: Scale | null;
      measurements: Measurement[];
      rectangles: RectMeasurement[];
      notes: NoteAnnotation[];
      shapes: ShapeAnnotation[];
      displayUnit: Unit;
      zoom: number;
      rotation: DocumentRotation;
      handle?: FileSystemFileHandle | null;
      legacyRotatedImage?: boolean;
      /** Reuse this tab id (restoring a browser backup keeps its session entry). */
      tabId?: string;
    }
  | { type: "SWITCH_TAB"; tabId: string }
  | { type: "CLOSE_TAB"; tabId: string }
  | { type: "REQUEST_CLOSE_TAB"; tabId: string }
  | { type: "CANCEL_CLOSE_TAB" }
  | { type: "MARK_TAB_SAVED"; tabId: string }
  | { type: "SET_CONFIRM_CLOSE_UNSAVED"; enabled: boolean }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_ROTATION"; rotation: DocumentRotation }
  | { type: "SET_PENDING_POINT"; point: Point2D | null }
  | { type: "SET_PENDING_MARQUEE"; marquee: PendingMarquee | null }
  | { type: "ADD_MEASUREMENT"; measurement: Measurement }
  | { type: "UPDATE_MEASUREMENT"; id: string; updates: Partial<Measurement> }
  | { type: "DELETE_MEASUREMENT"; id: string }
  | { type: "ADD_RECTANGLE"; rectangle: RectMeasurement }
  | { type: "UPDATE_RECTANGLE"; id: string; updates: Partial<RectMeasurement> }
  | { type: "DELETE_RECTANGLE"; id: string }
  | { type: "ADD_NOTE"; note: NoteAnnotation }
  | { type: "UPDATE_NOTE"; id: string; updates: Partial<NoteAnnotation> }
  | { type: "DELETE_NOTE"; id: string }
  | { type: "ADD_SHAPE"; shape: ShapeAnnotation; drawing?: boolean }
  | { type: "APPEND_SHAPE_POINT"; id: string; point: Point2D }
  | { type: "FINISH_SHAPE" }
  | { type: "UPDATE_SHAPE"; id: string; updates: Partial<ShapeAnnotation> }
  | { type: "DELETE_SHAPE"; id: string }
  | { type: "SET_SELECTION"; ids: string[] }
  | { type: "NUDGE_SELECTED"; dx: number; dy: number; recordUndo: boolean }
  | { type: "DELETE_SELECTED" }
  | { type: "SET_ANNOTATION_COLOR"; ids: string[]; color: string; recordUndo?: boolean }
  | { type: "SET_ANNOTATION_LABEL"; id: string; label: string }
  | { type: "SET_CLOUD_MODE"; mode: CloudMode }
  | { type: "SET_LINE_MODE"; mode: DrawMode }
  | { type: "SET_RECT_MODE"; mode: DrawMode }
  | { type: "UPDATE_SETTINGS"; patch: Partial<AppSettings> }
  | { type: "SET_TOOL_COLOR"; tool: ColorTool; color: string }
  | { type: "SET_HOTKEY"; tool: ToolMode; key: string }
  | { type: "RESET_SETTINGS" }
  | { type: "SET_COUNT_START"; start: number }
  | { type: "SET_EDITING_DIMENSION"; editing: EditingDimension | null }
  | { type: "CLEAR_EDITING_DIMENSION" }
  | { type: "SET_EDITING_NOTE"; id: string | null }
  | { type: "SET_SCALE"; scale: Scale; calibrationMeasurement: Measurement }
  | { type: "OPEN_CALIBRATE_DIALOG"; line: PendingCalibrationLine }
  | { type: "CLOSE_CALIBRATE_DIALOG" }
  | { type: "CLEAR_ALL" }
  | { type: "RECORD_UNDO" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_DOCUMENT_VIEWPORT"; viewport: DocumentViewport | null }
  | { type: "TOGGLE_LOUPE" }
  | { type: "SET_MINIMAP_HIDDEN"; hidden: boolean }
  | { type: "SET_SNAP_LINES"; enabled: boolean }
  | { type: "SET_AUTO_ORIENT_PORTRAIT"; enabled: boolean }
  | { type: "APPLY_AUTO_ORIENT"; tabId: string; rotation: DocumentRotation }
  | { type: "SET_PROJECT_HANDLE"; tabId: string; handle: FileSystemFileHandle | null }
  | { type: "FIX_LEGACY_ROTATION"; tabId: string; width: number; height: number }
  | {
      type: "PASTE_ANNOTATIONS";
      measurements: Measurement[];
      rectangles: RectMeasurement[];
      notes: NoteAnnotation[];
      shapes: ShapeAnnotation[];
    };

export const initialTabsState: TabsState = {
  tool: "calibrate",
  displayUnit: "ft",
  tabs: [],
  activeTabId: null,
  loupeEnabled: false,
  minimapHidden: false,
  confirmCloseUnsaved: true,
  pendingCloseTabId: null,
  snapLines: true,
  autoOrientPortrait: true,
  cloudMode: "rect",
  countStart: 1,
  lineMode: "measure",
  rectMode: "measure",
  settings: DEFAULT_SETTINGS,
};
