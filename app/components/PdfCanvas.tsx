"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DropIcon } from "@/app/components/DropIcon";
import { RestoreSessions } from "@/app/components/RestoreSessions";
import type { DocumentRotation, Point2D } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { useDocument } from "@/app/hooks/useDocument";
import { AnnotationLayer } from "@/app/components/AnnotationLayer";
import { MagnifierLoupe } from "@/app/components/MagnifierLoupe";
import { PdfDetailLayer } from "@/app/components/PdfDetailLayer";
import { Minimap } from "@/app/components/Minimap";
import { getTabScroll, saveTabScroll, tabScrollKey } from "@/app/utils/tabScroll";
import { viewerBridge } from "@/app/utils/viewerBridge";
import { pendingZoomAnchor, previewOrigin, scrollAfterZoom } from "@/app/utils/zoomAnchor";
import { clampZoom } from "@/app/utils/zoomLevels";
import { ACCEPTED_FILE_TYPES } from "@/app/utils/fileTypes";
import { PROJECT_ACCEPT } from "@/app/utils/projectFile";
import { openDocumentFile, pickAndOpenFile } from "@/app/utils/openFile";

/** Each wheel notch zooms by this factor, so steps feel the same at 25% and 1600%. */
const ZOOM_WHEEL_FACTOR = 1.1;
const ZOOM_COMMIT_DELAY_MS = 120;

export function PdfViewer() {
  const {
    fileBytes,
    fileType,
    fileName,
    fileMimeType,
    zoom,
    rotation,
    page,
    sheets,
    tool,
    loupeEnabled,
    minimapHidden,
    activeTabId,
    autoOrientPending,
    autoOrientPortrait,
    legacyRotationFixPending,
  } = useAppState();
  const dispatch = useAppDispatch();
  const {
    canvasRef,
    canvasElement,
    viewport,
    naturalSize,
    pageInfo,
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
    // While the import question is open there's no telling which page will be wanted.
    autoOrientPending || sheets === null,
    page,
  );
  const scrollKey = activeTabId ? tabScrollKey(activeTabId, page) : null;

  useEffect(() => {
    if (activeTabId && pageInfo) dispatch({ type: "SET_PAGE_INFO", tabId: activeTabId, ...pageInfo });
  }, [activeTabId, dispatch, pageInfo]);
  const [cursor, setCursorState] = useState<Point2D | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const setCursor = useCallback((next: Point2D | null) => {
    viewerBridge.cursor = next;
    setCursorState(next);
  }, []);

  useEffect(() => {
    dispatch({ type: "SET_DOCUMENT_VIEWPORT", viewport });
  }, [dispatch, viewport]);

  // Once the page size is known, keep the PDF's own /Rotate and, if that is
  // still portrait, turn it a further 270° so drawings open landscape.
  useEffect(() => {
    if (!autoOrientPending || !naturalSize || !activeTabId || sheets === null) return;
    const own = naturalSize.pageRotation;
    const sideways = own === 90 || own === 270;
    const portrait = sideways
      ? naturalSize.width > naturalSize.height
      : naturalSize.height > naturalSize.width;
    dispatch({
      type: "APPLY_AUTO_ORIENT",
      tabId: activeTabId,
      rotation: (portrait && autoOrientPortrait ? (own + 270) % 360 : own) as DocumentRotation,
    });
  }, [activeTabId, autoOrientPending, autoOrientPortrait, dispatch, naturalSize, sheets]);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    (scale: number, clientX: number, clientY: number) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl || !viewport) {
        return { x: 0, y: 0 };
      }

      const rect = scrollEl.getBoundingClientRect();
      return {
        x: previewOrigin(scrollEl.scrollLeft, clientX - rect.left, viewport.width, scale, scrollEl.clientWidth),
        y: previewOrigin(scrollEl.scrollTop, clientY - rect.top, viewport.height, scale, scrollEl.clientHeight),
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

      const origin = getPreviewOrigin(scale, clientX, clientY);
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

    // `viewport` is still the old zoom's size here: useDocument's update lands on the next render.
    const scale = newZoom / oldZoom;
    scrollEl.scrollLeft = scrollAfterZoom(scrollEl.scrollLeft, offsetX, viewport.width, scale, scrollEl.clientWidth);
    scrollEl.scrollTop = scrollAfterZoom(scrollEl.scrollTop, offsetY, viewport.height, scale, scrollEl.clientHeight);

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
    const saved = scrollKey ? getTabScroll(scrollKey) : null;
    if (saved) {
      scrollEl.scrollLeft = saved.left;
      scrollEl.scrollTop = saved.top;
    } else {
      scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
      scrollEl.scrollTop = 0;
    }
  }, [scrollKey, viewport]);

  // Remember this tab's scroll position (only once the initial position is set,
  // so the empty mount-time 0,0 can't overwrite it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollKey) return;
    const handleScroll = () => {
      if (!didCenterRef.current) return;
      saveTabScroll(scrollKey, el.scrollLeft, el.scrollTop);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollKey, fileBytes]);

  // Scroll events are frame-aligned, so a switch right after scrolling can miss
  // the last one. Layout cleanup runs before the node is detached, so the
  // position is still readable here.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollKey) return;
    return () => {
      if (didCenterRef.current) saveTabScroll(scrollKey, el.scrollLeft, el.scrollTop);
    };
  }, [scrollKey, fileBytes]);

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
        event.deltaY > 0
          ? previewZoomRef.current / ZOOM_WHEEL_FACTOR
          : previewZoomRef.current * ZOOM_WHEEL_FACTOR,
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
        // "Safe" centring: plain centring would push the top out of reach once this overflows.
        className="flex flex-1 flex-col items-center justify-center-safe gap-4 overflow-y-auto p-8 text-center"
      >
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface p-12 shadow-sm">
          <DropIcon className="mb-4 h-12 w-12 text-text-secondary" />
          <p className="text-lg font-medium text-text-primary">No file loaded</p>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Upload a PDF, TIF, or photo (PNG, JPG, etc.) to calibrate scale and
            add measurements, or drag and drop a file anywhere on the page.
          </p>
          <button
            type="button"
            onClick={() => void pickAndOpenFile(dispatch, fileInputRef.current)}
            className="btn-primary mt-6 shadow-sm"
            // The global reset outranks Tailwind padding utilities, so size it here.
            style={{ padding: "0.625rem 1.75rem", minWidth: "10rem" }}
          >
            Browse files…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`${ACCEPTED_FILE_TYPES},${PROJECT_ACCEPT}`}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void openDocumentFile(file, dispatch);
            }}
          />
        </div>
        <RestoreSessions />
      </div>
    );
  }

  return (
    // isolate: the minimap's z-index must not compete with header and status bar popups.
    <div className="relative isolate min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-auto bg-canvas-bg p-6"
        style={{ cursor: panCursor }}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
        onPointerLeave={handlePanPointerUp}
      >
        <div className="mx-auto flex min-h-full w-fit items-center justify-center">
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
                page={page}
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
                overlayRef={overlayRef}
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
