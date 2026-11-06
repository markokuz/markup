"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Measurement,
  Point2D,
  ShapeAnnotation as ShapeAnnotationType,
} from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import {
  docRectFromScreenCorners,
  getLocalCoords,
  getOppositeScreenCorner,
  getScreenCornerPoint,
  snapScreenPointToAxis,
  toDocPoint,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import {
  calloutTipIndexAt,
  findAnnotationsInMarquee,
  hitTestAnnotations,
  screenRectFromPoints,
} from "@/app/utils/selection";
import {
  applyLineLength,
  applyRectHorizontalEdgeLength,
  applyRectVerticalEdgeLength,
  normalizeRect,
  parseDimensionInput,
  toDocLength,
} from "@/app/utils/dimensions";
import {
  RectangleAnnotation,
  type RectCorner,
  type RectEdge,
} from "@/app/components/RectangleAnnotation";
import { MeasurementLine } from "@/app/components/MeasurementLine";
import { NoteAnnotation } from "@/app/components/NoteAnnotation";
import { ShapeAnnotation } from "@/app/components/ShapeAnnotation";
import { FloatingMenu } from "@/app/components/FloatingMenu";
import {
  areaRings,
  areaToCutAt,
  boxCorners,
  cloudPath,
  eraseFromStrokes,
  pointInPolygon,
  pointInRings,
  rotateAround,
  simplifyPath,
  smoothClosedPath,
  strokePath,
} from "@/app/utils/geometry";
import {
  areaOutline,
  CLOSE_AREA_PX,
  cutoutCount,
  DRAW_DEFAULT_WIDTH,
  drawPieces,
  drawWidth,
  ERASER_DEFAULT_SIZE,
  withoutNearestCutout,
} from "@/app/utils/shapeMetrics";
import { PreviewDimensionLine } from "@/app/components/InlineDimensionLine";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { docDistance } from "@/app/utils/coordinates";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { ANNOTATION_ROOT_ID } from "@/app/utils/viewerBridge";
import { copySelection } from "@/app/utils/clipboard";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { promptCalibration } from "@/app/utils/calibrationPrompt";
import { nextGroupName } from "@/app/utils/groups";
import { captureSnapshot } from "@/app/utils/snapshot";
import {
  getTransformFrame,
  rotateTarget,
  scaleTarget,
  turnedRectCorners,
  type Transformable,
  type TransformFrame,
} from "@/app/utils/transform";
import { viewportZoom } from "@/app/utils/documentViewport";
import {
  calloutCardBox,
  TEXT_DEFAULT_SIZE,
  TEXT_LINE_HEIGHT,
  textFirstLineMiddle,
  textFont,
  textScreenBox,
} from "@/app/utils/noteLayout";
import { getAnnotationColor, REDLINE_COLOR, SELECTION_ACCENT } from "@/app/utils/colors";

interface AnnotationLayerProps {
  viewport: DocumentViewport;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onCursorMove?: (cursor: Point2D | null) => void;
}

type DragMode =
  | { type: "endpoint"; id: string; endpoint: "start" | "end" }
  | { type: "body"; id: string; originPdf: Point2D; startPdf: Point2D; endPdf: Point2D }
  | { type: "rectBody"; id: string; originPdf: Point2D; topLeft: Point2D; bottomRight: Point2D }
  /** Corner/edge resize; points are in the rectangle's unturned frame about `centre`. */
  | { type: "rectCorner"; id: string; fixedCornerScreen: Point2D; rotation: number; centre: Point2D }
  /** Side handle: `fixed` is the opposite corner; `along` keeps the moving corner on its edge. */
  | {
      type: "rectEdge";
      id: string;
      fixedCornerScreen: Point2D;
      axis: "x" | "y";
      along: number;
      rotation: number;
      centre: Point2D;
    }
  | { type: "rotate"; target: Transformable; frame: TransformFrame; startAngle: number }
  | { type: "scale"; target: Transformable; frame: TransformFrame; corner: number }
  | { type: "shapePoint"; id: string; index: number }
  | { type: "marquee"; startScreen: Point2D; currentScreen: Point2D; additive: boolean }
  | { type: "noteBody"; id: string; originPdf: Point2D; startPdf: Point2D }
  /** `only`: move just this point (a callout's card, leaving its arrow tips where they point). */
  | { type: "shapeBody"; id: string; originPdf: Point2D; points: Point2D[]; only?: number }
  /** A freehand stroke being dragged out: a cloud outline or a drawing. */
  | { type: "freehand"; kind: "cloud" | "draw"; points: Point2D[] }
  /** Draw tool eraser being dragged; `last` is the previous screen point it rubbed at. */
  | { type: "erase"; last: Point2D; recorded: boolean }
  /** Moves the whole selection; a press without movement selects just `id`. */
  | { type: "group"; id: string; lastPdf: Point2D; moved: boolean };

const MIN_RECT_SIZE = 5;
/** Drags that carry a markup across the page (they show the four-way move cursor). */
const MOVE_DRAGS = new Set<DragMode["type"]>(["body", "rectBody", "noteBody", "shapeBody", "group"]);
const MIN_MARQUEE_SIZE = 4;
/** Freehand clouds: sample spacing, jitter tolerance and minimum size, in screen px. */
const FREEHAND_STEP_PX = 3;
const FREEHAND_SIMPLIFY_PX = 4;
const MIN_FREEHAND_SIZE = 12;
/** Draw tool strokes keep more of the hand's shape than cloud outlines do. */
const DRAW_SIMPLIFY_PX = 1;
const ROTATION_SNAP_TOLERANCE_DEG = 5;
/** New text starts this far right of the click, in screen px, clear of the I-beam. */
const TEXT_CURSOR_GAP_PX = 2;
const CALIBRATE_TO_MEASURE =
  "Set the scale to measure: click Calibrate, then two points on a known dimension. For markup only, switch to Plain.";
/** Two presses this close in time and space are a double-click. */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 5;

const CALIBRATE_FOR_AREA =
  "Set the scale to see area and perimeter: click Calibrate, then two points on a known dimension.";
const CALIBRATE_FOR_RUN =
  "Set the scale to see this run's length: click Calibrate, then two points on a known dimension.";
/** Selected text's move tab sits this far outside its left edge (centre), clear of the corner handles. */
const TEXT_MOVE_TAB_OFFSET_PX = 16;
/** Selected callout's + handle sits this far below its card (centre). */
const CALLOUT_ADD_HANDLE_OFFSET_PX = 16;
/** A click on the + handle with no drag leaves the new arrow's tip this far below the handle. */
const CALLOUT_NEW_ARROW_PX = 48;
/** Text tool I-beam whose hotspot is its exact centre (the system `text` cursor's varies by OS). */
const TEXT_TOOL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24">' +
    '<path d="M5 2.5h6M8 2.5v19M5 21.5h6" fill="none" stroke-linecap="round" stroke="#fff" stroke-width="3.5"/>' +
    '<path d="M5 2.5h6M8 2.5v19M5 21.5h6" fill="none" stroke-linecap="round" stroke="#000" stroke-width="1.5"/>' +
    "</svg>",
)}") 8 12, text`;
/** Right-click menu for the markup `id` (or the selection it belongs to). */
interface ContextMenu {
  id: string;
  /** Window point clicked; the menu closes if the view scrolls or zooms. */
  clientX: number;
  clientY: number;
  /** The same point on the document. */
  docPoint: Point2D;
}

interface ContextMenuItem {
  label: string;
  run: () => void;
}

function createId() {
  return crypto.randomUUID();
}

export function AnnotationLayer({
  viewport,
  overlayRef,
  onCursorMove,
}: AnnotationLayerProps) {
  const state = useAppState();
  const toolColors = useMemo(
    () => ({ ...state.settings.toolColors, ...state.toolColors }),
    [state.settings.toolColors, state.toolColors],
  );
  const dispatch = useAppDispatch();
  const newDrawWidth = state.settings.drawWidth ?? DRAW_DEFAULT_WIDTH;
  const [previewEnd, setPreviewEnd] = useState<Point2D | null>(null);
  // Length typed after a line's first click; it belongs to that start point only.
  const [typed, setTyped] = useState<{ start: Point2D; text: string } | null>(null);
  const typedLength =
    typed && state.tool === "measure" && typed.start === state.pendingPoint ? typed.text : "";
  /** Screen points of the freehand cloud being drawn. */
  const [freehandStroke, setFreehandStroke] = useState<Point2D[] | null>(null);
  /** Screen point under the eraser, for its outline. */
  const [eraserAt, setEraserAt] = useState<Point2D | null>(null);
  const erasing = state.tool === "draw" && state.drawEraser;
  /** Select tool cursor from what is under (or being dragged by) the pointer. */
  const [selectCursor, setSelectCursor] = useState<string | null>(null);
  const eraserRadius = (state.settings.eraserSize ?? ERASER_DEFAULT_SIZE) / 2;
  const dragRef = useRef<DragMode | null>(null);
  /** A move drag has started but not moved yet, so its undo step is still to be saved. */
  const moveUndoPendingRef = useRef(false);
  /** Last vertex press on an area or run, to spot a double-click. */
  const lastPressRef = useRef({ time: -Infinity, x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  /** A new callout arrow from the right-click menu is following the pointer, waiting for a click. */
  const [placingArrow, setPlacingArrow] = useState<{ id: string; index: number } | null>(null);

  const cancelPlacingArrow = useCallback(() => {
    setPlacingArrow(null);
    dispatch({ type: "UNDO" });
  }, [dispatch]);

  const moveShapePoint = useCallback(
    (id: string, index: number, point: Point2D) => {
      const shape = state.shapes.find((s) => s.id === id);
      if (!shape) return;
      // Stay on the page: a handle dragged off it could never be grabbed again.
      const screen = toScreenPoint(viewport, point.x, point.y);
      const onPage = toDocPoint(
        viewport,
        Math.min(Math.max(screen.x, 0), viewport.width),
        Math.min(Math.max(screen.y, 0), viewport.height),
      );
      dispatch({
        type: "UPDATE_SHAPE",
        id,
        updates: { points: shape.points.map((p, i) => (i === index ? onPage : p)) },
      });
    },
    [dispatch, state.shapes, viewport],
  );

  useEffect(() => {
    if (!placingArrow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelPlacingArrow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelPlacingArrow, placingArrow]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    // The menu sits at a fixed window point, so it can't follow the drawing.
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const handleSelect = useCallback(
    (id: string, additive: boolean) => {
      if (additive) {
        const isSelected = state.selectedIds.includes(id);
        dispatch({
          type: "SET_SELECTION",
          ids: isSelected
            ? state.selectedIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedIds, id],
        });
      } else {
        dispatch({ type: "SET_SELECTION", ids: [id] });
      }
    },
    [dispatch, state.selectedIds],
  );

  /** Doc point under the cursor, snapped straight from `anchorDoc` when snapping is on. */
  const snapToLine = useCallback(
    (anchorDoc: Point2D | null, local: Point2D): Point2D => {
      if (!state.snapLines || !anchorDoc) return toDocPoint(viewport, local.x, local.y);
      const anchorScreen = toScreenPoint(viewport, anchorDoc.x, anchorDoc.y);
      const snapped = snapScreenPointToAxis(
        anchorScreen,
        local,
        state.settings.snapToleranceDeg,
        state.settings.snapStepDeg,
      );
      return toDocPoint(viewport, snapped.x, snapped.y);
    },
    [state.settings.snapStepDeg, state.settings.snapToleranceDeg, state.snapLines, viewport],
  );

  const startShapeDrag = useCallback(
    (shape: ShapeAnnotationType, originPdf: Point2D, event: React.PointerEvent, only?: number) => {
      if (shape.locked) return;
      moveUndoPendingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        type: "shapeBody",
        id: shape.id,
        originPdf,
        points: shape.points.map((p) => ({ ...p })),
        only,
      };
    },
    [],
  );

  /** Capture the boxed area and put it on the clipboard for Ctrl+V (Bluebeam-style Snapshot). */
  const takeSnapshot = useCallback(
    async (cornerA: Point2D, cornerB: Point2D) => {
      if (!state.fileBytes || !state.fileType) return;
      const a = toScreenPoint(viewport, cornerA.x, cornerA.y);
      const b = toScreenPoint(viewport, cornerB.x, cornerB.y);
      if (Math.abs(a.x - b.x) < MIN_RECT_SIZE || Math.abs(a.y - b.y) < MIN_RECT_SIZE) return;
      showSaveStatus("saving", "Copying snapshot…");
      try {
        const snapshot = await captureSnapshot(
          {
            fileType: state.fileType,
            fileBytes: state.fileBytes,
            page: state.page,
            fileName: state.fileName ?? "",
            mimeType: state.fileMimeType ?? "",
            docOrigin: viewport.docOrigin,
          },
          cornerA,
          cornerB,
        );
        if (!snapshot) return;
        const shape: ShapeAnnotationType = { id: createId(), kind: "image", ...snapshot };
        copySelection(
          {
            measurements: [],
            rectangles: [],
            notes: [],
            shapes: [shape],
            selectedIds: [shape.id],
            scale: state.scale,
            zoom: state.zoom,
          },
          viewport,
        );
        showSaveStatus("success", "Snapshot copied — Ctrl+V to paste");
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        showSaveStatus("error", `Couldn't copy snapshot: ${message}`);
      }
    },
    [state.fileBytes, state.fileMimeType, state.fileName, state.fileType, state.page, state.scale, state.zoom, viewport],
  );

  /** Add a finished Line-tool line (second click or a typed length). */
  const placeLine = useCallback(
    (start: Point2D, end: Point2D) => {
      dispatch({
        type: "ADD_MEASUREMENT",
        measurement: {
          id: createId(),
          start,
          end,
          color: toolColors.measure,
          ...(state.lineMode === "plain" ? { plain: true } : {}),
        },
      });
    },
    [dispatch, state.lineMode, toolColors.measure],
  );

  /** End of a line `text` long (display units) from `start` toward `toward`; null if unreadable. */
  const typedLineEnd = useCallback(
    (start: Point2D, toward: Point2D | null, text: string): Point2D | null => {
      const value = parseDimensionInput(text, state.displayUnit);
      if (value === null || !state.scale) return null;
      let dx = toward ? toward.x - start.x : 0;
      let dy = toward ? toward.y - start.y : 0;
      if (Math.hypot(dx, dy) < 1e-9) {
        // Cursor on the start point: go screen-right.
        const s = toScreenPoint(viewport, start.x, start.y);
        const right = toDocPoint(viewport, s.x + 1, s.y);
        dx = right.x - start.x;
        dy = right.y - start.y;
      }
      const length = toDocLength(value, state.scale, state.displayUnit);
      const k = length / Math.hypot(dx, dy);
      return { x: start.x + dx * k, y: start.y + dy * k };
    },
    [state.displayUnit, state.scale, viewport],
  );

  // After a line's first click, typing a length and pressing Enter places it at that length.
  useEffect(() => {
    if (state.tool !== "measure" || !state.pendingPoint) return;
    const start = state.pendingPoint;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (/^[0-9.'"/ -]$/.test(event.key)) {
        if (event.key === " " && !typedLength) return;
        consume();
        setTyped({ start, text: typedLength + event.key });
      } else if (event.key === "Backspace" && typedLength) {
        consume();
        setTyped({ start, text: typedLength.slice(0, -1) });
      } else if (event.key === "Escape" && typedLength) {
        consume();
        setTyped(null);
      } else if (event.key === "Enter" && typedLength) {
        consume();
        if (!state.scale) {
          promptCalibration(CALIBRATE_TO_MEASURE);
          return;
        }
        const end = typedLineEnd(start, previewEnd, typedLength);
        if (!end) return;
        setTyped(null);
        placeLine(start, end);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [placeLine, previewEnd, state.pendingPoint, state.scale, state.tool, typedLength, typedLineEnd]);

  /** Rub out drawings at these screen points (one undo step per eraser drag). */
  const eraseAlong = useCallback(
    (screenPoints: Point2D[], drag: Extract<DragMode, { type: "erase" }>) => {
      const pxPerDoc = viewportZoom(viewport);
      const centres = screenPoints.map((p) => toDocPoint(viewport, p.x, p.y));
      // Skip the dispatch (and the undo step) when the eraser touches nothing.
      const touches = state.shapes.some(
        (shape) =>
          shape.kind === "draw" &&
          !shape.locked &&
          centres.some(
            (c) =>
              eraseFromStrokes(drawPieces(shape), c, (eraserRadius + drawWidth(shape) / 2) / pxPerDoc) !==
              null,
          ),
      );
      if (!touches) return;
      dispatch({
        type: "ERASE_DRAWINGS",
        centres,
        radiusPx: eraserRadius,
        pxPerDoc,
        recordUndo: !drag.recorded,
      });
      drag.recorded = true;
    },
    [dispatch, eraserRadius, state.shapes, viewport],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (state.tool === "pan") return;
      // A click outside a note/text being typed only finishes it (its blur saves it).
      if (state.editingNoteId) return;
      // The click that closes the line menu does nothing else.
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      // Right-click opens the tool's menu instead of placing a point.
      if ((state.tool === "measure" || state.tool === "area") && event.button !== 0) return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      if (state.tool === "select") {
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        const hitId = hitTestAnnotations(
          local,
          state.measurements,
          state.rectangles,
          state.notes,
          state.shapes,
          viewport,
          state.scale,
          state.displayUnit,
        );

        if (hitId) {
          handleSelect(hitId, additive);
          const shape = state.shapes.find((s) => s.id === hitId);
          // Shapes have no per-part handles: press and drag moves the whole markup.
          // A callout's arrow line moves it all; the very edge of its card moves just the card.
          const cardOnly = shape?.kind === "callout" && calloutTipIndexAt(shape, local, viewport) < 0;
          if (shape && !additive) startShapeDrag(shape, pdfPoint, event, cardOnly ? 1 : undefined);
          return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          type: "marquee",
          startScreen: local,
          currentScreen: local,
          additive,
        };
        if (!additive) {
          dispatch({ type: "SET_SELECTION", ids: [] });
        }
        dispatch({
          type: "SET_PENDING_MARQUEE",
          marquee: { start: local, current: local },
        });
        return;
      }

      if (state.tool === "note") {
        event.preventDefault();
        event.stopPropagation();
        dispatch({
          type: "ADD_NOTE",
          note: {
            id: createId(),
            position: pdfPoint,
            text: "",
            color: toolColors.note,
          },
        });
        return;
      }

      if (state.tool === "text") {
        event.preventDefault();
        event.stopPropagation();
        const hitId = hitTestAnnotations(
          local,
          [],
          [],
          [],
          state.shapes.filter((s) => s.kind === "text"),
          viewport,
          state.scale,
          state.displayUnit,
        );
        // Clicking existing text edits it instead of stacking a new box on top.
        if (hitId) {
          dispatch({ type: "SET_SELECTION", ids: [hitId] });
          dispatch({ type: "SET_EDITING_NOTE", id: hitId });
          return;
        }
        // The last size picked, else the default — the same size on the page at any zoom.
        const fontSize = state.settings.textSize ?? TEXT_DEFAULT_SIZE;
        // Start typing just right of the I-beam, with the first line's capitals centred on it.
        const firstLineMiddle = textFirstLineMiddle(fontSize * viewportZoom(viewport));
        dispatch({
          type: "ADD_SHAPE",
          shape: {
            id: createId(),
            kind: "text",
            points: [toDocPoint(viewport, local.x + TEXT_CURSOR_GAP_PX, local.y - firstLineMiddle)],
            text: "",
            fontSize,
            color: toolColors.text,
          },
        });
        return;
      }

      if (state.tool === "area" || state.tool === "polyline" || state.tool === "count") {
        const drawing = state.shapes.find(
          (s) => s.id === state.drawingShapeId && s.kind === state.tool,
        );
        // A shape in progress stays what it started as; only a new one follows the mode.
        const startingCut = state.tool === "area" && !drawing && state.areaMode === "cut";
        const cutoutTarget = startingCut
          ? areaToCutAt(state.shapes, pdfPoint)
          : drawing && state.shapes.find((s) => s.id === state.cutoutTargetId);
        if (startingCut && !cutoutTarget) {
          showSaveStatus("warning", "Click inside an unlocked area to start cutting it out.");
          return;
        }
        // shortcut: only the clicks are checked, so a cutout's edge can still cross a concave
        // outline or another cutout; clip the polygons if that shows up in real use.
        if (state.tool === "area" && cutoutTarget && !pointInRings(pdfPoint, areaRings(cutoutTarget))) {
          showSaveStatus("warning", "A cutout has to stay inside the area, clear of other cutouts.");
          return;
        }
        // pointerdown's event.detail is always 0 in Chromium, so the click count can't say this.
        const previous = lastPressRef.current;
        lastPressRef.current = { time: event.timeStamp, x: local.x, y: local.y };
        const secondPress =
          event.timeStamp - previous.time <= DOUBLE_CLICK_MS &&
          Math.hypot(local.x - previous.x, local.y - previous.y) <= DOUBLE_CLICK_PX;
        if (!drawing) {
          // Areas and runs still draw unscaled, just without their label.
          if (state.tool === "area" && !state.scale) promptCalibration(CALIBRATE_FOR_AREA);
          if (state.tool === "polyline" && !state.scale) promptCalibration(CALIBRATE_FOR_RUN);
          dispatch({
            type: "ADD_SHAPE",
            shape: {
              id: createId(),
              kind: state.tool,
              points: [pdfPoint],
              color: toolColors[state.tool],
              ...(state.tool === "count" && state.countStart !== 1
                ? { startAt: state.countStart }
                : {}),
            },
            drawing: true,
            cutoutTargetId: startingCut ? cutoutTarget?.id : undefined,
          });
          setPreviewEnd(pdfPoint);
          return;
        }
        if (drawing.kind === "area") {
          const first = toScreenPoint(viewport, drawing.points[0].x, drawing.points[0].y);
          const closesOnFirst =
            drawing.points.length >= 3 &&
            Math.hypot(local.x - first.x, local.y - first.y) <= CLOSE_AREA_PX;
          // Second press of a double-click finishes without adding a duplicate vertex.
          if (closesOnFirst || secondPress) {
            dispatch({ type: "FINISH_SHAPE" });
            setPreviewEnd(null);
            return;
          }
        }
        if (drawing.kind === "polyline") {
          // Second press of a double-click finishes without adding a duplicate vertex.
          if (secondPress) {
            dispatch({ type: "FINISH_SHAPE" });
            setPreviewEnd(null);
            return;
          }
          const last = drawing.points[drawing.points.length - 1];
          dispatch({ type: "APPEND_SHAPE_POINT", id: drawing.id, point: snapToLine(last, local) });
          return;
        }
        dispatch({ type: "APPEND_SHAPE_POINT", id: drawing.id, point: pdfPoint });
        return;
      }

      if (state.tool === "draw" && state.drawEraser) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement | null)?.blur();
        event.currentTarget.setPointerCapture(event.pointerId);
        const drag: DragMode = { type: "erase", last: local, recorded: false };
        dragRef.current = drag;
        eraseAlong([local], drag);
        return;
      }

      if (state.tool === "draw" || (state.tool === "cloud" && state.cloudMode === "freehand")) {
        // Without this the drag also selects markup text, and the next press on that
        // selection starts a native drag that cancels the stroke after a few points.
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        // preventDefault also keeps focus where it was (e.g. the width slider), which would
        // swallow tool hotkeys; pressing the drawing should take focus off it as usual.
        (document.activeElement as HTMLElement | null)?.blur();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { type: "freehand", kind: state.tool, points: [local] };
        setFreehandStroke([local]);
        return;
      }

      if (state.tool === "snapshot") {
        if (!state.pendingPoint) {
          dispatch({ type: "SET_PENDING_POINT", point: pdfPoint });
          setPreviewEnd(pdfPoint);
          return;
        }
        const start = state.pendingPoint;
        dispatch({ type: "SET_PENDING_POINT", point: null });
        setPreviewEnd(null);
        void takeSnapshot(start, pdfPoint);
        return;
      }

      if (state.tool === "cloud" || state.tool === "callout") {
        if (!state.pendingPoint) {
          dispatch({ type: "SET_PENDING_POINT", point: pdfPoint });
          setPreviewEnd(pdfPoint);
          return;
        }
        const start = state.pendingPoint;
        const a = toScreenPoint(viewport, start.x, start.y);
        if (Math.hypot(local.x - a.x, local.y - a.y) < MIN_RECT_SIZE) {
          dispatch({ type: "SET_PENDING_POINT", point: null });
        } else {
          event.preventDefault();
          dispatch({
            type: "ADD_SHAPE",
            shape: {
              id: createId(),
              kind: state.tool,
              points: [start, pdfPoint],
              color: toolColors[state.tool],
              ...(state.tool === "callout" ? { text: "" } : {}),
            },
          });
        }
        setPreviewEnd(null);
        return;
      }

      // Measured lines and rects need a scale; point the user at Calibrate instead of doing nothing.
      if (
        !state.scale &&
        ((state.tool === "rectangle" && state.rectMode !== "plain") ||
          (state.tool === "measure" && state.lineMode !== "plain"))
      ) {
        promptCalibration(CALIBRATE_TO_MEASURE);
        return;
      }

      const plainRect = state.rectMode === "plain";
      if (state.tool === "rectangle" && (state.scale || plainRect)) {
        if (!state.pendingPoint) {
          dispatch({ type: "SET_PENDING_POINT", point: pdfPoint });
          setPreviewEnd(pdfPoint);
        } else {
          const start = state.pendingPoint;
          const end = pdfPoint;
          const normalized = normalizeRect(start, end);
          const width = Math.abs(normalized.bottomRight.x - normalized.topLeft.x);
          const height = Math.abs(normalized.bottomRight.y - normalized.topLeft.y);

          if (width >= MIN_RECT_SIZE || height >= MIN_RECT_SIZE) {
            dispatch({
              type: "ADD_RECTANGLE",
              rectangle: {
                id: createId(),
                ...normalized,
                color: toolColors.rectangle,
                ...(plainRect ? { plain: true } : {}),
              },
            });
          } else {
            dispatch({ type: "SET_PENDING_POINT", point: null });
            setPreviewEnd(null);
          }
        }
        return;
      }

      if (state.tool === "calibrate" || state.tool === "measure") {
        if (!state.pendingPoint) {
          dispatch({ type: "SET_PENDING_POINT", point: pdfPoint });
          setPreviewEnd(pdfPoint);
        } else {
          const start = state.pendingPoint;
          const end = snapToLine(start, local);

          if (state.tool === "calibrate") {
            dispatch({
              type: "OPEN_CALIBRATE_DIALOG",
              line: { start, end },
            });
          } else if (state.scale || state.lineMode === "plain") {
            placeLine(start, end);
          } else {
            dispatch({ type: "SET_PENDING_POINT", point: null });
            setPreviewEnd(null);
          }
        }
      }
    },
    [
      dispatch,
      eraseAlong,
      handleSelect,
      contextMenu,
      overlayRef,
      placeLine,
      startShapeDrag,
      snapToLine,
      takeSnapshot,
      state.displayUnit,
      state.editingNoteId,
      state.measurements,
      state.notes,
      state.pendingPoint,
      state.rectangles,
      state.scale,
      state.settings.textSize,
      state.shapes,
      state.drawingShapeId,
      state.cutoutTargetId,
      state.areaMode,
      state.cloudMode,
      state.drawEraser,
      state.countStart,
      state.lineMode,
      state.rectMode,
      toolColors,
      state.tool,
      viewport,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      onCursorMove?.(local);
      if (erasing) setEraserAt(local);

      if (state.tool === "select") {
        // Four-way arrows over anything a press would pick up and move, and while moving it.
        let next: string | null = null;
        const drag = dragRef.current;
        if (drag) {
          next = MOVE_DRAGS.has(drag.type) ? "move" : drag.type === "rotate" ? "grabbing" : null;
        } else {
          const hitId = hitTestAnnotations(
            local,
            state.measurements,
            state.rectangles,
            state.notes,
            state.shapes,
            viewport,
            state.scale,
            state.displayUnit,
          );
          if (hitId) {
            const hit =
              state.shapes.find((s) => s.id === hitId) ??
              state.measurements.find((m) => m.id === hitId) ??
              state.rectangles.find((r) => r.id === hitId) ??
              state.notes.find((n) => n.id === hitId);
            next = hit?.locked ? "pointer" : "move";
          }
        }
        if (next !== selectCursor) setSelectCursor(next);
      }

      if (placingArrow) {
        moveShapePoint(placingArrow.id, placingArrow.index, pdfPoint);
        return;
      }

      if (dragRef.current) {
        const drag = dragRef.current;

        if (drag.type === "erase") {
          // Fill in between pointer events so a fast stroke still rubs out a solid band.
          const gap = Math.hypot(local.x - drag.last.x, local.y - drag.last.y);
          const steps = Math.max(1, Math.ceil(gap / Math.max(1, eraserRadius / 2)));
          const along = Array.from({ length: steps }, (_, i) => ({
            x: drag.last.x + ((local.x - drag.last.x) * (i + 1)) / steps,
            y: drag.last.y + ((local.y - drag.last.y) * (i + 1)) / steps,
          }));
          drag.last = local;
          eraseAlong(along, drag);
          return;
        }

        if (moveUndoPendingRef.current && MOVE_DRAGS.has(drag.type)) {
          moveUndoPendingRef.current = false;
          dispatch({ type: "RECORD_UNDO" });
        }

        if (drag.type === "freehand") {
          const last = drag.points[drag.points.length - 1];
          if (Math.hypot(local.x - last.x, local.y - last.y) >= FREEHAND_STEP_PX) {
            drag.points.push(local);
            setFreehandStroke([...drag.points]);
          }
          return;
        }

        if (drag.type === "group") {
          const dx = pdfPoint.x - drag.lastPdf.x;
          const dy = pdfPoint.y - drag.lastPdf.y;
          if (dx === 0 && dy === 0) return;
          dispatch({ type: "NUDGE_SELECTED", dx, dy, recordUndo: !drag.moved });
          dragRef.current = { ...drag, lastPdf: pdfPoint, moved: true };
          return;
        }

        if (drag.type === "marquee") {
          dragRef.current = { ...drag, currentScreen: local };
          dispatch({
            type: "SET_PENDING_MARQUEE",
            marquee: { start: drag.startScreen, current: local },
          });
          return;
        }

        if (drag.type === "endpoint") {
          const measurement = state.measurements.find((m) => m.id === drag.id);
          const fixedEnd = measurement
            ? drag.endpoint === "start"
              ? measurement.end
              : measurement.start
            : null;
          dispatch({
            type: "UPDATE_MEASUREMENT",
            id: drag.id,
            updates: { [drag.endpoint]: snapToLine(fixedEnd, local) },
          });
        } else if (drag.type === "body") {
          const dx = pdfPoint.x - drag.originPdf.x;
          const dy = pdfPoint.y - drag.originPdf.y;
          dispatch({
            type: "UPDATE_MEASUREMENT",
            id: drag.id,
            updates: {
              start: { x: drag.startPdf.x + dx, y: drag.startPdf.y + dy },
              end: { x: drag.endPdf.x + dx, y: drag.endPdf.y + dy },
            },
          });
        } else if (drag.type === "rectBody") {
          const dx = pdfPoint.x - drag.originPdf.x;
          const dy = pdfPoint.y - drag.originPdf.y;
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: {
              topLeft: {
                x: drag.topLeft.x + dx,
                y: drag.topLeft.y + dy,
              },
              bottomRight: {
                x: drag.bottomRight.x + dx,
                y: drag.bottomRight.y + dy,
              },
            },
          });
        } else if (drag.type === "rectCorner" || drag.type === "rectEdge") {
          const p = rotateAround(local, drag.centre, -drag.rotation);
          const moving =
            drag.type === "rectCorner"
              ? p
              : drag.axis === "y"
                ? { x: drag.along, y: p.y }
                : { x: p.x, y: drag.along };
          const corners = turnedRectCorners(moving, drag.fixedCornerScreen, drag.rotation, drag.centre);
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: docRectFromScreenCorners(viewport, corners.moving, corners.fixed),
          });
        } else if (drag.type === "rotate") {
          const pointerAngle = (Math.atan2(local.y - drag.frame.centre.y, local.x - drag.frame.centre.x) * 180) / Math.PI;
          let delta = pointerAngle - drag.startAngle;
          const angle = drag.frame.angle + delta;
          if (event.shiftKey) {
            delta = Math.round(angle / 15) * 15 - drag.frame.angle;
          } else if (state.settings.snapRotation) {
            const nearest = Math.round(angle / 45) * 45;
            if (Math.abs(angle - nearest) <= ROTATION_SNAP_TOLERANCE_DEG) delta = nearest - drag.frame.angle;
          }
          dispatch(rotateTarget(drag.target, drag.frame, delta, viewport));
        } else if (drag.type === "scale") {
          const update = scaleTarget(drag.target, drag.frame, drag.corner, local, viewport);
          if (update) dispatch(update);
        } else if (drag.type === "shapePoint") {
          moveShapePoint(drag.id, drag.index, pdfPoint);
        } else if (drag.type === "shapeBody") {
          const dx = pdfPoint.x - drag.originPdf.x;
          const dy = pdfPoint.y - drag.originPdf.y;
          dispatch({
            type: "UPDATE_SHAPE",
            id: drag.id,
            updates: {
              points: drag.points.map((p, i) =>
                drag.only === undefined || drag.only === i ? { x: p.x + dx, y: p.y + dy } : p,
              ),
            },
          });
        } else if (drag.type === "noteBody") {
          const dx = pdfPoint.x - drag.originPdf.x;
          const dy = pdfPoint.y - drag.originPdf.y;
          dispatch({
            type: "UPDATE_NOTE",
            id: drag.id,
            updates: {
              position: {
                x: drag.startPdf.x + dx,
                y: drag.startPdf.y + dy,
              },
            },
          });
        }
        return;
      }

      if (state.pendingPoint) {
        setPreviewEnd(
          state.tool === "measure" || state.tool === "calibrate"
            ? snapToLine(state.pendingPoint, local)
            : pdfPoint,
        );
      } else if (state.drawingShapeId) {
        const drawing = state.shapes.find((s) => s.id === state.drawingShapeId);
        setPreviewEnd(
          drawing?.kind === "polyline"
            ? snapToLine(drawing.points[drawing.points.length - 1], local)
            : pdfPoint,
        );
      }
    },
    [dispatch, eraseAlong, eraserRadius, erasing, moveShapePoint, placingArrow, selectCursor, state.scale, state.displayUnit, onCursorMove, overlayRef, snapToLine, state.drawingShapeId, state.measurements, state.notes, state.pendingPoint, state.rectangles, state.settings.snapRotation, state.shapes, state.tool, viewport],
  );

  /**
   * Runs before any markup's own handler: a plain press on a member of a multi-selection
   * drags the whole group instead of re-selecting just that one markup.
   */
  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const overlay = overlayRef.current;
      if (placingArrow) {
        // This press only places the arrow; it mustn't also select or move what's under it.
        event.stopPropagation();
        event.preventDefault();
        if (event.button !== 0) {
          cancelPlacingArrow();
          return;
        }
        if (overlay) {
          const at = getLocalCoords(overlay, event.clientX, event.clientY);
          moveShapePoint(placingArrow.id, placingArrow.index, toDocPoint(viewport, at.x, at.y));
        }
        setPlacingArrow(null);
        return;
      }
      if (state.tool !== "select" || (event.button !== 0 && event.button !== 2)) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (!overlay) return;
      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const hitId = hitTestAnnotations(
        local,
        state.measurements,
        state.rectangles,
        state.notes,
        state.shapes,
        viewport,
        state.scale,
        state.displayUnit,
      );
      if (!hitId) return;
      if (event.button === 2) {
        // Right-pressing a selected markup keeps the selection for the right-click menu.
        if (state.selectedIds.includes(hitId)) event.stopPropagation();
        return;
      }
      if (state.selectedIds.length < 2 || !state.selectedIds.includes(hitId)) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        type: "group",
        id: hitId,
        lastPdf: toDocPoint(viewport, local.x, local.y),
        moved: false,
      };
    },
    [cancelPlacingArrow, moveShapePoint, overlayRef, placingArrow, state.displayUnit, state.measurements, state.notes, state.rectangles, state.scale, state.selectedIds, state.shapes, state.tool, viewport],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;

    if (drag?.type === "freehand" && drag.kind === "draw") {
      setFreehandStroke(null);
      // A press without a drag draws nothing.
      const stroke = simplifyPath(drag.points, DRAW_SIMPLIFY_PX);
      if (stroke.length >= 2) {
        dispatch({
          type: "ADD_SHAPE",
          shape: {
            id: createId(),
            kind: "draw",
            points: stroke.map((p) => toDocPoint(viewport, p.x, p.y)),
            color: toolColors.draw,
            strokeWidth: newDrawWidth,
          },
        });
      }
    } else if (drag?.type === "freehand") {
      setFreehandStroke(null);
      const xs = drag.points.map((p) => p.x);
      const ys = drag.points.map((p) => p.y);
      const bigEnough =
        Math.max(...xs) - Math.min(...xs) >= MIN_FREEHAND_SIZE ||
        Math.max(...ys) - Math.min(...ys) >= MIN_FREEHAND_SIZE;
      // Strip hand jitter, then round the corners so the scallops follow a smooth outline.
      const outline = smoothClosedPath(simplifyPath(drag.points, FREEHAND_SIMPLIFY_PX), 2);
      if (bigEnough && outline.length >= 3) {
        dispatch({
          type: "ADD_SHAPE",
          shape: {
            id: createId(),
            kind: "cloud",
            points: outline.map((p) => toDocPoint(viewport, p.x, p.y)),
            color: toolColors.cloud,
          },
        });
      }
    }

    if (drag?.type === "group" && !drag.moved) {
      dispatch({ type: "SET_SELECTION", ids: [drag.id] });
    }

    if (drag?.type === "marquee") {
      const marquee = { start: drag.startScreen, current: drag.currentScreen };
      const dragDistance = Math.hypot(
        marquee.current.x - marquee.start.x,
        marquee.current.y - marquee.start.y,
      );

      if (dragDistance < MIN_MARQUEE_SIZE) {
        if (!drag.additive) {
          dispatch({ type: "SET_SELECTION", ids: [] });
        }
      } else {
        const found = findAnnotationsInMarquee(
          state.measurements,
          state.rectangles,
          state.notes,
          state.shapes,
          viewport,
          marquee,
        );
        dispatch({
          type: "SET_SELECTION",
          ids: drag.additive
            ? [...new Set([...state.selectedIds, ...found])]
            : found,
        });
      }

      dispatch({ type: "SET_PENDING_MARQUEE", marquee: null });
    }

    dragRef.current = null;
    moveUndoPendingRef.current = false;
  }, [dispatch, newDrawWidth, state.measurements, state.notes, state.rectangles, state.selectedIds, toolColors.cloud, toolColors.draw, state.shapes, viewport]);

  const singleSelectedId =
    state.selectedIds.length === 1 ? state.selectedIds[0] : null;
  const showEditHandles = state.tool === "select" && state.selectedIds.length === 1;

  const onEndpointPointerDown = (
    id: string,
    endpoint: "start" | "end",
    event: React.PointerEvent,
  ) => {
    if (state.measurements.find((m) => m.id === id)?.locked) return;
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "endpoint", id, endpoint };
  };

  /** Adds an arrow tip to a callout at `at` and returns its index in the points. */
  const addArrowTip = (callout: ShapeAnnotationType, at: Point2D) => {
    dispatch({ type: "RECORD_UNDO" });
    dispatch({ type: "UPDATE_SHAPE", id: callout.id, updates: { points: [...callout.points, at] } });
    return callout.points.length;
  };

  /** What the right-click menu offers for markup `id`, given the selection it opens with and where it was clicked. */
  const contextMenuItems = (id: string, selection: string[], docPoint: Point2D): ContextMenuItem[] => {
    const close = (run: () => void) => () => {
      setContextMenu(null);
      run();
    };
    const area = state.shapes.find((s) => s.id === id && s.kind === "area" && !s.locked);
    const filledIn = area && withoutNearestCutout(area, docPoint);
    const removeCutout: ContextMenuItem[] = filledIn
      ? [
          {
            label: "Remove cutout",
            run: close(() => {
              dispatch({ type: "RECORD_UNDO" });
              dispatch({ type: "UPDATE_SHAPE", id, updates: filledIn });
            }),
          },
        ]
      : [];
    const byId = new Map(
      [...state.measurements.filter((m) => !m.isCalibration), ...state.rectangles, ...state.notes, ...state.shapes].map(
        (a) => [a.id, a],
      ),
    );
    /** Lock everything in `ids` unless all of it already is; then offer Unlock. */
    const lockItem = (ids: string[]): ContextMenuItem => {
      const allLocked = ids.every((lockId) => byId.get(lockId)?.locked);
      return {
        label: allLocked ? "Unlock" : "Lock",
        run: close(() => dispatch({ type: "SET_LOCKED", ids, locked: !allLocked })),
      };
    };
    if (state.tool === "select" && selection.length >= 2 && selection.includes(id)) {
      const markups = selection.filter((selected) => byId.has(selected));
      return [
        ...removeCutout,
        {
          // A new Markups-panel group; it doesn't change what's selected or drawn.
          label: "Create group",
          run: close(() => {
            const name = nextGroupName(state.groups);
            dispatch({ type: "CREATE_GROUP", groupId: crypto.randomUUID(), memberIds: markups });
            showSaveStatus("success", `Created ${name} with ${markups.length} items`);
          }),
        },
        lockItem(markups),
      ];
    }
    if (!byId.has(id)) return [];
    const line = state.measurements.find((m) => m.id === id);
    const callout = state.shapes.find((s) => s.id === id && s.kind === "callout" && !s.locked);
    const docAtScreen = toScreenPoint(viewport, docPoint.x, docPoint.y);
    // The last arrow stays: a callout without one is just a note.
    const arrowIndex =
      callout && callout.points.length > 2 ? calloutTipIndexAt(callout, docAtScreen, viewport) : -1;
    return [
      ...removeCutout,
      ...(callout
        ? [
            {
              label: "Add arrow",
              run: close(() => {
                setPlacingArrow({ id, index: addArrowTip(callout, docPoint) });
                showSaveStatus("info", "Click where the arrow should point", "Esc cancels");
              }),
            },
          ]
        : []),
      ...(callout && arrowIndex >= 0
        ? [
            {
              label: "Remove arrow",
              run: close(() => {
                const [first, anchor, ...more] = callout.points;
                const tips = [first, ...more].filter((_, i) => (arrowIndex === 0 ? i !== 0 : i !== arrowIndex - 1));
                dispatch({ type: "RECORD_UNDO" });
                dispatch({
                  type: "UPDATE_SHAPE",
                  id,
                  updates: { points: [tips[0], anchor, ...tips.slice(1)] },
                });
              }),
            },
          ]
        : []),
      ...(line?.plain
        ? [
            {
              label: line.midpointTick ? "Remove midpoint" : "Add midpoint",
              run: close(() => toggleMidpointTick(line)),
            },
          ]
        : []),
      lockItem([id]),
    ];
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    setContextMenu(null);
    if (state.tool !== "select" && state.tool !== "measure" && state.tool !== "area") return;
    if (state.tool === "area" && state.drawingShapeId) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const local = getLocalCoords(overlay, event.clientX, event.clientY);
    const docPoint = toDocPoint(viewport, local.x, local.y);
    const lines = state.measurements.filter((m) => !m.isCalibration);
    const areas = state.shapes.filter((s) => s.kind === "area");
    // The Line and Area tools' menus are for their own markups; Select offers it for anything.
    const hitId =
      state.tool === "select"
        ? hitTestAnnotations(
            local,
            lines,
            state.rectangles,
            state.notes,
            state.shapes,
            viewport,
            state.scale,
            state.displayUnit,
          )
        : hitTestAnnotations(
            local,
            state.tool === "measure" ? lines : [],
            [],
            [],
            state.tool === "area" ? areas : [],
            viewport,
            state.scale,
            state.displayUnit,
          );
    // Hit testing sees through a cutout, but right-clicking inside one is how you reach it.
    const holedArea =
      !hitId && state.tool !== "measure"
        ? areas.findLast((s) => cutoutCount(s) > 0 && pointInPolygon(docPoint, areaOutline(s)))?.id
        : undefined;
    const targetId = hitId ?? holedArea;
    if (!targetId) return;
    let selection = state.selectedIds;
    // Right-clicking outside the selection selects what was clicked first.
    if (state.tool === "select" && !selection.includes(targetId)) {
      selection = [targetId];
      dispatch({ type: "SET_SELECTION", ids: [targetId] });
    }
    if (contextMenuItems(targetId, selection, docPoint).length === 0) return;
    event.preventDefault();
    setContextMenu({ id: targetId, clientX: event.clientX, clientY: event.clientY, docPoint });
  };

  /** Show or hide the tick marking the line's centre. */
  const toggleMidpointTick = (line: Measurement) => {
    dispatch({ type: "RECORD_UNDO" });
    dispatch({
      type: "UPDATE_MEASUREMENT",
      id: line.id,
      updates: { midpointTick: line.midpointTick ? undefined : true },
    });
  };

  const renderContextMenu = (menu: ContextMenu) => {
    const items = contextMenuItems(menu.id, state.selectedIds, menu.docPoint);
    if (items.length === 0) return null;
    return (
      <FloatingMenu x={menu.clientX + 4} y={menu.clientY + 4} menuRef={contextMenuRef}>
        {items.map((menuItem) => (
          <button
            key={menuItem.label}
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-muted"
            onClick={menuItem.run}
          >
            {menuItem.label}
          </button>
        ))}
      </FloatingMenu>
    );
  };

  const onBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const measurement = state.measurements.find((m) => m.id === id);
    if (!measurement || measurement.locked) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    // The undo step is saved on the first move, so a plain click to select adds none.
    moveUndoPendingRef.current = true;

    const local = getLocalCoords(overlay, event.clientX, event.clientY);
    const originPdf = toDocPoint(viewport, local.x, local.y);

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "body",
      id,
      originPdf,
      startPdf: { ...measurement.start },
      endPdf: { ...measurement.end },
    };
  };

  const onRectBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle || rectangle.locked) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    // The undo step is saved on the first move, so a plain click to select adds none.
    moveUndoPendingRef.current = true;

    const local = getLocalCoords(overlay, event.clientX, event.clientY);
    const originPdf = toDocPoint(viewport, local.x, local.y);

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "rectBody",
      id,
      originPdf,
      topLeft: { ...rectangle.topLeft },
      bottomRight: { ...rectangle.bottomRight },
    };
  };

  const onRectCornerPointerDown = (
    id: string,
    corner: RectCorner,
    event: React.PointerEvent,
  ) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle || rectangle.locked) return;

    const screenRect = toScreenRect(
      viewport,
      rectangle.topLeft,
      rectangle.bottomRight,
    );
    const fixedCornerScreen = getScreenCornerPoint(
      getOppositeScreenCorner(corner),
      screenRect,
    );

    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "rectCorner",
      id,
      fixedCornerScreen,
      rotation: rectangle.rotation ?? 0,
      centre: { x: screenRect.x + screenRect.width / 2, y: screenRect.y + screenRect.height / 2 },
    };
  };

  const onRectEdgePointerDown = (id: string, edge: RectEdge, event: React.PointerEvent) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle || rectangle.locked) return;
    const r = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
    const left = Math.min(r.x, r.x + r.width);
    const right = Math.max(r.x, r.x + r.width);
    const top = Math.min(r.y, r.y + r.height);
    const bottom = Math.max(r.y, r.y + r.height);
    // The moving corner slides along the dragged edge; the opposite corner stays put.
    const vertical = edge === "top" || edge === "bottom";
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "rectEdge",
      id,
      fixedCornerScreen: vertical
        ? { x: right, y: edge === "top" ? bottom : top }
        : { x: edge === "left" ? right : left, y: bottom },
      axis: vertical ? "y" : "x",
      along: vertical ? left : top,
      rotation: rectangle.rotation ?? 0,
      centre: { x: (left + right) / 2, y: (top + bottom) / 2 },
    };
  };

  const onShapePointPointerDown = (id: string, index: number, event: React.PointerEvent) => {
    event.stopPropagation();
    if (state.shapes.find((s) => s.id === id)?.locked) return;
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "shapePoint", id, index };
  };

  const onNoteBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note || note.locked) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    // The undo step is saved on the first move, so a plain click to select adds none.
    moveUndoPendingRef.current = true;

    const local = getLocalCoords(overlay, event.clientX, event.clientY);
    const originPdf = toDocPoint(viewport, local.x, local.y);

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "noteBody",
      id,
      originPdf,
      startPdf: { ...note.position },
    };
  };

  const handleUpdateNoteText = (id: string, text: string) => {
    dispatch({ type: "UPDATE_NOTE", id, updates: { text } });
  };

  const handleStartEditNote = (id: string) => {
    dispatch({ type: "SET_EDITING_NOTE", id });
  };

  const handleEndEditNote = () => {
    dispatch({ type: "SET_EDITING_NOTE", id: null });
  };

  const renderMeasurement = (measurement: (typeof state.measurements)[0]) => (
    <MeasurementLine
      key={measurement.id}
      measurement={measurement}
      viewport={viewport}
      scale={measurement.plain ? null : state.scale}
      displayUnit={state.displayUnit}
      isSelected={state.selectedIds.includes(measurement.id)}
      isSelectMode={state.tool === "select"}
      showHandles={
        showEditHandles &&
        singleSelectedId === measurement.id &&
        !measurement.isCalibration
      }
      isEditingLength={
        state.editingDimension?.target === "line" &&
        state.editingDimension.id === measurement.id &&
        state.editingDimension.field === "length"
      }
      onSelect={(id, additive) => handleSelect(id, additive)}
      onEndpointPointerDown={onEndpointPointerDown}
      onBodyPointerDown={onBodyPointerDown}
      onStartEditLength={handleStartEditLength}
      onCommitLength={handleCommitLength}
      onCancelEdit={() => dispatch({ type: "CLEAR_EDITING_DIMENSION" })}
    />
  );

  const renderRectangle = (rectangle: (typeof state.rectangles)[0]) => (
    <RectangleAnnotation
      key={rectangle.id}
      rectangle={rectangle}
      viewport={viewport}
      scale={rectangle.plain ? null : state.scale}
      displayUnit={state.displayUnit}
      isSelected={state.selectedIds.includes(rectangle.id)}
      isSelectMode={state.tool === "select"}
      showHandles={showEditHandles && singleSelectedId === rectangle.id}
      editingField={
        state.editingDimension?.target === "rectangle" &&
        state.editingDimension.id === rectangle.id
          ? state.editingDimension.field === "width"
            ? "width"
            : state.editingDimension.field === "height"
              ? "height"
              : null
          : null
      }
      onSelect={(id, additive) => handleSelect(id, additive)}
      onBodyPointerDown={onRectBodyPointerDown}
      onCornerPointerDown={onRectCornerPointerDown}
      onEdgeHandlePointerDown={onRectEdgePointerDown}
      onStartEditWidth={handleStartEditWidth}
      onStartEditHeight={handleStartEditHeight}
      onCommitWidth={handleCommitWidth}
      onCommitHeight={handleCommitHeight}
      onCancelEdit={() => dispatch({ type: "CLEAR_EDITING_DIMENSION" })}
    />
  );

  const renderNote = (note: (typeof state.notes)[0]) => (
    <NoteAnnotation
      key={note.id}
      note={note}
      viewport={viewport}
      isSelected={state.selectedIds.includes(note.id)}
      isSelectMode={state.tool === "select"}
      showHandles={showEditHandles && singleSelectedId === note.id}
      isEditing={state.editingNoteId === note.id}
      onSelect={(id, additive) => handleSelect(id, additive)}
      onUpdateText={handleUpdateNoteText}
      onStartEdit={handleStartEditNote}
      onEndEdit={handleEndEditNote}
      onBodyPointerDown={onNoteBodyPointerDown}
    />
  );

  const renderShape = (shape: ShapeAnnotationType) => (
    <ShapeAnnotation
      key={shape.id}
      shape={shape}
      viewport={viewport}
      scale={state.scale}
      displayUnit={state.displayUnit}
      isSelected={state.selectedIds.includes(shape.id)}
      isDrawing={state.drawingShapeId === shape.id}
      cursorDoc={state.drawingShapeId === shape.id ? previewEnd : null}
      hidden={state.editingNoteId === shape.id}
    />
  );

  // Callout text reuses the note card so editing and styling match notes exactly.
  const renderCalloutCard = (shape: ShapeAnnotationType) =>
    shape.points.length >= 2 ? (
      <NoteAnnotation
        key={`${shape.id}-card`}
        note={{
          id: shape.id,
          position: shape.points[1],
          text: shape.text ?? "",
          width: shape.width,
          color: shape.color,
          locked: shape.locked,
        }}
        placeholder="Callout"
        viewport={viewport}
        isSelected={state.selectedIds.includes(shape.id)}
        isSelectMode={state.tool === "select"}
        showHandles={showEditHandles && singleSelectedId === shape.id}
        isEditing={state.editingNoteId === shape.id}
        onSelect={(id, additive) => handleSelect(id, additive)}
        onUpdateText={(id, text) => dispatch({ type: "UPDATE_SHAPE", id, updates: { text } })}
        onStartEdit={handleStartEditNote}
        onEndEdit={handleEndEditNote}
        onBodyPointerDown={(_id, event) => {
          const overlay = overlayRef.current;
          if (!overlay) return;
          const local = getLocalCoords(overlay, event.clientX, event.clientY);
          // Dragging the card leaves the arrows pointing at what they mark.
          startShapeDrag(shape, toDocPoint(viewport, local.x, local.y), event, 1);
        }}
      />
    ) : null;

  const editingText = state.shapes.find(
    (s) => s.kind === "text" && s.id === state.editingNoteId,
  );

  const endTextEdit = (shape: ShapeAnnotationType, text: string) => {
    dispatch({ type: "SET_EDITING_NOTE", id: null });
    // Like a text box in a PDF editor: leaving it empty removes it.
    if (!text.trim()) dispatch({ type: "DELETE_SHAPE", id: shape.id });
  };

  const renderTextEditor = (shape: ShapeAnnotationType) => {
    const box = textScreenBox(shape, viewport);
    const px = (shape.fontSize ?? TEXT_DEFAULT_SIZE) * viewportZoom(viewport);
    return (
      <foreignObject
        key={`${shape.id}-editor`}
        x={box.x - 2}
        y={box.y - 2}
        transform={`rotate(${shape.rotation ?? 0} ${box.x} ${box.y})`}
        width={Math.max(box.width + px * 4, 120)}
        height={box.height + px * 2}
        style={{ overflow: "visible" }}
      >
        <textarea
          autoFocus
          defaultValue={shape.text ?? ""}
          placeholder="Text"
          rows={1}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) =>
            dispatch({ type: "UPDATE_SHAPE", id: shape.id, updates: { text: event.target.value } })
          }
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          onBlur={(event) => endTextEdit(shape, event.target.value)}
          style={{
            font: textFont(px, shape.bold, shape.italic),
            lineHeight: TEXT_LINE_HEIGHT,
            color: getAnnotationColor(shape),
            background: "rgba(255, 255, 255, 0.85)",
            border: `1px dashed ${SELECTION_ACCENT}`,
            padding: 1,
            margin: 0,
            outline: "none",
            resize: "none",
            overflow: "hidden",
            whiteSpace: "pre",
            fieldSizing: "content",
            minWidth: px * 2,
          } as React.CSSProperties}
        />
      </foreignObject>
    );
  };

  // Resize/rotate handles for the one selected markup that supports them.
  const transformTarget: Transformable | null = (() => {
    if (!showEditHandles || !singleSelectedId || state.editingNoteId) return null;
    // Locked markups get no resize or rotate handles.
    const shape = state.shapes.find((s) => s.id === singleSelectedId);
    if (shape) return shape.locked ? null : { kind: "shape", item: shape };
    const note = state.notes.find((n) => n.id === singleSelectedId);
    if (note) return note.locked ? null : { kind: "note", item: note };
    const rectangle = state.rectangles.find((r) => r.id === singleSelectedId);
    return rectangle && !rectangle.locked ? { kind: "rect", item: rectangle } : null;
  })();
  const transformFrame = transformTarget ? getTransformFrame(transformTarget, viewport) : null;

  const startTransformDrag = (
    event: React.PointerEvent,
    mode: { type: "rotate" } | { type: "scale"; corner: number },
  ) => {
    const overlay = overlayRef.current;
    if (!overlay || !transformTarget || !transformFrame) return;
    event.stopPropagation();
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    const local = getLocalCoords(overlay, event.clientX, event.clientY);
    const { centre } = transformFrame;
    dragRef.current =
      mode.type === "rotate"
        ? {
            type: "rotate",
            target: transformTarget,
            frame: transformFrame,
            startAngle: (Math.atan2(local.y - centre.y, local.x - centre.x) * 180) / Math.PI,
          }
        : { type: "scale", target: transformTarget, frame: transformFrame, corner: mode.corner };
  };

  // Text, notes and snapshots already outline themselves when selected; one outline is enough.
  const showFrameOutline =
    transformTarget?.kind === "shape" &&
    (transformTarget.item.kind === "cloud" ||
      transformTarget.item.kind === "area" ||
      transformTarget.item.kind === "polyline" ||
      transformTarget.item.kind === "draw");

  /** Grip left of selected text, so it can be moved without hitting a corner handle. */
  const renderTextMoveTab = (shape: ShapeAnnotationType, frame: TransformFrame) => {
    const [tl, , , bl] = frame.corners;
    const leftMid = { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 };
    const out = { x: leftMid.x - frame.centre.x, y: leftMid.y - frame.centre.y };
    const len = Math.hypot(out.x, out.y) || 1;
    const c = {
      x: leftMid.x + (out.x / len) * TEXT_MOVE_TAB_OFFSET_PX,
      y: leftMid.y + (out.y / len) * TEXT_MOVE_TAB_OFFSET_PX,
    };
    return (
      <g
        transform={`rotate(${frame.angle} ${c.x} ${c.y})`}
        style={{ cursor: "move", pointerEvents: "all" }}
        onPointerDown={(event) => {
          const overlay = overlayRef.current;
          if (!overlay || event.button !== 0) return;
          event.stopPropagation();
          const local = getLocalCoords(overlay, event.clientX, event.clientY);
          startShapeDrag(shape, toDocPoint(viewport, local.x, local.y), event);
        }}
      >
        <title>Drag to move</title>
        <rect x={c.x - 6} y={c.y - 10} width={12} height={20} rx={3} fill={SELECTION_ACCENT} />
        {[-5, 0, 5].map((dy) =>
          [-2, 2].map((dx) => (
            <circle key={`${dx},${dy}`} cx={c.x + dx} cy={c.y + dy} r={1.1} fill="#ffffff" pointerEvents="none" />
          )),
        )}
      </g>
    );
  };

  const renderTransformHandles = (frame: TransformFrame) => {
    const [tl, tr] = frame.corners;
    const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const out = { x: topMid.x - frame.centre.x, y: topMid.y - frame.centre.y };
    const len = Math.hypot(out.x, out.y) || 1;
    const knob = { x: topMid.x + (out.x / len) * 26, y: topMid.y + (out.y / len) * 26 };
    const movableText =
      transformTarget?.kind === "shape" && transformTarget.item.kind === "text"
        ? transformTarget.item
        : null;
    // A callout's card stays upright, so its arrows can leave from any side of it.
    const rotatable = !(transformTarget?.kind === "shape" && transformTarget.item.kind === "callout");
    return (
      <g key="transform-handles">
        {showFrameOutline && (
          <polygon
            points={frame.corners.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={SELECTION_ACCENT}
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        {rotatable && (
          <>
            <line x1={topMid.x} y1={topMid.y} x2={knob.x} y2={knob.y} stroke={SELECTION_ACCENT} strokeWidth={1.5} pointerEvents="none" />
            <circle
              cx={knob.x}
              cy={knob.y}
              r={6}
              fill="#ffffff"
              stroke={SELECTION_ACCENT}
              strokeWidth={2}
              style={{ cursor: "grab", pointerEvents: "all" }}
              onPointerDown={(event) => startTransformDrag(event, { type: "rotate" })}
            >
              <title>Rotate (Shift snaps to 15°)</title>
            </circle>
          </>
        )}
        {frame.scalable &&
          frame.corners.map((p, i) => (
            <rect
              key={i}
              x={p.x - 5}
              y={p.y - 5}
              width={10}
              height={10}
              fill="#ffffff"
              stroke={SELECTION_ACCENT}
              strokeWidth={2}
              transform={`rotate(${frame.angle} ${p.x} ${p.y})`}
              style={{ cursor: i % 2 === 0 ? "nwse-resize" : "nesw-resize", pointerEvents: "all" }}
              onPointerDown={(event) => startTransformDrag(event, { type: "scale", corner: i })}
            />
          ))}
        {movableText && renderTextMoveTab(movableText, frame)}
      </g>
    );
  };

  const selectedSet = new Set(state.selectedIds);
  const callouts = state.shapes.filter((s) => s.kind === "callout");
  const visibleMeasurements = state.settings.showCalibrationLine
    ? state.measurements
    : state.measurements.filter((m) => !m.isCalibration);
  const unselectedMeasurements = visibleMeasurements.filter((m) => !selectedSet.has(m.id));
  const selectedMeasurements = visibleMeasurements.filter((m) => selectedSet.has(m.id));
  const unselectedRectangles = state.rectangles.filter((r) => !selectedSet.has(r.id));
  const selectedRectangles = state.rectangles.filter((r) => selectedSet.has(r.id));
  const unselectedNotes = state.notes.filter((n) => !selectedSet.has(n.id));
  const selectedNotes = state.notes.filter((n) => selectedSet.has(n.id));

  // A locked markup's lengths can't be retyped either.
  const handleStartEditLength = (id: string) => {
    if (state.measurements.find((m) => m.id === id)?.locked) return;
    dispatch({
      type: "SET_EDITING_DIMENSION",
      editing: { target: "line", id, field: "length" },
    });
  };

  const handleStartEditWidth = (id: string) => {
    if (state.rectangles.find((r) => r.id === id)?.locked) return;
    dispatch({
      type: "SET_EDITING_DIMENSION",
      editing: { target: "rectangle", id, field: "width" },
    });
  };

  const handleStartEditHeight = (id: string) => {
    if (state.rectangles.find((r) => r.id === id)?.locked) return;
    dispatch({
      type: "SET_EDITING_DIMENSION",
      editing: { target: "rectangle", id, field: "height" },
    });
  };

  const handleCommitLength = (id: string, value: number) => {
    const measurement = state.measurements.find((m) => m.id === id);
    if (!measurement || !state.scale) return;

    dispatch({ type: "RECORD_UNDO" });
    dispatch({
      type: "UPDATE_MEASUREMENT",
      id,
      updates: applyLineLength(measurement, value, state.scale, state.displayUnit),
    });
    dispatch({ type: "CLEAR_EDITING_DIMENSION" });
  };

  const handleCommitWidth = (id: string, value: number) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle || !state.scale) return;

    dispatch({ type: "RECORD_UNDO" });
    dispatch({
      type: "UPDATE_RECTANGLE",
      id,
      updates: applyRectHorizontalEdgeLength(
        rectangle,
        value,
        state.scale,
        state.displayUnit,
        state.rotation,
      ),
    });
    dispatch({ type: "CLEAR_EDITING_DIMENSION" });
  };

  const handleCommitHeight = (id: string, value: number) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle || !state.scale) return;

    dispatch({ type: "RECORD_UNDO" });
    dispatch({
      type: "UPDATE_RECTANGLE",
      id,
      updates: applyRectVerticalEdgeLength(
        rectangle,
        value,
        state.scale,
        state.displayUnit,
        state.rotation,
      ),
    });
    dispatch({ type: "CLEAR_EDITING_DIMENSION" });
  };

  const previewStart = state.pendingPoint
    ? toScreenPoint(viewport, state.pendingPoint.x, state.pendingPoint.y)
    : null;
  // A typed length pins the line preview's end along the cursor's direction.
  const typedEnd =
    typedLength && state.pendingPoint ? typedLineEnd(state.pendingPoint, previewEnd, typedLength) : null;
  const lineEnd = state.tool === "measure" && typedEnd ? typedEnd : previewEnd;
  const previewEndScreen = lineEnd ? toScreenPoint(viewport, lineEnd.x, lineEnd.y) : null;

  const rectPreview =
    (state.tool === "rectangle" || state.tool === "snapshot") && state.pendingPoint && previewEnd
      ? toScreenRect(viewport, state.pendingPoint, previewEnd)
      : null;

  const cloudPreview =
    state.tool === "cloud" && state.pendingPoint && previewEnd
      ? cloudPath(
          boxCorners(state.pendingPoint, previewEnd).map((p) => toScreenPoint(viewport, p.x, p.y)),
          14,
        )
      : null;

  const freehandPreview =
    freehandStroke && freehandStroke.length > 1 && state.tool === "cloud"
      ? freehandStroke.map((p) => `${p.x},${p.y}`).join(" ")
      : null;
  const drawPreview =
    freehandStroke && freehandStroke.length > 1 && state.tool === "draw"
      ? strokePath(freehandStroke)
      : null;

  const marqueePreview = state.pendingMarquee
    ? screenRectFromPoints(state.pendingMarquee.start, state.pendingMarquee.current)
    : null;

  return (
    <svg
      width={viewport.width}
      height={viewport.height}
      className="absolute inset-0 touch-none select-none"
      style={{
        cursor: erasing
          ? "none"
          : placingArrow
            ? "crosshair"
          : state.tool === "select" && selectCursor
            ? selectCursor
            : state.tool === "pan"
            ? "grab"
            : state.tool === "text"
              ? TEXT_TOOL_CURSOR
              : state.tool === "note"
                ? "text"
                : "crosshair",
      }}
      onPointerDownCapture={handlePointerDownCapture}
      onContextMenu={handleContextMenu}
      onDoubleClick={(event) => {
        if (state.tool !== "select") return;
        const overlay = overlayRef.current;
        if (!overlay) return;
        const local = getLocalCoords(overlay, event.clientX, event.clientY);
        const hitId = hitTestAnnotations(
          local,
          [],
          [],
          [],
          state.shapes.filter((s) => s.kind === "text"),
          viewport,
          state.scale,
          state.displayUnit,
        );
        if (!hitId) return;
        dispatch({ type: "SET_SELECTION", ids: [hitId] });
        dispatch({ type: "SET_EDITING_NOTE", id: hitId });
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        // A cancelled stroke is dropped rather than saved as a stub.
        if (dragRef.current?.type === "freehand") {
          dragRef.current = null;
          setFreehandStroke(null);
          return;
        }
        handlePointerUp();
      }}
      onDragStart={(event) => event.preventDefault()}
      onPointerLeave={() => {
        handlePointerUp();
        onCursorMove?.(null);
        setEraserAt(null);
        setSelectCursor(null);
      }}
    >
      <g id={ANNOTATION_ROOT_ID}>
        {/* Snapshots sit under every other markup, like the drawing they came from. */}
        {state.shapes.filter((s) => s.kind === "image").map(renderShape)}
        {state.shapes.filter((s) => s.kind !== "image" && !selectedSet.has(s.id)).map(renderShape)}
        {state.shapes.filter((s) => s.kind !== "image" && selectedSet.has(s.id)).map(renderShape)}
        {unselectedRectangles.map(renderRectangle)}
        {unselectedNotes.map(renderNote)}
        {unselectedMeasurements.map(renderMeasurement)}
        {selectedRectangles.map(renderRectangle)}
        {selectedNotes.map(renderNote)}
        {selectedMeasurements.map(renderMeasurement)}
        {callouts.map(renderCalloutCard)}
        {editingText && renderTextEditor(editingText)}
        {transformFrame && renderTransformHandles(transformFrame)}
        {contextMenu &&
          (state.tool === "select" || state.tool === "measure" || state.tool === "area") &&
          renderContextMenu(contextMenu)}
        {callouts
          .filter((c) => showEditHandles && singleSelectedId === c.id && c.points.length >= 2 && !c.locked)
          .map((c) => {
            const card = calloutCardBox(c, viewport);
            const add = { x: card.x + card.width / 2, y: card.y + card.height + CALLOUT_ADD_HANDLE_OFFSET_PX };
            return (
              <g key={`${c.id}-arrow-handles`}>
                {c.points.map((p, i) => {
                  // Index 1 is the card's anchor, not an arrow.
                  if (i === 1) return null;
                  const tip = toScreenPoint(viewport, p.x, p.y);
                  return (
                    <circle
                      key={i}
                      cx={tip.x}
                      cy={tip.y}
                      r={6}
                      fill="#0f172a"
                      stroke={c.color ?? REDLINE_COLOR}
                      strokeWidth={2}
                      style={{ cursor: "crosshair", pointerEvents: "all" }}
                      onPointerDown={(event) => onShapePointPointerDown(c.id, i, event)}
                    />
                  );
                })}
                {!state.editingNoteId && (
                  <g
                    style={{ cursor: "copy", pointerEvents: "all" }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      dragRef.current = {
                        type: "shapePoint",
                        id: c.id,
                        index: addArrowTip(c, toDocPoint(viewport, add.x, add.y + CALLOUT_NEW_ARROW_PX)),
                      };
                    }}
                  >
                    <title>Drag to add an arrow</title>
                    <circle cx={add.x} cy={add.y} r={8} fill={SELECTION_ACCENT} stroke="#ffffff" strokeWidth={1.5} />
                    <path
                      d={`M${add.x - 4} ${add.y}h8M${add.x} ${add.y - 4}v8`}
                      stroke="#ffffff"
                      strokeWidth={2}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  </g>
                )}
              </g>
            );
          })}
        {marqueePreview && (
          <rect
            x={marqueePreview.x}
            y={marqueePreview.y}
            width={marqueePreview.width}
            height={marqueePreview.height}
            fill="rgba(255, 92, 0, 0.08)"
            stroke="#ff5c00"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {previewStart &&
          previewEndScreen &&
          state.tool === "measure" &&
          state.lineMode === "measure" &&
          state.scale &&
          state.pendingPoint &&
          lineEnd && (
            <PreviewDimensionLine
              start={previewStart}
              end={previewEndScreen}
              label={formatDistance(
                convertUnits(
                  docDistance(state.pendingPoint, lineEnd) *
                    state.scale.unitsPerPdfPoint,
                  state.scale.calibrationUnit,
                  state.displayUnit,
                ),
                state.displayUnit,
              )}
            />
          )}
        {previewStart &&
          previewEndScreen &&
          (state.tool === "calibrate" ||
            (state.tool === "measure" && (!state.scale || state.lineMode === "plain"))) && (
            <line
              x1={previewStart.x}
              y1={previewStart.y}
              x2={previewEndScreen.x}
              y2={previewEndScreen.y}
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}
        {drawPreview && (
          <path
            d={drawPreview}
            fill="none"
            stroke={toolColors.draw}
            strokeWidth={newDrawWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
        {erasing && eraserAt && (
          <g pointerEvents="none">
            <circle cx={eraserAt.x} cy={eraserAt.y} r={eraserRadius} fill="rgba(255,255,255,0.35)" stroke="#ffffff" strokeWidth={3} />
            <circle cx={eraserAt.x} cy={eraserAt.y} r={eraserRadius} fill="none" stroke="#475569" strokeWidth={1.5} />
          </g>
        )}
        {typedLength && previewEndScreen && (
          <foreignObject
            x={previewEndScreen.x + 12}
            y={previewEndScreen.y + 12}
            width={1}
            height={1}
            style={{ overflow: "visible" }}
            pointerEvents="none"
          >
            <div
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-surface px-2 py-1 font-mono text-xs shadow-md ${
                typedEnd ? "border-accent text-text-primary" : "border-border text-text-muted"
              }`}
            >
              {typedLength}
              <span className="font-sans text-[10px] text-text-muted">
                {typedEnd ? "Enter to place" : state.scale ? "not a length" : "set the scale first"}
              </span>
            </div>
          </foreignObject>
        )}
        {freehandPreview && (
          <polyline
            points={freehandPreview}
            fill="none"
            stroke={toolColors.cloud}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {cloudPreview && (
          <path
            d={cloudPreview}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {previewStart && previewEndScreen && state.tool === "callout" && (
          <line
            x1={previewStart.x}
            y1={previewStart.y}
            x2={previewEndScreen.x}
            y2={previewEndScreen.y}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {rectPreview && (
          <rect
            x={rectPreview.x}
            y={rectPreview.y}
            width={rectPreview.width}
            height={rectPreview.height}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}
