"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_DIM = 180;

interface MinimapProps {
  sourceCanvas: HTMLCanvasElement | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  viewportWidth: number;
  viewportHeight: number;
  onHide: () => void;
}

export function Minimap({
  sourceCanvas,
  scrollRef,
  viewportWidth,
  viewportHeight,
  onHide,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, forceTick] = useState(0);

  const scale =
    viewportWidth > 0 && viewportHeight > 0
      ? Math.min(MAX_DIM / viewportWidth, MAX_DIM / viewportHeight)
      : 0;
  const mmWidth = Math.max(1, viewportWidth * scale);
  const mmHeight = Math.max(1, viewportHeight * scale);

  // Redraw the downscaled snapshot when the document (size/zoom) changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceCanvas || scale <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(mmWidth * dpr);
    canvas.height = Math.floor(mmHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mmWidth, mmHeight);
    try {
      ctx.drawImage(sourceCanvas, 0, 0, mmWidth, mmHeight);
    } catch {
      // ignore transient draw errors
    }
  }, [sourceCanvas, mmWidth, mmHeight, scale, viewportWidth, viewportHeight]);

  // Re-render the viewport box on scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        forceTick((n) => n + 1);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  const getVisibleRect = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !sourceCanvas) return null;
    const scrollRect = scrollEl.getBoundingClientRect();
    const canvasRect = sourceCanvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

    const cssScaleX = viewportWidth / canvasRect.width;
    const cssScaleY = viewportHeight / canvasRect.height;

    const visLeft = Math.max(0, (scrollRect.left - canvasRect.left) * cssScaleX);
    const visTop = Math.max(0, (scrollRect.top - canvasRect.top) * cssScaleY);
    const visRight = Math.min(
      viewportWidth,
      (scrollRect.right - canvasRect.left) * cssScaleX,
    );
    const visBottom = Math.min(
      viewportHeight,
      (scrollRect.bottom - canvasRect.top) * cssScaleY,
    );

    return {
      x: visLeft * scale,
      y: visTop * scale,
      width: Math.max(0, visRight - visLeft) * scale,
      height: Math.max(0, visBottom - visTop) * scale,
    };
  }, [scrollRef, sourceCanvas, viewportWidth, viewportHeight, scale]);

  const recenterTo = useCallback(
    (mmX: number, mmY: number) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl || !sourceCanvas || scale <= 0) return;
      const scrollRect = scrollEl.getBoundingClientRect();
      const canvasRect = sourceCanvas.getBoundingClientRect();
      const canvasLeftInContent =
        canvasRect.left - scrollRect.left + scrollEl.scrollLeft;
      const canvasTopInContent =
        canvasRect.top - scrollRect.top + scrollEl.scrollTop;

      const docX = (mmX / scale) * (canvasRect.width / viewportWidth);
      const docY = (mmY / scale) * (canvasRect.height / viewportHeight);

      scrollEl.scrollLeft =
        canvasLeftInContent + docX - scrollEl.clientWidth / 2;
      scrollEl.scrollTop =
        canvasTopInContent + docY - scrollEl.clientHeight / 2;
    },
    [scrollRef, sourceCanvas, scale, viewportWidth, viewportHeight],
  );

  const draggingRef = useRef(false);

  const handlePointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      recenterTo(event.clientX - rect.left, event.clientY - rect.top);
    },
    [recenterTo],
  );

  if (!sourceCanvas || scale <= 0) return null;

  const visible = getVisibleRect();

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        zIndex: 30,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(15, 23, 42, 0.25)",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
        background: "#fff",
      }}
    >
      <div style={{ position: "relative", width: mmWidth, height: mmHeight }}>
        <canvas
          ref={canvasRef}
          style={{ width: mmWidth, height: mmHeight, display: "block" }}
          onPointerDown={(event) => {
            draggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            handlePointer(event);
          }}
          onPointerMove={(event) => {
            if (draggingRef.current) handlePointer(event);
          }}
          onPointerUp={(event) => {
            draggingRef.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        {visible && (
          <div
            style={{
              position: "absolute",
              left: visible.x,
              top: visible.y,
              width: visible.width,
              height: visible.height,
              border: "1.5px solid #ef4444",
              background: "rgba(239, 68, 68, 0.12)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <button
        type="button"
        aria-label="Hide minimap"
        onClick={onHide}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          lineHeight: "16px",
          fontSize: 12,
          textAlign: "center",
          borderRadius: 4,
          background: "rgba(15, 23, 42, 0.7)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}
