"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { DocumentType } from "@/app/types";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import {
  createImageViewport,
  createPdfViewport,
} from "@/app/utils/documentViewport";
import { loadImageSource, type ImageSource } from "@/app/utils/loadImage";
import {
  getPdfDocumentOptions,
  PDFJS_WORKER_SRC,
} from "@/app/utils/pdfjsConfig";
import { isAbortError, renderPdfRegion } from "@/app/utils/pdfium";
import { hashFile, loadCachedRender, saveCachedRender } from "@/app/utils/renderCache";
import { showSaveStatus } from "@/app/utils/saveStatus";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsModule: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist");
    pdfjsModule.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }
  return pdfjsModule;
}

/** Pixel budget for the one-off full-page PDF render (pdf.js's default
 * maxCanvasPixels). Above its resolution PdfDetailLayer sharpens the visible area. */
const MAX_BASE_PIXELS = 16_777_216;
/** Highest zoom the master is ever needed at (PdfCanvas MAX_ZOOM). */
const MAX_MASTER_ZOOM = 4;
/** The master is rendered in strips so on-screen renders can cut in between. */
const STRIP_PIXELS = 2_000_000;

interface CachedSource {
  page: PDFPageProxy | null;
  image: ImageSource | null;
  naturalSize: { width: number; height: number };
  /**
   * Full-page PDF render at `scale` device px per doc unit. Rendered once per
   * rotation; every zoom (and every return to the tab) is just a scaled copy,
   * because heavy CAD sheets take seconds per render whatever the size.
   */
  bitmap: { canvas: HTMLCanvasElement; rotation: number; scale: number } | null;
  /** Content hash for the between-sessions render cache (PDF only). */
  hash?: Promise<string | null>;
}

// Keyed by the tab's bytes so a closed tab's entry is garbage-collected with it.
const sourceCache = new WeakMap<Uint8Array, CachedSource>();

function drawScaled(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  width: number,
  height: number,
) {
  target.width = Math.floor(width);
  target.height = Math.floor(height);
  const context = target.getContext("2d");
  if (!context) return;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, target.width, target.height);
}

export function useDocument(
  fileBytes: Uint8Array | null,
  fileType: DocumentType | null,
  fileName: string | null,
  mimeType: string | null,
  zoom: number,
  rotation: import("@/app/types").DocumentRotation = 0,
  /** Skip rendering (e.g. until auto-orientation has picked a rotation). */
  holdRender = false,
) {
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasElement(node);
  }, []);

  const [viewport, setViewport] = useState<DocumentViewport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(0);
  /** Bumped whenever the canvas pixels change (for minimap / detail layer). */
  const [renderVersion, setRenderVersion] = useState(0);
  /** Bumped when a new PDF master bitmap is in the cache. */
  const [masterVersion, setMasterVersion] = useState(0);
  /** Canvas holds the full page at device resolution (no detail layer needed). */
  const [baseSharp, setBaseSharp] = useState(false);
  /** Unrotated page size in doc units, known once the source has loaded. */
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const pageRef = useRef<PDFPageProxy | null>(null);
  const imageRef = useRef<ImageSource | null>(null);

  // Layout effect so a cached tab is drawn before the first paint.
  useLayoutEffect(() => {
    if (!fileBytes || !fileType) {
      pageRef.current = null;
      imageRef.current = null;
      setViewport(null);
      setNaturalSize(null);
      setSourceReady(0);
      setError(null);
      return;
    }

    const cached = sourceCache.get(fileBytes);
    if (cached) {
      pageRef.current = cached.page;
      imageRef.current = cached.image;
      setNaturalSize(cached.naturalSize);
      setSourceReady((version) => version + 1);
      return;
    }

    let cancelled = false;
    const bytes = fileBytes.slice();
    const cacheKey = fileBytes;

    async function loadSource() {
      setLoading(true);
      setError(null);

      try {
        if (fileType === "pdf") {
          const pdfjs = await getPdfJs();
          const pdf = await pdfjs.getDocument(
            getPdfDocumentOptions(bytes, pdfjs.version),
          ).promise;

          if (cancelled) return;

          const page = await pdf.getPage(1);
          if (cancelled) return;
          if (pdf.numPages > 1) {
            showSaveStatus("info", `This PDF has ${pdf.numPages} pages; only page 1 is shown.`);
          }
          pageRef.current = page;
          imageRef.current = null;
          const base = page.getViewport({ scale: 1 });
          const size = { width: base.width, height: base.height };
          sourceCache.set(cacheKey, { page, image: null, naturalSize: size, bitmap: null });
          setNaturalSize(size);
        } else {
          const image = await loadImageSource(bytes, fileName ?? "image", mimeType ?? "");
          if (cancelled) return;
          imageRef.current = image;
          pageRef.current = null;
          const size = { width: image.width, height: image.height };
          sourceCache.set(cacheKey, { page: null, image, naturalSize: size, bitmap: null });
          setNaturalSize(size);
        }

        setSourceReady((version) => version + 1);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file");
          setLoading(false);
        }
      }
    }

    void loadSource();

    return () => {
      cancelled = true;
    };
  }, [fileBytes, fileType, fileName, mimeType]);

  // PDF master: one full-page render per rotation, independent of zoom, so
  // zooming never restarts it.
  useEffect(() => {
    if (fileType !== "pdf" || !fileBytes || sourceReady === 0 || holdRender) return;
    const cache = sourceCache.get(fileBytes);
    const page = pageRef.current;
    if (!cache || !page) return;

    const base = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(
      MAX_MASTER_ZOOM * (window.devicePixelRatio || 1),
      Math.sqrt(MAX_BASE_PIXELS / (base.width * base.height)),
    );
    if (cache.bitmap?.rotation === rotation && cache.bitmap.scale === scale) return;

    const controller = new AbortController();
    const { signal } = controller;
    const bytes = fileBytes;
    const width = Math.floor(base.width * scale);
    const height = Math.floor(base.height * scale);
    setLoading(true);
    setError(null);

    async function renderMaster(entry: CachedSource) {
      const master = document.createElement("canvas");
      master.width = width;
      master.height = height;
      const context = master.getContext("2d");
      if (!context) return;

      entry.hash ??= hashFile(bytes);
      const hash = await entry.hash;
      const key = hash && `${hash}:p1:r${rotation}:s${scale.toFixed(4)}`;
      const saved = key ? await loadCachedRender(key) : null;
      if (signal.aborted) return;

      if (saved) {
        const image = await createImageBitmap(saved);
        context.drawImage(image, 0, 0);
        image.close();
      } else {
        const stripHeight = Math.max(1, Math.floor(STRIP_PIXELS / width));
        for (let y = 0; y < height; y += stripHeight) {
          const strip = await renderPdfRegion(
            bytes,
            { rotation, scale, x: 0, y, width, height: Math.min(stripHeight, height - y) },
            "low",
            signal,
          );
          context.drawImage(strip, 0, y);
          strip.close();
        }
        if (key) master.toBlob((blob) => blob && void saveCachedRender(key, blob), "image/png");
      }
      if (signal.aborted) return;

      entry.bitmap = { canvas: master, rotation, scale };
      setMasterVersion((version) => version + 1);
      setLoading(false);
    }

    renderMaster(cache).catch((err) => {
      if (signal.aborted || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to render file");
      setLoading(false);
    });

    return () => controller.abort();
  }, [fileBytes, fileType, rotation, sourceReady, holdRender]);

  // Display at the current zoom: synchronous, so zoom and tab switches land in
  // the same frame. A PDF shows its master scaled; until a master for this
  // rotation exists the canvas keeps its old pixels, stretched.
  useLayoutEffect(() => {
    if (!canvasElement || !fileBytes || !fileType || sourceReady === 0 || holdRender) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;

    if (fileType === "pdf") {
      const page = pageRef.current;
      if (!page) return;

      const pdfViewport = page.getViewport({ scale: zoom, rotation });
      canvasElement.style.width = `${pdfViewport.width}px`;
      canvasElement.style.height = `${pdfViewport.height}px`;
      setViewport(
        createPdfViewport(
          pdfViewport.width,
          pdfViewport.height,
          // page.view is the crop box; drawings often start away from (0,0).
          { x: page.view[0], y: page.view[3] },
          (x, y) => pdfViewport.convertToPdfPoint(x, y) as [number, number],
          (x, y) => pdfViewport.convertToViewportPoint(x, y) as [number, number],
        ),
      );

      const master = sourceCache.get(fileBytes)?.bitmap;
      if (!master || master.rotation !== rotation) {
        // Old pixels in another orientation would look wrong; PdfDetailLayer
        // paints the visible area until the master lands.
        canvasElement.getContext("2d")?.clearRect(0, 0, canvasElement.width, canvasElement.height);
        setBaseSharp(false);
        return;
      }
      // Never upscale the master: PdfDetailLayer adds sharpness beyond it.
      const outputScale = Math.min(zoom * dpr, master.scale);
      drawScaled(
        canvasElement,
        master.canvas,
        (pdfViewport.width / zoom) * outputScale,
        (pdfViewport.height / zoom) * outputScale,
      );
      setBaseSharp(outputScale >= zoom * dpr * 0.99);
      setRenderVersion((version) => version + 1);
      return;
    }

    const image = imageRef.current;
    if (!image) return;
    const nextViewport = createImageViewport(image.width, image.height, zoom, rotation);

    canvasElement.width = Math.floor(nextViewport.width * dpr);
    canvasElement.height = Math.floor(nextViewport.height * dpr);
    canvasElement.style.width = `${nextViewport.width}px`;
    canvasElement.style.height = `${nextViewport.height}px`;

    const context = canvasElement.getContext("2d");
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, nextViewport.width, nextViewport.height);
    context.save();
    context.translate(nextViewport.width / 2, nextViewport.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.translate((-image.width * zoom) / 2, (-image.height * zoom) / 2);
    image.draw(context, image.width * zoom, image.height * zoom);
    context.restore();

    setViewport(nextViewport);
    setRenderVersion((version) => version + 1);
    setLoading(false);
  }, [fileBytes, fileType, zoom, rotation, canvasElement, sourceReady, holdRender, masterVersion]);

  return {
    canvasRef,
    canvasElement,
    viewport,
    naturalSize,
    loading,
    error,
    renderVersion,
    baseSharp,
  };
}
