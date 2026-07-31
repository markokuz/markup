"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { useDocument } from "@/app/hooks/useDocument";
import { AnnotationLayer } from "@/app/components/AnnotationLayer";
import { detectDocumentType } from "@/app/utils/fileTypes";
import { pendingZoomAnchor } from "@/app/utils/zoomAnchor";

const ZOOM_WHEEL_STEP = 0.1;
const ZOOM_COMMIT_DELAY_MS = 120;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

async function readDocumentFile(
  file: File,
  dispatch: React.Dispatch<import("@/app/types").AppAction>,
) {
  const fileType = detectDocumentType(file);
  if (!fileType) return;

  const buffer = await file.arrayBuffer();
  dispatch({
    type: "LOAD_FILE",
    bytes: new Uint8Array(buffer),
    fileName: file.name,
    fileType,
    mimeType: file.type,
  });
}

export function PdfViewer() {
  const { fileBytes, fileType, fileName, fileMimeType, zoom, rotation, tool } = useAppState();
  const dispatch = useAppDispatch();
  const { canvasRef, viewport, loading, error } = useDocument(
    fileBytes,
    fileType,
    fileName,
    fileMimeType,
    zoom,
    rotation,
  );

  useEffect(() => {
    dispatch({ type: "SET_DOCUMENT_VIEWPORT", viewport });
  }, [dispatch, viewport]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  );
  const prevZoomRef = useRef(zoom);
  const previewZoomRef = useRef(zoom);
  const committedZoomRef = useRef(zoom);
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWheelAnchorRef = useRef<{ clientX: number; clientY: number } | null>(
    null,
  );
  const [isPanning, setIsPanning] = useState(false);

  const clearPreviewTransform = useCallback(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.transformOrigin = "";
  }, []);

  const getPreviewOrigin = useCallback(
    (clientX: number, clientY: number) => {
      const overlay = overlayRef.current;
      if (!overlay || !viewport) {
        return { x: 0, y: 0 };
      }

      const rect = overlay.getBoundingClientRect();
      const ratioX =
        rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
      const ratioY =
        rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;

      return {
        x: ratioX * viewport.width,
        y: ratioY * viewport.height,
      };
    },
    [viewport],
  );

  const applyPreviewTransform = useCallback(
    (scale: number, clientX: number, clientY: number) => {
      const el = overlayRef.current;
      if (!el) return;

      if (Math.abs(scale - 1) < 0.001) {
        clearPreviewTransform();
        return;
      }

      const origin = getPreviewOrigin(clientX, clientY);
      el.style.transformOrigin = `${origin.x}px ${origin.y}px`;
      el.style.transform = `scale(${scale})`;
    },
    [clearPreviewTransform, getPreviewOrigin],
  );

  const commitPreviewZoom = useCallback(() => {
    const nextZoom = clampZoom(previewZoomRef.current);
    previewZoomRef.current = nextZoom;

    if (nextZoom === committedZoomRef.current) {
      clearPreviewTransform();
      return;
    }

    if (lastWheelAnchorRef.current) {
      pendingZoomAnchor.current = lastWheelAnchorRef.current;
    }

    dispatch({ type: "SET_ZOOM", zoom: nextZoom });
  }, [clearPreviewTransform, dispatch]);

  const scheduleZoomCommit = useCallback(() => {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
    }

    zoomCommitTimerRef.current = setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitPreviewZoom();
    }, ZOOM_COMMIT_DELAY_MS);
  }, [commitPreviewZoom]);

  const flushZoomCommit = useCallback(() => {
    if (!zoomCommitTimerRef.current) return;
    clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = null;
    commitPreviewZoom();
  }, [commitPreviewZoom]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !viewport) return;

    const oldZoom = prevZoomRef.current;
    const newZoom = zoom;
    if (oldZoom === newZoom) return;

    const anchor = pendingZoomAnchor.current ?? "center";
    pendingZoomAnchor.current = null;

    const rect = scrollEl.getBoundingClientRect();
    const offsetX =
      anchor === "center" ? rect.width / 2 : anchor.clientX - rect.left;
    const offsetY =
      anchor === "center" ? rect.height / 2 : anchor.clientY - rect.top;

    const scale = newZoom / oldZoom;
    scrollEl.scrollLeft = (scrollEl.scrollLeft + offsetX) * scale - offsetX;
    scrollEl.scrollTop = (scrollEl.scrollTop + offsetY) * scale - offsetY;

    prevZoomRef.current = newZoom;
    committedZoomRef.current = newZoom;
    previewZoomRef.current = newZoom;
    clearPreviewTransform();
  }, [zoom, viewport, clearPreviewTransform]);

  useEffect(() => {
    previewZoomRef.current = zoom;
    committedZoomRef.current = zoom;
    clearPreviewTransform();
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
  }, [zoom, clearPreviewTransform]);

  useEffect(() => {
    prevZoomRef.current = zoom;
  }, [fileBytes]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) {
        clearTimeout(zoomCommitTimerRef.current);
      }
    };
  }, []);

  const beginPan = useCallback((clientX: number, clientY: number) => {
    flushZoomCommit();
    if (!scrollRef.current) return;
    panRef.current = {
      x: clientX,
      y: clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
    setIsPanning(true);
  }, [flushZoomCommit]);

  const endPan = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!fileBytes) return;
      event.preventDefault();

      previewZoomRef.current = clampZoom(
        previewZoomRef.current + (event.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP),
      );
      lastWheelAnchorRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      const scale = previewZoomRef.current / committedZoomRef.current;
      applyPreviewTransform(scale, event.clientX, event.clientY);
      scheduleZoomCommit();
    },
    [applyPreviewTransform, fileBytes, scheduleZoomCommit],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !fileBytes) return;

    const onMiddlePointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      beginPan(event.clientX, event.clientY);
      el.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!panRef.current || !scrollRef.current) return;
      const dx = event.clientX - panRef.current.x;
      const dy = event.clientY - panRef.current.y;
      scrollRef.current.scrollLeft = panRef.current.scrollLeft - dx;
      scrollRef.current.scrollTop = panRef.current.scrollTop - dy;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!panRef.current) return;
      if (event.button === 1 || event.button === 0) {
        endPan();
      }
    };

    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    el.addEventListener("pointerdown", onMiddlePointerDown, { capture: true });
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("auxclick", onAuxClick);

    return () => {
      el.removeEventListener("pointerdown", onMiddlePointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("auxclick", onAuxClick);
    };
  }, [fileBytes, beginPan, endPan]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) await readDocumentFile(file, dispatch);
    },
    [dispatch],
  );

  const handlePanPointerDown = (event: React.PointerEvent) => {
    if (tool !== "pan" || event.button !== 0 || !scrollRef.current) return;
    beginPan(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePanPointerMove = (event: React.PointerEvent) => {
    if (!panRef.current || !scrollRef.current) return;
    const dx = event.clientX - panRef.current.x;
    const dy = event.clientY - panRef.current.y;
    scrollRef.current.scrollLeft = panRef.current.scrollLeft - dx;
    scrollRef.current.scrollTop = panRef.current.scrollTop - dy;
  };

  const handlePanPointerUp = () => {
    endPan();
  };

  const panCursor = isPanning ? "grabbing" : tool === "pan" ? "grab" : undefined;

  if (!fileBytes) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-12">
          <p className="text-lg font-medium text-slate-200">No file loaded</p>
          <p className="mt-2 max-w-sm text-sm text-slate-500">
            Upload a PDF, TIF, or photo (PNG, JPG, etc.) to calibrate scale and
            add measurements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto bg-slate-900/50 p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ cursor: panCursor }}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={handlePanPointerUp}
      onPointerLeave={handlePanPointerUp}
    >
      <div className="mx-auto flex min-h-full w-fit items-start justify-center">
        <div
          ref={overlayRef}
          className="relative shadow-2xl shadow-black/40"
          style={
            viewport
              ? { width: viewport.width, height: viewport.height }
              : { minWidth: 320, minHeight: 420 }
          }
        >
          <canvas ref={canvasRef} className="block max-w-none bg-white" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 text-sm text-slate-200">
              Rendering…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-950/60 p-4 text-sm text-red-200">
              {error}
            </div>
          )}
          {viewport && tool !== "pan" && (
            <AnnotationLayer viewport={viewport} overlayRef={overlayRef} />
          )}
        </div>
      </div>
    </div>
  );
}
