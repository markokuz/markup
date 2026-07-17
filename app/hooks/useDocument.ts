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

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsModule: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist");
    pdfjsModule.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }
  return pdfjsModule;
}

export function useDocument(
  fileBytes: Uint8Array | null,
  fileType: DocumentType | null,
  fileName: string | null,
  mimeType: string | null,
  zoom: number,
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

  const pageRef = useRef<PDFPageProxy | null>(null);
  const imageRef = useRef<ImageSource | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    if (!fileBytes || !fileType) {
      pageRef.current = null;
      imageRef.current = null;
      setViewport(null);
      setSourceReady(0);
      setError(null);
      return;
    }

    let cancelled = false;
    const bytes = fileBytes.slice();

    async function loadSource() {
      setLoading(true);
      setError(null);

      try {
        renderTaskRef.current?.cancel();

        if (fileType === "pdf") {
          const pdfjs = await getPdfJs();
          const pdf = await pdfjs.getDocument(
            getPdfDocumentOptions(bytes, pdfjs.version),
          ).promise;

          if (cancelled) return;

          const page = await pdf.getPage(1);
          pageRef.current = page;
          imageRef.current = null;
        } else {
          const image = await loadImageSource(bytes, fileName ?? "image", mimeType ?? "");
          if (cancelled) return;
          imageRef.current = image;
          pageRef.current = null;
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
      renderTaskRef.current?.cancel();
    };
  }, [fileBytes, fileType, fileName, mimeType]);

  useLayoutEffect(() => {
    if (!canvasElement || !fileBytes || !fileType || sourceReady === 0) {
      return;
    }

    const activeCanvas = canvasElement;
    let cancelled = false;

    async function renderDocument() {
      setLoading(true);
      setError(null);

      try {
        renderTaskRef.current?.cancel();

        const outputScale = window.devicePixelRatio || 1;
        let nextViewport: DocumentViewport;

        if (fileType === "pdf") {
          const page = pageRef.current;
          if (!page) return;

          const pdfViewport = page.getViewport({ scale: zoom });
          nextViewport = createPdfViewport(
            pdfViewport.width,
            pdfViewport.height,
            page.getViewport({ scale: 1 }).height,
            (x, y) => pdfViewport.convertToPdfPoint(x, y) as [number, number],
            (x, y) => pdfViewport.convertToViewportPoint(x, y) as [number, number],
          );

          activeCanvas.width = Math.floor(pdfViewport.width * outputScale);
          activeCanvas.height = Math.floor(pdfViewport.height * outputScale);
          activeCanvas.style.width = `${pdfViewport.width}px`;
          activeCanvas.style.height = `${pdfViewport.height}px`;

          const renderTask = page.render({
            canvas: activeCanvas,
            viewport: pdfViewport,
            transform:
              outputScale !== 1
                ? [outputScale, 0, 0, outputScale, 0, 0]
                : undefined,
          });

          renderTaskRef.current = renderTask;
          await renderTask.promise;
        } else {
          const image = imageRef.current;
          if (!image) return;

          nextViewport = createImageViewport(image.width, image.height, zoom);

          activeCanvas.width = Math.floor(nextViewport.width * outputScale);
          activeCanvas.height = Math.floor(nextViewport.height * outputScale);
          activeCanvas.style.width = `${nextViewport.width}px`;
          activeCanvas.style.height = `${nextViewport.height}px`;

          const context = activeCanvas.getContext("2d");
          if (!context) return;

          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
          context.clearRect(0, 0, nextViewport.width, nextViewport.height);
          image.draw(context, nextViewport.width, nextViewport.height);
        }

        if (!cancelled) {
          setViewport(nextViewport);
        }
      } catch (err) {
        if (
          !cancelled &&
          !(err instanceof Error && err.message.toLowerCase().includes("cancel"))
        ) {
          setError(err instanceof Error ? err.message : "Failed to render file");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void renderDocument();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [fileBytes, fileType, zoom, canvasElement, sourceReady]);

  return { canvasRef, viewport, loading, error };
}
