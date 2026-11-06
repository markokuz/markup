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
/** Highest zoom the master is rendered for; PdfDetailLayer sharpens the visible area above it. */
const MAX_MASTER_ZOOM = 4;
/**
 * Images: the canvas stops gaining pixels past this zoom and is stretched instead.
 * A photo has no more detail to show, and a canvas sized for 16× would pass the
 * browser's canvas size limit and go blank.
 */
const MAX_IMAGE_BACKING_ZOOM = 4;
/**
 * Images have no PdfDetailLayer, so this stays well above the PDF budget or big scans
 * would blur. Past it browsers draw blank (seen at 432 MP) or freeze (6 s at 192 MP).
 */
const MAX_IMAGE_CANVAS_PIXELS = 100_000_000;
/** The master is rendered in strips so on-screen renders can cut in between. */
const STRIP_PIXELS = 2_000_000;

interface NaturalSize {
  width: number;
  height: number;
  /** The page's own clockwise turn (PDF /Rotate); 0 for images. */
  pageRotation: number;
}

interface PageInfo {
  pageCount: number;
  /** The file's own page labels ("A-101"), if it has them. */
  pageLabels: string[] | null;
}

interface CachedSource extends PageInfo {
  page: PDFPageProxy | null;
  image: ImageSource | null;
  naturalSize: NaturalSize;
  /**
   * Full-page PDF render at `scale` device px per doc unit. Rendered once per
   * rotation; every zoom (and every return to the tab) is just a scaled copy,
   * because heavy CAD sheets take seconds per render whatever the size.
   */
  bitmap: { canvas: HTMLCanvasElement; rotation: number; scale: number } | null;
}

interface CachedFile {
  /** Per page; an image only has page 0. */
  sources: Map<number, CachedSource>;
  /** Pages holding a master, oldest first. */
  masters: number[];
  /** Content hash for the between-sessions render cache (PDF only). */
  hash?: Promise<string | null>;
}

/** Masters kept in memory per file. At up to 64 MB each, the rest reload from the render cache. */
const MAX_MASTERS = 3;

// Keyed by the tab's bytes so a closed tab's entries are garbage-collected with it.
const fileCache = new WeakMap<Uint8Array, CachedFile>();

function cachedFile(bytes: Uint8Array): CachedFile {
  let file = fileCache.get(bytes);
  if (!file) {
    file = { sources: new Map(), masters: [] };
    fileCache.set(bytes, file);
  }
  return file;
}

/** Marks `page`'s master as just used, freeing the oldest beyond the limit. */
function keepMaster(file: CachedFile, page: number) {
  file.masters = [...file.masters.filter((p) => p !== page), page];
  while (file.masters.length > MAX_MASTERS) {
    const oldest = file.masters.shift()!;
    const source = file.sources.get(oldest);
    if (source) source.bitmap = null;
  }
}

interface OpenPdf extends PageInfo {
  pages: Promise<PDFPageProxy>[];
}

const openPdfs = new WeakMap<Uint8Array, Promise<OpenPdf>>();

/**
 * Every page's geometry, read once per file. All pages are asked for up front so the
 * pdf.js task can be destroyed, and switching sheets never parses the file again.
 */
function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  let opened = openPdfs.get(bytes);
  if (!opened) {
    opened = (async () => {
      const pdfjs = await getPdfJs();
      const task = pdfjs.getDocument(getPdfDocumentOptions(bytes.slice()));
      let pdf;
      try {
        pdf = await task.promise;
      } catch (err) {
        void task.destroy();
        throw err;
      }
      const pages = Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1));
      const labels = pdf.getPageLabels().catch(() => null);
      // PDFium does the rendering; the pages' size data outlives this. Otherwise every
      // PDF ever opened keeps a worker thread and a copy of the file.
      void Promise.allSettled([...pages, labels]).finally(() => task.destroy());
      return { pageCount: pdf.numPages, pageLabels: await labels, pages };
    })();
    opened.catch(() => openPdfs.delete(bytes));
    openPdfs.set(bytes, opened);
  }
  return opened;
}

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
  /** Zero-based page to show; images only have page 0. */
  page = 0,
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
  /** Unrotated page size in doc units (and the page's own turn), known once the source has loaded. */
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(
    null,
  );
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  const pageRef = useRef<PDFPageProxy | null>(null);
  const imageRef = useRef<ImageSource | null>(null);

  // Layout effect so a cached tab is drawn before the first paint.
  useLayoutEffect(() => {
    if (!fileBytes || !fileType) {
      pageRef.current = null;
      imageRef.current = null;
      setViewport(null);
      setNaturalSize(null);
      setPageInfo(null);
      setSourceReady(0);
      setError(null);
      return;
    }

    const cached = cachedFile(fileBytes).sources.get(page);
    if (cached) {
      pageRef.current = cached.page;
      imageRef.current = cached.image;
      setNaturalSize(cached.naturalSize);
      setPageInfo({ pageCount: cached.pageCount, pageLabels: cached.pageLabels });
      setSourceReady((version) => version + 1);
      return;
    }

    let cancelled = false;
    const cacheKey = fileBytes;

    async function loadSource() {
      setLoading(true);
      setError(null);

      try {
        if (fileType === "pdf") {
          const pdf = await openPdf(cacheKey);
          if (cancelled) return;
          const info = { pageCount: pdf.pageCount, pageLabels: pdf.pageLabels };
          setPageInfo(info);

          const pdfPage = await pdf.pages[page];
          // Past the end: the page count just given moves the tab to a page that exists.
          if (cancelled || !pdfPage) return;
          pageRef.current = pdfPage;
          imageRef.current = null;
          // rotation: 0 is absolute in pdf.js, so this is the media box before /Rotate.
          const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
          const size = { width: base.width, height: base.height, pageRotation: pdfPage.rotate };
          cachedFile(cacheKey).sources.set(page, {
            ...info,
            page: pdfPage,
            image: null,
            naturalSize: size,
            bitmap: null,
          });
          setNaturalSize(size);
        } else {
          const image = await loadImageSource(cacheKey.slice(), fileName ?? "image", mimeType ?? "");
          if (cancelled) return;
          imageRef.current = image;
          pageRef.current = null;
          const size = { width: image.width, height: image.height, pageRotation: 0 };
          const info = { pageCount: 1, pageLabels: null };
          cachedFile(cacheKey).sources.set(page, { ...info, page: null, image, naturalSize: size, bitmap: null });
          setPageInfo(info);
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
  }, [fileBytes, fileType, fileName, mimeType, page]);

  // PDF master: one full-page render per rotation, independent of zoom, so
  // zooming never restarts it.
  useEffect(() => {
    if (fileType !== "pdf" || !fileBytes || sourceReady === 0 || holdRender) return;
    const file = cachedFile(fileBytes);
    const cache = file.sources.get(page);
    const pdfPage = pageRef.current;
    if (!cache || !pdfPage) return;

    const base = pdfPage.getViewport({ scale: 1, rotation });
    const scale = Math.min(
      MAX_MASTER_ZOOM * (window.devicePixelRatio || 1),
      Math.sqrt(MAX_BASE_PIXELS / (base.width * base.height)),
    );
    if (cache.bitmap?.rotation === rotation && cache.bitmap.scale === scale) {
      keepMaster(file, page);
      return;
    }

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

      file.hash ??= hashFile(bytes);
      const hash = await file.hash;
      const key = hash && `${hash}:p${page + 1}:r${rotation}:s${scale.toFixed(4)}`;
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
            { page, rotation, scale, x: 0, y, width, height: Math.min(stripHeight, height - y) },
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
      keepMaster(file, page);
      setMasterVersion((version) => version + 1);
      setLoading(false);
    }

    renderMaster(cache).catch((err) => {
      if (signal.aborted || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to render file");
      setLoading(false);
    });

    return () => controller.abort();
  }, [fileBytes, fileType, page, rotation, sourceReady, holdRender]);

  // Display at the current zoom: synchronous, so zoom and tab switches land in
  // the same frame. A PDF shows its master scaled; until a master for this
  // rotation exists the canvas keeps its old pixels, stretched.
  useLayoutEffect(() => {
    if (!canvasElement || !fileBytes || !fileType || sourceReady === 0 || holdRender) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;

    if (fileType === "pdf") {
      const pdfPage = pageRef.current;
      if (!pdfPage) return;

      const pdfViewport = pdfPage.getViewport({ scale: zoom, rotation });
      canvasElement.style.width = `${pdfViewport.width}px`;
      canvasElement.style.height = `${pdfViewport.height}px`;
      setViewport(
        createPdfViewport(
          pdfViewport.width,
          pdfViewport.height,
          // page.view is the crop box; drawings often start away from (0,0).
          { x: pdfPage.view[0], y: pdfPage.view[3] },
          (x, y) => pdfViewport.convertToPdfPoint(x, y) as [number, number],
          (x, y) => pdfViewport.convertToViewportPoint(x, y) as [number, number],
        ),
      );

      const master = cachedFile(fileBytes).sources.get(page)?.bitmap;
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

    // Canvas px per CSS px: the screen's density, less once zoomed past the image's useful detail.
    const backing = Math.min(
      (Math.min(zoom, MAX_IMAGE_BACKING_ZOOM) * dpr) / zoom,
      Math.sqrt(MAX_IMAGE_CANVAS_PIXELS / (nextViewport.width * nextViewport.height)),
    );
    canvasElement.width = Math.floor(nextViewport.width * backing);
    canvasElement.height = Math.floor(nextViewport.height * backing);
    canvasElement.style.width = `${nextViewport.width}px`;
    canvasElement.style.height = `${nextViewport.height}px`;

    const context = canvasElement.getContext("2d");
    if (!context) return;

    context.setTransform(backing, 0, 0, backing, 0, 0);
    // A fitted big scan shrinks a lot: the default smoothing drops thin lines.
    context.imageSmoothingQuality = "high";
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
  }, [fileBytes, fileType, page, zoom, rotation, canvasElement, sourceReady, holdRender, masterVersion]);

  return {
    canvasRef,
    canvasElement,
    viewport,
    naturalSize,
    pageInfo,
    loading,
    error,
    renderVersion,
    baseSharp,
  };
}
