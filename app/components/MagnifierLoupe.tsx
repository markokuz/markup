"use client";

import { useEffect, useRef } from "react";
import type { Point2D } from "@/app/types";

const LOUPE_SIZE = 128;
const MAGNIFICATION = 3;
const CURSOR_OFFSET = 24;

interface MagnifierLoupeProps {
  /** The rendered document canvas to magnify. */
  sourceCanvas: HTMLCanvasElement | null;
  /** Cursor position in overlay/CSS coordinates, or null when off-canvas. */
  cursor: Point2D | null;
  viewportWidth: number;
  viewportHeight: number;
}

export function MagnifierLoupe({
  sourceCanvas,
  cursor,
  viewportWidth,
  viewportHeight,
}: MagnifierLoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // Crosshair marking the exact cursor point.
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, 3, 0, Math.PI * 2);
    ctx.stroke();
  }, [sourceCanvas, cursor, viewportWidth, viewportHeight]);

  if (!cursor || !sourceCanvas) return null;

  let left = cursor.x + CURSOR_OFFSET;
  let top = cursor.y - LOUPE_SIZE - CURSOR_OFFSET;
  if (left + LOUPE_SIZE > viewportWidth) left = cursor.x - LOUPE_SIZE - CURSOR_OFFSET;
  if (left < 0) left = CURSOR_OFFSET;
  if (top < 0) top = cursor.y + CURSOR_OFFSET;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: LOUPE_SIZE,
        height: LOUPE_SIZE,
        borderRadius: "50%",
        overflow: "hidden",
        border: "2px solid rgba(15, 23, 42, 0.6)",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
        pointerEvents: "none",
        zIndex: 40,
        background: "#fff",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, display: "block" }}
      />
    </div>
  );
}
