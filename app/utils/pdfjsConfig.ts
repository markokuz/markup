"use client";

import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

const PDFJS_BASE = "/pdfjs";

export function getPdfDocumentOptions(
  data: Uint8Array,
  version: string,
): DocumentInitParameters {
  return {
    data,
    wasmUrl: `${PDFJS_BASE}/wasm/`,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${version}/standard_fonts/`,
  };
}

export const PDFJS_WORKER_SRC = "/pdf.worker.min.mjs";
