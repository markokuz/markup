"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { isAbortError, renderPdfRegion } from "@/app/utils/pdfium";

const SCROLL_SETTLE_MS = 150;
/** Extra area rendered around the visible region, as a fraction of its size,
 * so short scrolls don't need a new render. */
const PAD_RATIO = 0.5;

interface DetailRect {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  rotation: number;
}

/**
 * Sharp render of just the visible part of the page, drawn over the base
 * canvas while the full-page render is missing or below device resolution.
 * PDFium skips everything outside the region, so this is fast at any zoom.
 */
export function PdfDetailLayer({
  bytes,
  zoom,
  rotation,
  viewportWidth,
  viewportHeight,
  baseSharp,
  scrollRef,
}: {
  bytes: Uint8Array;
  zoom: number;
  rotation: number;
  viewportWidth: number;
  viewportHeight: number;
  baseSharp: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<DetailRect | null>(null);
  const rectRef = useRef<DetailRect | null>(null);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const canvas = canvasRef.current;
    const pageEl = canvas?.parentElement;
    if (!scrollEl || !canvas || !pageEl) return;

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      if (baseSharp) {
        rectRef.current = null;
        setRect(null);
        return;
      }

      const pageRect = pageEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const visLeft = Math.max(0, scrollRect.left - pageRect.left);
      const visTop = Math.max(0, scrollRect.top - pageRect.top);
      const visRight = Math.min(viewportWidth, scrollRect.right - pageRect.left);
      const visBottom = Math.min(viewportHeight, scrollRect.bottom - pageRect.top);
      if (visRight <= visLeft || visBottom <= visTop) return;

      const last = rectRef.current;
      if (
        last &&
        last.zoom === zoom &&
        last.rotation === rotation &&
        visLeft >= last.left &&
        visTop >= last.top &&
        visRight <= last.left + last.width &&
        visBottom <= last.top + last.height
      ) {
        return;
      }

      const padX = (visRight - visLeft) * PAD_RATIO;
      const padY = (visBottom - visTop) * PAD_RATIO;
      const left = Math.floor(Math.max(0, visLeft - padX));
      const top = Math.floor(Math.max(0, visTop - padY));
      const width = Math.ceil(Math.min(viewportWidth, visRight + padX)) - left;
      const height = Math.ceil(Math.min(viewportHeight, visBottom + padY)) - top;

      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      renderPdfRegion(
        bytes,
        {
          rotation,
          scale: zoom * dpr,
          x: Math.round(left * dpr),
          y: Math.round(top * dpr),
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
        },
        "high",
        signal,
      ).then(
        (bitmap) => {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          bitmap.close();
          rectRef.current = { left, top, width, height, zoom, rotation };
          setRect(rectRef.current);
        },
        (err) => {
          if (!isAbortError(err)) console.error("Detail render failed", err);
        },
      );
    };

    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, SCROLL_SETTLE_MS);
    };

    render();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      controller?.abort();
      if (timer) clearTimeout(timer);
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [bytes, zoom, rotation, viewportWidth, viewportHeight, baseSharp, scrollRef]);

  // Pixels from another zoom/rotation would be misplaced; the base shows until the new render lands.
  const visible = rect && rect.zoom === zoom && rect.rotation === rotation;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute"
      style={
        visible
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : { display: "none" }
      }
    />
  );
}
