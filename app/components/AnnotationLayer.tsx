"use client";

import { useCallback, useRef, useState } from "react";
import type { Point2D } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import {
  docRectFromScreenCorners,
  getLocalCoords,
  getOppositeScreenCorner,
  getScreenCornerPoint,
  toDocPoint,
  toScreenPoint,
  toScreenRect,
} from "@/app/utils/coordinates";
import {
  applyLineLength,
  applyRectHeight,
  applyRectWidth,
  normalizeRect,
} from "@/app/utils/dimensions";
import { MeasurementLine } from "@/app/components/MeasurementLine";
import {
  RectangleAnnotation,
  type RectCorner,
} from "@/app/components/RectangleAnnotation";
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
  | { type: "rectHeightLabel"; id: string };

const MIN_RECT_SIZE = 5;

function createId() {
  return crypto.randomUUID();
}

export function AnnotationLayer({ viewport, overlayRef }: AnnotationLayerProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [previewEnd, setPreviewEnd] = useState<Point2D | null>(null);
  const dragRef = useRef<DragMode | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (state.tool === "pan") return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      if (state.tool === "select") {
        dispatch({ type: "SELECT_MEASUREMENT", id: null });
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
            dispatch({
              type: "ADD_MEASUREMENT",
              measurement: {
                id: createId(),
                start,
                end,
                labelOffset: { x: 0, y: -16 },
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
          const start = toScreenPoint(
            viewport,
            measurement.start.x,
            measurement.start.y,
          );
          const end = toScreenPoint(viewport, measurement.end.x, measurement.end.y);
          const mid = {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
          };
          dispatch({
            type: "UPDATE_MEASUREMENT",
            id: drag.id,
            updates: {
              labelOffset: {
                x: local.x - mid.x,
                y: local.y - mid.y,
              },
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
          const screenRect = toScreenRect(
            viewport,
            rectangle.topLeft,
            rectangle.bottomRight,
          );
          const anchor = {
            x: screenRect.x + screenRect.width / 2,
            y: screenRect.y,
          };
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: {
              widthLabelOffset: {
                x: local.x - anchor.x,
                y: local.y - anchor.y,
              },
            },
          });
        } else if (drag.type === "rectHeightLabel") {
          const rectangle = state.rectangles.find((r) => r.id === drag.id);
          if (!rectangle) return;
          const screenRect = toScreenRect(
            viewport,
            rectangle.topLeft,
            rectangle.bottomRight,
          );
          const anchor = {
            x: screenRect.x,
            y: screenRect.y + screenRect.height / 2,
          };
          dispatch({
            type: "UPDATE_RECTANGLE",
            id: drag.id,
            updates: {
              heightLabelOffset: {
                x: local.x - anchor.x,
                y: local.y - anchor.y,
              },
            },
          });
        }
        return;
      }

      if (state.pendingPoint) {
        setPreviewEnd(pdfPoint);
      }
    },
    [dispatch, overlayRef, state.measurements, state.pendingPoint, state.rectangles, viewport],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.type === "drawRect" && state.scale) {
      const normalized = normalizeRect(drag.start, drag.current);
      const width = Math.abs(normalized.bottomRight.x - normalized.topLeft.x);
      const height = Math.abs(normalized.bottomRight.y - normalized.topLeft.y);

      if (width >= MIN_RECT_SIZE && height >= MIN_RECT_SIZE) {
        dispatch({
          type: "ADD_RECTANGLE",
          rectangle: {
            id: createId(),
            ...normalized,
            widthLabelOffset: { x: 0, y: -16 },
            heightLabelOffset: { x: -16, y: 0 },
          },
        });
      } else {
        dispatch({ type: "SET_PENDING_RECT_DRAG", drag: null });
      }
    }

    dragRef.current = null;
  }, [dispatch, state.scale]);

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
          isSelected={state.selectedId === measurement.id}
          showHandles={state.tool === "select"}
          isEditingLength={
            state.editingDimension?.target === "line" &&
            state.editingDimension.id === measurement.id &&
            state.editingDimension.field === "length"
          }
          onSelect={(id) => dispatch({ type: "SELECT_MEASUREMENT", id })}
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
          scale={state.scale}
          displayUnit={state.displayUnit}
          isSelected={state.selectedId === rectangle.id}
          showHandles={state.tool === "select"}
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
          onSelect={(id) => dispatch({ type: "SELECT_MEASUREMENT", id })}
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
