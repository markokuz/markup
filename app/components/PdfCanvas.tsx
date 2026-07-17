"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { useDocument } from "@/app/hooks/useDocument";
import { AnnotationLayer } from "@/app/components/AnnotationLayer";
import { detectDocumentType } from "@/app/utils/fileTypes";

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
  const { fileBytes, fileType, fileName, fileMimeType, zoom, tool } = useAppState();
  const dispatch = useAppDispatch();
  const { canvasRef, viewport, loading, error } = useDocument(
    fileBytes,
    fileType,
    fileName,
    fileMimeType,
    zoom,
  );

  useEffect(() => {
    dispatch({ type: "SET_DOCUMENT_VIEWPORT", viewport });
  }, [dispatch, viewport]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  );
  const [isPanning, setIsPanning] = useState(false);

  const beginPan = useCallback((clientX: number, clientY: number) => {
    if (!scrollRef.current) return;
    panRef.current = {
      x: clientX,
      y: clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
    setIsPanning(true);
  }, []);

  const endPan = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!fileBytes) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.min(4, Math.max(0.25, zoom + delta));
      dispatch({ type: "SET_ZOOM", zoom: Math.round(next * 100) / 100 });
    },
    [dispatch, fileBytes, zoom],
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
