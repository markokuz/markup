"use client";

import { useCallback, useRef, useState } from "react";
import type { Point2D } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import {
  getLocalCoords,
  toDocPoint,
  toScreenPoint,
} from "@/app/utils/coordinates";
import { MeasurementLine } from "@/app/components/MeasurementLine";
import type { DocumentViewport } from "@/app/utils/documentViewport";

interface AnnotationLayerProps {
  viewport: DocumentViewport;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode =
  | { type: "endpoint"; id: string; endpoint: "start" | "end" }
  | { type: "body"; id: string; originPdf: Point2D; startPdf: Point2D; endPdf: Point2D }
  | { type: "label"; id: string; originOffset: Point2D };

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
    [dispatch, overlayRef, state.pendingPoint, state.scale, state.tool, viewport],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      const local = getLocalCoords(overlay, event.clientX, event.clientY);
      const pdfPoint = toDocPoint(viewport, local.x, local.y);

      if (dragRef.current) {
        const drag = dragRef.current;
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
        }
        return;
      }

      if (state.pendingPoint) {
        setPreviewEnd(pdfPoint);
      }
    },
    [dispatch, overlayRef, state.measurements, state.pendingPoint, viewport],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

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

  const onLabelPointerDown = (id: string, event: React.PointerEvent) => {
    dispatch({ type: "RECORD_UNDO" });
    event.currentTarget.setPointerCapture(event.pointerId);
    const measurement = state.measurements.find((m) => m.id === id);
    if (!measurement) return;
    dragRef.current = {
      type: "label",
      id,
      originOffset: { ...measurement.labelOffset },
    };
  };

  const previewStart = state.pendingPoint
    ? toScreenPoint(viewport, state.pendingPoint.x, state.pendingPoint.y)
    : null;
  const previewEndScreen = previewEnd
    ? toScreenPoint(viewport, previewEnd.x, previewEnd.y)
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
          onSelect={(id) => dispatch({ type: "SELECT_MEASUREMENT", id })}
          onEndpointPointerDown={onEndpointPointerDown}
          onBodyPointerDown={onBodyPointerDown}
          onLabelPointerDown={onLabelPointerDown}
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
    </svg>
  );
}
