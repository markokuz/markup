"use client";

import type { DocumentType, Point2D } from "@/app/types";
import { loadImageSource } from "@/app/utils/loadImage";
import { renderPdfRegion } from "@/app/utils/pdfium";
import { hasInk, knockOutWhite } from "@/app/utils/snapshotPixels";

/** Longest side of a captured snapshot, in pixels. */
const MAX_SIDE_PX = 3000;

interface SnapshotSource {
  fileType: DocumentType;
  fileBytes: Uint8Array;
  fileName: string;
  mimeType: string;
  /** Doc-space top-left of the unrotated page (doc space is y-up for PDFs). */
  docOrigin: { x: number; y: number };
}

/**
 * Captures the doc-space box between two corners as a PNG with the white paper made
 * transparent. Pixels are in doc orientation (no view rotation), matching `points`.
 */
export async function captureSnapshot(
  source: SnapshotSource,
  cornerA: Point2D,
  cornerB: Point2D,
): Promise<{ image: string; points: Point2D[] } | null> {
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 1 || h < 1) return null;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  if (source.fileType === "pdf") {
    const scale = Math.min(2 * (window.devicePixelRatio || 1), MAX_SIDE_PX / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const bitmap = await renderPdfRegion(
      source.fileBytes,
      {
        rotation: 0,
        scale,
        x: Math.round((minX - source.docOrigin.x) * scale),
        // Render space is y-down from the page top; PDF doc space is y-up.
        y: Math.round((source.docOrigin.y - maxY) * scale),
        width: canvas.width,
        height: canvas.height,
      },
      "high",
    );
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const image = await loadImageSource(source.fileBytes, source.fileName, source.mimeType);
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    context.scale(scale, scale);
    context.translate(-minX, -minY);
    image.draw(context, image.width, image.height);
  }

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  knockOutWhite(pixels.data);
  // An all-paper (or mis-rendered) area would paste as an empty box; report it instead.
  if (!hasInk(pixels.data)) throw new Error("nothing but blank paper in that area");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.putImageData(pixels, 0, 0);

  // The image's own top-left, top-right, bottom-right, bottom-left corners in doc space.
  const top = source.fileType === "pdf" ? maxY : minY;
  const bottom = source.fileType === "pdf" ? minY : maxY;
  return {
    image: canvas.toDataURL("image/png"),
    points: [
      { x: minX, y: top },
      { x: maxX, y: top },
      { x: maxX, y: bottom },
      { x: minX, y: bottom },
    ],
  };
}
