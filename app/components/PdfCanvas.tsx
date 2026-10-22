"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point2D } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { useDocument } from "@/app/hooks/useDocument";
import { AnnotationLayer } from "@/app/components/AnnotationLayer";
import { MagnifierLoupe } from "@/app/components/MagnifierLoupe";
import { PdfDetailLayer } from "@/app/components/PdfDetailLayer";
import { Minimap } from "@/app/components/Minimap";
import { openDroppedFile } from "@/app/utils/openFile";
import { getTabScroll, saveTabScroll } from "@/app/utils/tabScroll";
import { viewerBridge } from "@/app/utils/viewerBridge";
import { pendingZoomAnchor } from "@/app/utils/zoomAnchor";

const ZOOM_WHEEL_STEP = 0.1;
const ZOOM_COMMIT_DELAY_MS = 120;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export function PdfViewer() {
  const {
    fileBytes,
    fileType,
    fileName,
    fileMimeType,
    zoom,
    rotation,
    tool,
    loupeEnabled,
    minimapHidden,
    activeTabId,
    autoOrientPending,
    legacyRotationFixPending,
  } = useAppState();
  const dispatch = useAppDispatch();
  const {
    canvasRef,
    canvasElement,
    viewport,
    naturalSize,
    loading,
    error,
    renderVersion,
    baseSharp,
  } = useDocument(
    fileBytes,
    fileType,
    fileName,
    fileMimeType,
    zoom,
    rotation,
    autoOrientPending,
  );
  const [cursor, setCursorState] = useState<Point2D | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const setCursor = useCallback((next: Point2D | null) => {
    viewerBridge.cursor = next;
    setCursorState(next);
  }, []);

  useEffect(() => {
    dispatch({ type: "SET_DOCUMENT_VIEWPORT", viewport });
  }, [dispatch, viewport]);

  // Sideways scans: once the page size is known, open portrait pages at 270°.
  useEffect(() => {
    if (!autoOrientPending || !naturalSize || !activeTabId) return;
    dispatch({
      type: "APPLY_AUTO_ORIENT",
      tabId: activeTabId,
      rotation: naturalSize.height > naturalSize.width ? 270 : 0,
    });
  }, [activeTabId, autoOrientPending, dispatch, naturalSize]);

  // Old projects saved with a rotated image used a mapping offset by the page
  // aspect; shift their coordinates once the image size is known.
  useEffect(() => {
    if (!legacyRotationFixPending || !naturalSize || !activeTabId) return;
    dispatch({
      type: "FIX_LEGACY_ROTATION",
      tabId: activeTabId,
      width: naturalSize.width,
      height: naturalSize.height,
    });
  }, [activeTabId, dispatch, legacyRotationFixPending, naturalSize]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fileBytes]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didCenterRef = useRef(false);
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

  // On first render for this tab, return to where the user left it, or center
  // the document instead of letting the browser pin the view to a corner.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !viewport || didCenterRef.current) return;
    didCenterRef.current = true;
    const saved = activeTabId ? getTabScroll(activeTabId) : null;
    if (saved) {
      scrollEl.scrollLeft = saved.left;
      scrollEl.scrollTop = saved.top;
    } else {
      scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
      scrollEl.scrollTop = 0;
    }
  }, [activeTabId, viewport]);

  // Remember this tab's scroll position (only once the initial position is set,
  // so the empty mount-time 0,0 can't overwrite it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabId) return;
    const handleScroll = () => {
      if (!didCenterRef.current) return;
      saveTabScroll(activeTabId, el.scrollLeft, el.scrollTop);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [activeTabId, fileBytes]);

  // Scroll events are frame-aligned, so a switch right after scrolling can miss
  // the last one. Layout cleanup runs before the node is detached, so the
  // position is still readable here.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabId) return;
    return () => {
      if (didCenterRef.current) saveTabScroll(activeTabId, el.scrollLeft, el.scrollTop);
    };
  }, [activeTabId, fileBytes]);

  // Let app-level shortcuts (paste) find the visible centre of the page.
  useEffect(() => {
    viewerBridge.getVisibleCenter = () => {
      const scrollEl = scrollRef.current;
      const overlay = overlayRef.current;
      if (!scrollEl || !overlay) return null;
      const scrollRect = scrollEl.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      return {
        x: scrollRect.left + scrollRect.width / 2 - overlayRect.left,
        y: scrollRect.top + scrollRect.height / 2 - overlayRect.top,
      };
    };
    return () => {
      viewerBridge.getVisibleCenter = null;
      viewerBridge.cursor = null;
    };
  }, []);

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
      await openDroppedFile(event.dataTransfer, dispatch);
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

  const showLoupe = tool === "calibrate" || (loupeEnabled && tool !== "pan");
  const overflowing =
    !!viewport &&
    (viewport.width > containerSize.w + 1 || viewport.height > containerSize.h + 1);
  const showMinimap = overflowing && !minimapHidden && !!canvasElement;

  if (!fileBytes) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="rounded-2xl border border-dashed border-border bg-surface p-12 shadow-sm">
          <p className="text-lg font-medium text-text-primary">No file loaded</p>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Upload a PDF, TIF, or photo (PNG, JPG, etc.) to calibrate scale and
            add measurements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-auto bg-canvas-bg p-6"
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
            className="relative shadow-md"
            style={
              viewport
                ? { width: viewport.width, height: viewport.height }
                : { minWidth: 320, minHeight: 420 }
            }
          >
            <canvas ref={canvasRef} className="block max-w-none bg-white" />
            {fileType === "pdf" && fileBytes && viewport && (
              <PdfDetailLayer
                bytes={fileBytes}
                zoom={zoom}
                rotation={rotation}
                viewportWidth={viewport.width}
                viewportHeight={viewport.height}
                baseSharp={baseSharp}
                scrollRef={scrollRef}
              />
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 p-4 text-sm text-red-700">
                {error}
              </div>
            )}
            {viewport && tool !== "pan" && (
              <AnnotationLayer
                viewport={viewport}
                overlayRef={overlayRef}
                onCursorMove={setCursor}
              />
            )}
            {showLoupe && viewport && (
              <MagnifierLoupe
                sourceCanvas={canvasElement}
                cursor={cursor}
                viewportWidth={viewport.width}
                viewportHeight={viewport.height}
              />
            )}
          </div>
        </div>
      </div>
      {loading && (
        // A badge, not a cover: the visible area paints long before the full page.
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary shadow">
          Rendering…
        </div>
      )}
      {showMinimap && viewport && (
        <Minimap
          sourceCanvas={canvasElement}
          renderVersion={renderVersion}
          scrollRef={scrollRef}
          viewportWidth={viewport.width}
          viewportHeight={viewport.height}
          onHide={() => dispatch({ type: "SET_MINIMAP_HIDDEN", hidden: true })}
        />
      )}
      {overflowing && minimapHidden && (
        <button
          type="button"
          onClick={() => dispatch({ type: "SET_MINIMAP_HIDDEN", hidden: false })}
          className="absolute bottom-4 right-4 z-30 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary shadow hover:bg-surface-muted"
        >
          Map
        </button>
      )}
    </div>
  );
}
