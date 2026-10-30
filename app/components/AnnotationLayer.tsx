"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  Point2D,
  RectMeasurement,
  ShapeAnnotation as ShapeAnnotationType,
} from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import {
  computeDocOffsetFromScreen,
  defaultScreenLabelOffsetDoc,
  docRectFromScreenCorners,
  getLocalCoords,
  getOppositeScreenCorner,
  getScreenCornerPoint,
  getLineLabelAnchorDoc,
  getRectHeightLabelAnchorDoc,
  getRectWidthLabelAnchorDoc,
  midpoint,
  snapScreenPointToAxis,
  toDocPoint,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import {
  findAnnotationsInMarquee,
  hitTestAnnotations,
  screenRectFromPoints,
} from "@/app/utils/selection";
import {
  applyLineLength,
  applyRectHorizontalEdgeLength,
  applyRectVerticalEdgeLength,
  normalizeRect,
} from "@/app/utils/dimensions";
import {
  RectangleAnnotation,
  type RectCorner,
  type RectEdge,
} from "@/app/components/RectangleAnnotation";
import { MeasurementLine } from "@/app/components/MeasurementLine";
import { NoteAnnotation } from "@/app/components/NoteAnnotation";
import { ShapeAnnotation } from "@/app/components/ShapeAnnotation";
import {
  boxCorners,
  cloudPath,
  rotateAround,
  simplifyPath,
  smoothClosedPath,
} from "@/app/utils/geometry";
import { CLOSE_AREA_PX } from "@/app/utils/shapeMetrics";
import { PreviewDimensionLine } from "@/app/components/InlineDimensionLine";
import { convertUnits, formatDistance } from "@/app/utils/units";
import { docDistance } from "@/app/utils/coordinates";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { ANNOTATION_ROOT_ID } from "@/app/utils/viewerBridge";
import { copySelection } from "@/app/utils/clipboard";
import { showSaveStatus } from "@/app/utils/saveStatus";
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
  TEXT_DEFAULT_SIZE,
  TEXT_LINE_HEIGHT,
  textFont,
  textScreenBox,
} from "@/app/utils/noteLayout";
import { getAnnotationColor, SELECTION_ACCENT } from "@/app/utils/colors";

interface AnnotationLayerProps {
  viewport: DocumentViewport;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onCursorMove?: (cursor: Point2D | null) => void;
}

type DragMode =
  | { type: "endpoint"; id: string; endpoint: "start" | "end" }
  | { type: "body"; id: string; originPdf: Point2D; startPdf: Point2D; endPdf: Point2D }
  | { type: "label"; id: string }
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
  | { type: "rectWidthLabel"; id: string }
  | { type: "marquee"; startScreen: Point2D; currentScreen: Point2D; additive: boolean }
  | { type: "rectHeightLabel"; id: string }
  | { type: "noteBody"; id: string; originPdf: Point2D; startPdf: Point2D }
  | { type: "shapeBody"; id: string; originPdf: Point2D; points: Point2D[] }
  | { type: "freehand"; points: Point2D[] }
  /** Moves the whole selection; a press without movement selects just `id`. */
  | { type: "group"; id: string; lastPdf: Point2D; moved: boolean };

const MIN_RECT_SIZE = 5;
const MIN_MARQUEE_SIZE = 4;
/** Freehand clouds: sample spacing, jitter tolerance and minimum size, in screen px. */
const FREEHAND_STEP_PX = 3;
const FREEHAND_SIMPLIFY_PX = 4;
const MIN_FREEHAND_SIZE = 12;

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
  const [previewEnd, setPreviewEnd] = useState<Point2D | null>(null);
  /** Screen points of the freehand cloud being drawn. */
  const [freehandStroke, setFreehandStroke] = useState<Point2D[] | null>(null);
  const dragRef = useRef<DragMode | null>(null);

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
    (shape: ShapeAnnotationType, originPdf: Point2D, event: React.PointerEvent) => {
      dispatch({ type: "RECORD_UNDO" });
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        type: "shapeBody",
        id: shape.id,
        originPdf,
        points: shape.points.map((p) => ({ ...p })),
      };
    },
    [dispatch],
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
    [state.fileBytes, state.fileMimeType, state.fileName, state.fileType, state.scale, state.zoom, viewport],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (state.tool === "pan") return;
      // A click outside a note/text being typed only finishes it (its blur saves it).
      if (state.editingNoteId) return;

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
          if (shape && !additive) startShapeDrag(shape, pdfPoint, event);
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
        dispatch({
          type: "ADD_SHAPE",
          shape: {
            id: createId(),
            kind: "text",
            points: [pdfPoint],
            text: "",
            // Same on-screen size at any zoom when placed; it then scales with the drawing.
            fontSize: TEXT_DEFAULT_SIZE / (viewportZoom(viewport) || 1),
            color: toolColors.text,
          },
        });
        return;
      }

      if (state.tool === "area" || state.tool === "count") {
        const drawing = state.shapes.find(
          (s) => s.id === state.drawingShapeId && s.kind === state.tool,
        );
        if (!drawing) {
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
          if (closesOnFirst || event.detail >= 2) {
            dispatch({ type: "FINISH_SHAPE" });
            setPreviewEnd(null);
            return;
          }
        }
        dispatch({ type: "APPEND_SHAPE_POINT", id: drawing.id, point: pdfPoint });
        return;
      }

      if (state.tool === "cloud" && state.cloudMode === "freehand") {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { type: "freehand", points: [local] };
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
            const rectangle = {
              id: createId(),
              ...normalized,
              widthLabelOffset: { x: 0, y: 0 },
              heightLabelOffset: { x: 0, y: 0 },
              color: toolColors.rectangle,
              ...(plainRect ? { plain: true } : {}),
            };
            const widthAnchorDoc = getRectWidthLabelAnchorDoc(
              rectangle,
              state.fileType ?? "image",
            );
            const heightAnchorDoc = getRectHeightLabelAnchorDoc(rectangle);
            dispatch({
              type: "ADD_RECTANGLE",
              rectangle: {
                ...rectangle,
                widthLabelOffset: defaultScreenLabelOffsetDoc(viewport, widthAnchorDoc, {
                  x: 0,
                  y: -16,
                }),
                heightLabelOffset: defaultScreenLabelOffsetDoc(viewport, heightAnchorDoc, {
                  x: -16,
                  y: 0,
                }),
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
            const anchorDoc = midpoint(start, end);
            dispatch({
              type: "ADD_MEASUREMENT",
              measurement: {
                id: createId(),
                start,
                end,
                labelOffset: defaultScreenLabelOffsetDoc(viewport, anchorDoc),
                color: toolColors.measure,
                ...(state.lineMode === "plain" ? { plain: true } : {}),
              },
            });
          } else {
            dispatch({ type: "SET_PENDING_POINT", point: null });
            setPreviewEnd(null);
          }
        }
      }
    },
    [
      dispatch,
      handleSelect,
      overlayRef,
      startShapeDrag,
      snapToLine,
      takeSnapshot,
      state.displayUnit,
      state.editingNoteId,
      state.fileType,
      state.measurements,
      state.notes,
      state.pendingPoint,
      state.rectangles,
      state.scale,
      state.shapes,
      state.drawingShapeId,
      state.cloudMode,
      state.countStart,
      state.lineMode,
      state.rectMode,
      toolColors,
      state.tool,
      viewport,
    ],
  );

  /** A screen point in a rectangle's own (unturned) frame. */
  const unturnRectPoint = useCallback(
    (rectangle: RectMeasurement, p: Point2D): Point2D => {
      if (!rectangle.rotation) return p;
      const r = toScreenRect(viewport, rectangle.topLeft, rectangle.bottomRight);
      return rotateAround(p, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, -rectangle.rotation);
    },
    [viewport],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      onCursorMove?.(local);

      if (dragRef.current) {
        const drag = dragRef.current;

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
        } else if (drag.type === "label") {
          const measurement = state.measurements.find((m) => m.id === drag.id);
          if (!measurement) return;
          const anchorDoc = getLineLabelAnchorDoc(measurement);
          dispatch({
            type: "UPDATE_MEASUREMENT",
            id: drag.id,
            updates: {
              labelOffset: computeDocOffsetFromScreen(viewport, anchorDoc, local),
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
          if (event.shiftKey) {
            delta = Math.round((drag.frame.angle + delta) / 15) * 15 - drag.frame.angle;
          }
          dispatch(rotateTarget(drag.target, drag.frame, delta, viewport));
        } else if (drag.type === "scale") {
          const update = scaleTarget(drag.target, drag.frame, drag.corner, local, viewport);
          if (update) dispatch(update);
        } else if (drag.type === "shapePoint") {
          const shape = state.shapes.find((s) => s.id === drag.id);
          if (!shape) return;
          dispatch({
            type: "UPDATE_SHAPE",
            id: drag.id,
            updates: { points: shape.points.map((p, i) => (i === drag.index ? pdfPoint : p)) },
          });
        } else if (drag.type === "rectWidthLabel") {
          const rectangle = state.rectangles.find((r) => r.id === drag.id);
          if (!rectangle) return;
          const anchorDoc = getRectWidthLabelAnchorDoc(
            rectangle,
            state.fileType ?? "image",
          );
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: {
              widthLabelOffset: computeDocOffsetFromScreen(
                viewport,
                anchorDoc,
                unturnRectPoint(rectangle, local),
              ),
            },
          });
        } else if (drag.type === "rectHeightLabel") {
          const rectangle = state.rectangles.find((r) => r.id === drag.id);
          if (!rectangle) return;
          const anchorDoc = getRectHeightLabelAnchorDoc(rectangle);
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: {
              heightLabelOffset: computeDocOffsetFromScreen(
                viewport,
                anchorDoc,
                unturnRectPoint(rectangle, local),
              ),
            },
          });
        } else if (drag.type === "shapeBody") {
          const dx = pdfPoint.x - drag.originPdf.x;
          const dy = pdfPoint.y - drag.originPdf.y;
          dispatch({
            type: "UPDATE_SHAPE",
            id: drag.id,
            updates: { points: drag.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
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
        setPreviewEnd(pdfPoint);
      }
    },
    [dispatch, onCursorMove, overlayRef, snapToLine, state.drawingShapeId, state.fileType, state.measurements, state.notes, state.pendingPoint, state.rectangles, state.shapes, state.tool, unturnRectPoint, viewport],
  );

  /**
   * Runs before any markup's own handler: a plain press on a member of a multi-selection
   * drags the whole group instead of re-selecting just that one markup.
   */
  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (state.tool !== "select" || state.selectedIds.length < 2 || event.button !== 0) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      const overlay = overlayRef.current;
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
      if (!hitId || !state.selectedIds.includes(hitId)) return;
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
    [overlayRef, state.displayUnit, state.measurements, state.notes, state.rectangles, state.scale, state.selectedIds, state.shapes, state.tool, viewport],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;

    if (drag?.type === "freehand") {
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
  }, [dispatch, state.measurements, state.notes, state.rectangles, state.selectedIds, toolColors.cloud, state.shapes, viewport]);

  const singleSelectedId =
    state.selectedIds.length === 1 ? state.selectedIds[0] : null;
  const showEditHandles = state.tool === "select" && state.selectedIds.length === 1;

  const onEndpointPointerDown = (
    id: string,
    endpoint: "start" | "end",
    event: React.PointerEvent,
  ) => {
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "endpoint", id, endpoint };
  };

  const onBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const measurement = state.measurements.find((m) => m.id === id);
    if (!measurement) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    dispatch({ type: "RECORD_UNDO" });

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

  const onLabelDragStart = (id: string, event: React.PointerEvent) => {
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "label", id };
  };

  const onRectBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const rectangle = state.rectangles.find((r) => r.id === id);
    if (!rectangle) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    dispatch({ type: "RECORD_UNDO" });

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
    if (!rectangle) return;

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
    if (!rectangle) return;
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
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "shapePoint", id, index };
  };

  const onWidthLabelDragStart = (id: string, event: React.PointerEvent) => {
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "rectWidthLabel", id };
  };

  const onHeightLabelDragStart = (id: string, event: React.PointerEvent) => {
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { type: "rectHeightLabel", id };
  };

  const onNoteBodyPointerDown = (id: string, event: React.PointerEvent) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    dispatch({ type: "RECORD_UNDO" });

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
      onLabelDragStart={onLabelDragStart}
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
      fileType={state.fileType ?? "image"}
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
      onWidthLabelDragStart={onWidthLabelDragStart}
      onHeightLabelDragStart={onHeightLabelDragStart}
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
    shape.points.length === 2 ? (
      <NoteAnnotation
        key={`${shape.id}-card`}
        note={{ id: shape.id, position: shape.points[1], text: shape.text ?? "", color: shape.color }}
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
          startShapeDrag(shape, toDocPoint(viewport, local.x, local.y), event);
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
    const shape = state.shapes.find((s) => s.id === singleSelectedId);
    if (shape) return { kind: "shape", item: shape };
    const note = state.notes.find((n) => n.id === singleSelectedId);
    if (note) return { kind: "note", item: note };
    const rectangle = state.rectangles.find((r) => r.id === singleSelectedId);
    return rectangle ? { kind: "rect", item: rectangle } : null;
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
    (transformTarget.item.kind === "cloud" || transformTarget.item.kind === "area");

  const renderTransformHandles = (frame: TransformFrame) => {
    const [tl, tr] = frame.corners;
    const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const out = { x: topMid.x - frame.centre.x, y: topMid.y - frame.centre.y };
    const len = Math.hypot(out.x, out.y) || 1;
    const knob = { x: topMid.x + (out.x / len) * 26, y: topMid.y + (out.y / len) * 26 };
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

  const handleStartEditLength = (id: string) => {
    dispatch({
      type: "SET_EDITING_DIMENSION",
      editing: { target: "line", id, field: "length" },
    });
  };

  const handleStartEditWidth = (id: string) => {
    dispatch({
      type: "SET_EDITING_DIMENSION",
      editing: { target: "rectangle", id, field: "width" },
    });
  };

  const handleStartEditHeight = (id: string) => {
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
  const previewEndScreen = previewEnd
    ? toScreenPoint(viewport, previewEnd.x, previewEnd.y)
    : null;

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
    freehandStroke && freehandStroke.length > 1
      ? freehandStroke.map((p) => `${p.x},${p.y}`).join(" ")
      : null;

  const marqueePreview = state.pendingMarquee
    ? screenRectFromPoints(state.pendingMarquee.start, state.pendingMarquee.current)
    : null;

  return (
    <svg
      width={viewport.width}
      height={viewport.height}
      className="absolute inset-0 touch-none"
      style={{
        cursor:
          state.tool === "pan"
            ? "grab"
            : state.tool === "note"
              ? "text"
              : "crosshair",
      }}
      onPointerDownCapture={handlePointerDownCapture}
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
      onPointerLeave={() => {
        handlePointerUp();
        onCursorMove?.(null);
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
        {callouts
          .filter((c) => showEditHandles && singleSelectedId === c.id && c.points.length === 2)
          .map((c) => {
            const tip = toScreenPoint(viewport, c.points[0].x, c.points[0].y);
            return (
              <circle
                key={`${c.id}-tip`}
                cx={tip.x}
                cy={tip.y}
                r={6}
                fill="#0f172a"
                stroke={c.color ?? "#ef4444"}
                strokeWidth={2}
                style={{ cursor: "crosshair", pointerEvents: "all" }}
                onPointerDown={(event) => onShapePointPointerDown(c.id, 0, event)}
              />
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
          previewEnd && (
            <PreviewDimensionLine
              start={previewStart}
              end={previewEndScreen}
              label={formatDistance(
                convertUnits(
                  docDistance(state.pendingPoint, previewEnd) *
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
