"use client";

import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

const PDFJS_BASE = "/pdfjs";

export function getPdfDocumentOptions(data: Uint8Array): DocumentInitParameters {
  return {
    data,
    wasmUrl: `${PDFJS_BASE}/wasm/`,
  };
}

export const PDFJS_WORKER_SRC = "/pdf.worker.min.mjs";
