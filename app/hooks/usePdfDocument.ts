"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PageViewport, PDFPageProxy } from "pdfjs-dist";
import {
  getPdfDocumentOptions,
  PDFJS_WORKER_SRC,
} from "@/app/utils/pdfjsConfig";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsModule: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist");
    pdfjsModule.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }
  return pdfjsModule;
}

export function usePdfDocument(pdfBytes: Uint8Array | null, zoom: number) {
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasElement(node);
  }, []);

  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageReady, setPageReady] = useState(0);

  const pageRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    if (!pdfBytes) {
      pageRef.current = null;
      setViewport(null);
      setPageHeight(0);
      setPageReady(0);
      setError(null);
      return;
    }

    let cancelled = false;
    const bytes = pdfBytes.slice();

    async function loadDocument() {
      setLoading(true);
      setError(null);

      try {
        const pdfjs = await getPdfJs();
        renderTaskRef.current?.cancel();

        const pdf = await pdfjs.getDocument(
          getPdfDocumentOptions(bytes, pdfjs.version),
        ).promise;

        if (cancelled) return;

        const page = await pdf.getPage(1);
        pageRef.current = page;
        setPageHeight(page.getViewport({ scale: 1 }).height);
        setPageReady((version) => version + 1);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setLoading(false);
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfBytes]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !canvasElement || !pdfBytes || pageReady === 0) {
      return;
    }

    const activePage = page;
    const activeCanvas = canvasElement;
    let cancelled = false;

    async function renderPage() {
      setLoading(true);
      setError(null);

      try {
        renderTaskRef.current?.cancel();

        const vp = activePage.getViewport({ scale: zoom });
        const outputScale = window.devicePixelRatio || 1;

        activeCanvas.width = Math.floor(vp.width * outputScale);
        activeCanvas.height = Math.floor(vp.height * outputScale);
        activeCanvas.style.width = `${vp.width}px`;
        activeCanvas.style.height = `${vp.height}px`;

        const renderTask = activePage.render({
          canvas: activeCanvas,
          viewport: vp,
          transform:
            outputScale !== 1
              ? [outputScale, 0, 0, outputScale, 0, 0]
              : undefined,
        });

        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (!cancelled) {
          setViewport(vp);
        }
      } catch (err) {
        if (
          !cancelled &&
          !(err instanceof Error && err.message.toLowerCase().includes("cancel"))
        ) {
          setError(err instanceof Error ? err.message : "Failed to render PDF");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfBytes, zoom, canvasElement, pageReady]);

  return { canvasRef, viewport, pageHeight, loading, error };
}
