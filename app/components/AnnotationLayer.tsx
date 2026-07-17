"use client";

import { useCallback, useRef, useState } from "react";
import type { Point2D } from "@/app/types";
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
  toDocPoint,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import {
  findAnnotationsInMarquee,
  screenRectFromPoints,
  type MarqueeSelectionMode,
} from "@/app/utils/selection";
import {
  applyLineLength,
  applyRectHeight,
  applyRectWidth,
  normalizeRect,
} from "@/app/utils/dimensions";
import {
  RectangleAnnotation,
  type RectCorner,
} from "@/app/components/RectangleAnnotation";
import { MeasurementLine } from "@/app/components/MeasurementLine";
import type { DocumentViewport } from "@/app/utils/documentViewport";

interface AnnotationLayerProps {
  viewport: DocumentViewport;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode =
  | { type: "endpoint"; id: string; endpoint: "start" | "end" }
  | { type: "body"; id: string; originPdf: Point2D; startPdf: Point2D; endPdf: Point2D }
  | { type: "label"; id: string }
  | { type: "drawRect"; start: Point2D; current: Point2D }
  | { type: "rectBody"; id: string; originPdf: Point2D; topLeft: Point2D; bottomRight: Point2D }
  | { type: "rectCorner"; id: string; fixedCornerScreen: Point2D }
  | { type: "rectWidthLabel"; id: string }
  | { type: "marquee"; startScreen: Point2D; currentScreen: Point2D; additive: boolean }
  | { type: "rectHeightLabel"; id: string };

const MIN_RECT_SIZE = 5;
const MIN_MARQUEE_SIZE = 4;

function getMarqueeSelectionMode(
  start: Point2D,
  current: Point2D,
): MarqueeSelectionMode {
  return current.x >= start.x ? "contain" : "intersect";
}

function createId() {
  return crypto.randomUUID();
}

export function AnnotationLayer({ viewport, overlayRef }: AnnotationLayerProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [previewEnd, setPreviewEnd] = useState<Point2D | null>(null);
  const dragRef = useRef<DragMode | null>(null);

  const handleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (state.tool === "pan") return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      if (state.tool === "select") {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          type: "marquee",
          startScreen: local,
          currentScreen: local,
          additive: event.shiftKey,
        };
        if (!event.shiftKey) {
          dispatch({ type: "SET_SELECTION", ids: [] });
        }
        dispatch({
          type: "SET_PENDING_MARQUEE",
          marquee: { start: local, current: local },
        });
        return;
      }

      if (state.tool === "rectangle" && state.scale) {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { type: "drawRect", start: pdfPoint, current: pdfPoint };
        dispatch({
          type: "SET_PENDING_RECT_DRAG",
          drag: { start: pdfPoint, current: pdfPoint },
        });
        return;
      }

      if (state.tool === "calibrate" || state.tool === "measure") {
        if (!state.pendingPoint) {
          dispatch({ type: "SET_PENDING_POINT", point: pdfPoint });
          setPreviewEnd(pdfPoint);
        } else {
          const start = state.pendingPoint;
          const end = pdfPoint;

          if (state.tool === "calibrate") {
            dispatch({
              type: "OPEN_CALIBRATE_DIALOG",
              line: { start, end },
            });
          } else if (state.scale) {
            const anchorDoc = midpoint(start, end);
            dispatch({
              type: "ADD_MEASUREMENT",
              measurement: {
                id: createId(),
                start,
                end,
                labelOffset: defaultScreenLabelOffsetDoc(viewport, anchorDoc),
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
      overlayRef,
      state.pendingPoint,
      state.scale,
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

      if (dragRef.current) {
        const drag = dragRef.current;

        if (drag.type === "drawRect") {
          dragRef.current = { ...drag, current: pdfPoint };
          dispatch({
            type: "SET_PENDING_RECT_DRAG",
            drag: { start: drag.start, current: pdfPoint },
          });
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
          dispatch({
            type: "UPDATE_MEASUREMENT",
            id: drag.id,
            updates: { [drag.endpoint]: pdfPoint },
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
        } else if (drag.type === "rectCorner") {
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: docRectFromScreenCorners(viewport, local, drag.fixedCornerScreen),
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
              widthLabelOffset: computeDocOffsetFromScreen(viewport, anchorDoc, local),
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
              heightLabelOffset: computeDocOffsetFromScreen(viewport, anchorDoc, local),
            },
          });
        }
        return;
      }

      if (state.pendingPoint) {
        setPreviewEnd(pdfPoint);
      }
    },
    [dispatch, overlayRef, state.fileType, state.measurements, state.pendingPoint, state.rectangles, viewport],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;

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
          viewport,
          marquee,
          getMarqueeSelectionMode(marquee.start, marquee.current),
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

    if (drag?.type === "drawRect" && state.scale) {
      const normalized = normalizeRect(drag.start, drag.current);
      const width = Math.abs(normalized.bottomRight.x - normalized.topLeft.x);
      const height = Math.abs(normalized.bottomRight.y - normalized.topLeft.y);

      if (width >= MIN_RECT_SIZE && height >= MIN_RECT_SIZE) {
        const rectangle = {
          id: createId(),
          ...normalized,
          widthLabelOffset: { x: 0, y: 0 },
          heightLabelOffset: { x: 0, y: 0 },
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
        dispatch({ type: "SET_PENDING_RECT_DRAG", drag: null });
      }
    }

    dragRef.current = null;
  }, [dispatch, state.fileType, state.measurements, state.rectangles, state.scale, state.selectedIds, viewport]);

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
    };
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
      updates: applyRectWidth(rectangle, value, state.scale, state.displayUnit),
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
      updates: applyRectHeight(rectangle, value, state.scale, state.displayUnit),
    });
    dispatch({ type: "CLEAR_EDITING_DIMENSION" });
  };

  const previewStart = state.pendingPoint
    ? toScreenPoint(viewport, state.pendingPoint.x, state.pendingPoint.y)
    : null;
  const previewEndScreen = previewEnd
    ? toScreenPoint(viewport, previewEnd.x, previewEnd.y)
    : null;

  const rectPreview = state.pendingRectDrag
    ? toScreenRect(
        viewport,
        {
          x: Math.min(state.pendingRectDrag.start.x, state.pendingRectDrag.current.x),
          y: Math.min(state.pendingRectDrag.start.y, state.pendingRectDrag.current.y),
        },
        {
          x: Math.max(state.pendingRectDrag.start.x, state.pendingRectDrag.current.x),
          y: Math.max(state.pendingRectDrag.start.y, state.pendingRectDrag.current.y),
        },
      )
    : null;

  const marqueePreview = state.pendingMarquee
    ? screenRectFromPoints(state.pendingMarquee.start, state.pendingMarquee.current)
    : null;

  return (
    <svg
      width={viewport.width}
      height={viewport.height}
      className="absolute inset-0 touch-none"
      style={{ cursor: state.tool === "pan" ? "grab" : "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {state.measurements.map((measurement) => (
        <MeasurementLine
          key={measurement.id}
          measurement={measurement}
          viewport={viewport}
          scale={state.scale}
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
          onSelect={(id, shiftKey) => handleSelect(id, shiftKey)}
          onEndpointPointerDown={onEndpointPointerDown}
          onBodyPointerDown={onBodyPointerDown}
          onLabelDragStart={onLabelDragStart}
          onStartEditLength={handleStartEditLength}
          onCommitLength={handleCommitLength}
          onCancelEdit={() => dispatch({ type: "CLEAR_EDITING_DIMENSION" })}
        />
      ))}
      {state.rectangles.map((rectangle) => (
        <RectangleAnnotation
          key={rectangle.id}
          rectangle={rectangle}
          viewport={viewport}
          fileType={state.fileType ?? "image"}
          scale={state.scale}
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
          onSelect={(id, shiftKey) => handleSelect(id, shiftKey)}
          onBodyPointerDown={onRectBodyPointerDown}
          onCornerPointerDown={onRectCornerPointerDown}
          onWidthLabelDragStart={onWidthLabelDragStart}
          onHeightLabelDragStart={onHeightLabelDragStart}
          onStartEditWidth={handleStartEditWidth}
          onStartEditHeight={handleStartEditHeight}
          onCommitWidth={handleCommitWidth}
          onCommitHeight={handleCommitHeight}
          onCancelEdit={() => dispatch({ type: "CLEAR_EDITING_DIMENSION" })}
        />
      ))}
      {marqueePreview && (
        <rect
          x={marqueePreview.x}
          y={marqueePreview.y}
          width={marqueePreview.width}
          height={marqueePreview.height}
          fill="rgba(34, 211, 238, 0.08)"
          stroke="#22d3ee"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
      {previewStart && previewEndScreen && (
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
    </svg>
  );
}
