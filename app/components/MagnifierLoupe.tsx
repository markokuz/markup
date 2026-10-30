"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Point2D } from "@/app/types";
import { ANNOTATION_ROOT_ID } from "@/app/utils/viewerBridge";

const LOUPE_SIZE = 128;
const MAGNIFICATION = 3;
const CURSOR_OFFSET = 24;

interface MagnifierLoupeProps {
  /** The rendered document canvas to magnify. */
  sourceCanvas: HTMLCanvasElement | null;
  /** Cursor position in overlay/CSS coordinates, or null when off-canvas. */
  cursor: Point2D | null;
  /** The overlay `cursor` is measured in; places the loupe on screen. */
  overlayRef: RefObject<HTMLElement | null>;
  viewportWidth: number;
  viewportHeight: number;
}

export function MagnifierLoupe({
  sourceCanvas,
  cursor,
  overlayRef,
  viewportWidth,
  viewportHeight,
}: MagnifierLoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fixed to the window (portaled to body) so the scroll area and tabs never clip it.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const overlay = overlayRef.current;
    if (!box || !overlay || !cursor) return;
    const origin = overlay.getBoundingClientRect();
    const clientX = origin.left + cursor.x;
    const clientY = origin.top + cursor.y;
    let left = clientX + CURSOR_OFFSET;
    let top = clientY - LOUPE_SIZE - CURSOR_OFFSET;
    if (left + LOUPE_SIZE > window.innerWidth) left = clientX - LOUPE_SIZE - CURSOR_OFFSET;
    if (left < 0) left = CURSOR_OFFSET;
    if (top < 0) top = clientY + CURSOR_OFFSET;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }, [cursor, overlayRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceCanvas || !cursor) return;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = LOUPE_SIZE * dpr;
    canvas.height = LOUPE_SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    // Source canvas holds device pixels: cssPx * (canvas.width / viewportWidth).
    const srcScaleX = sourceCanvas.width / viewportWidth;
    const srcScaleY = sourceCanvas.height / viewportHeight;
    const cropCss = LOUPE_SIZE / MAGNIFICATION;
    const sw = cropCss * srcScaleX;
    const sh = cropCss * srcScaleY;
    const sx = cursor.x * srcScaleX - sw / 2;
    const sy = cursor.y * srcScaleY - sh / 2;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    } catch {
      // drawImage can throw if the crop is fully out of bounds — ignore.
    }
  }, [sourceCanvas, cursor, viewportWidth, viewportHeight]);

  if (!cursor || !sourceCanvas) return null;

  // Same crop as the canvas, in overlay coordinates, for the live markup copy.
  const cropCss = LOUPE_SIZE / MAGNIFICATION;
  const viewBox = `${cursor.x - cropCss / 2} ${cursor.y - cropCss / 2} ${cropCss} ${cropCss}`;
  const center = LOUPE_SIZE / 2;

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        width: LOUPE_SIZE,
        height: LOUPE_SIZE,
        borderRadius: "50%",
        overflow: "hidden",
        border: "2px solid rgba(15, 23, 42, 0.6)",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
        pointerEvents: "none",
        zIndex: 60,
        background: "#fff",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, display: "block" }}
      />
      <svg
        width={LOUPE_SIZE}
        height={LOUPE_SIZE}
        viewBox={viewBox}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <use href={`#${ANNOTATION_ROOT_ID}`} />
      </svg>
      {/* Crosshair marking the exact cursor point, above the markups. */}
      <svg
        width={LOUPE_SIZE}
        height={LOUPE_SIZE}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <g stroke="rgba(239, 68, 68, 0.9)" strokeWidth={1} fill="none">
          <line x1={center} y1={0} x2={center} y2={LOUPE_SIZE} />
          <line x1={0} y1={center} x2={LOUPE_SIZE} y2={center} />
          <circle cx={center} cy={center} r={3} />
        </g>
      </svg>
    </div>,
    document.body,
  );
}
