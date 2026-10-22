/// <reference lib="webworker" />
// Rasterizes PDF pages with PDFium off the main thread. pdf.js stays in charge
// of page geometry; this only produces pixels.

import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";

export type PdfiumRequest =
  | { id: number; type: "open"; docId: number; bytes: ArrayBuffer; wasmUrl: string }
  | {
      id: number;
      type: "render";
      docId: number;
      /** Clockwise page rotation as passed to pdf.js getViewport (absolute, replaces /Rotate). */
      rotation: number;
      /** Output pixels per PDF point. */
      scale: number;
      /** Region of the rotated, scaled page to render, in output pixels. */
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | { id: number; type: "close"; docId: number };

export type PdfiumResponse =
  | { id: number; ok: true; bitmap?: ImageBitmap }
  | { id: number; ok: false; error: string };

const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10; // RGBA instead of BGRA, ready for ImageData

// The package types leave out Emscripten's heap view (needs @types/emscripten).
function heap(pdfium: WrappedPdfiumModule) {
  return (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

let modulePromise: Promise<WrappedPdfiumModule> | null = null;
const docs = new Map<number, { doc: number; page: number; dataPtr: number }>();

function getModule(wasmUrl: string) {
  modulePromise ??= fetch(wasmUrl)
    .then((response) => response.arrayBuffer())
    .then((wasmBinary) => init({ wasmBinary }))
    .then((pdfium) => {
      pdfium.PDFiumExt_Init();
      return pdfium;
    });
  return modulePromise;
}

async function open(pdfium: WrappedPdfiumModule, docId: number, bytes: ArrayBuffer) {
  const { wasmExports } = pdfium.pdfium;
  const dataPtr = wasmExports.malloc(bytes.byteLength);
  heap(pdfium).set(new Uint8Array(bytes), dataPtr);
  const doc = pdfium.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, "");
  if (!doc) {
    wasmExports.free(dataPtr);
    throw new Error(`PDFium could not open the file (error ${pdfium.FPDF_GetLastError()})`);
  }
  const page = pdfium.FPDF_LoadPage(doc, 0);
  if (!page) {
    pdfium.FPDF_CloseDocument(doc);
    wasmExports.free(dataPtr);
    throw new Error("PDFium could not load page 1");
  }
  docs.set(docId, { doc, page, dataPtr });
}

async function render(
  pdfium: WrappedPdfiumModule,
  request: Extract<PdfiumRequest, { type: "render" }>,
) {
  const entry = docs.get(request.docId);
  if (!entry) throw new Error("PDF is not open");
  const { wasmExports } = pdfium.pdfium;
  const { scale, x, y, width, height } = request;

  // Page space here is PDFium's top-left view of the page (own /Rotate applied)
  // at 1 unit per point; rotate clockwise about it like pdf.js, scale, then
  // shift so the requested region lands at the bitmap origin. pdf.js treats the
  // requested rotation as absolute (it replaces /Rotate), so turn by the difference.
  const pageWidth = pdfium.FPDF_GetPageWidthF(entry.page);
  const pageHeight = pdfium.FPDF_GetPageHeightF(entry.page);
  const ownRotation = pdfium.FPDFPage_GetRotation(entry.page) * 90;
  const rotation = (((request.rotation - ownRotation) % 360) + 360) % 360;
  const [a, b, c, d, e, f] =
    rotation === 90
      ? [0, 1, -1, 0, pageHeight, 0]
      : rotation === 180
        ? [-1, 0, 0, -1, pageWidth, pageHeight]
        : rotation === 270
          ? [0, -1, 1, 0, 0, pageWidth]
          : [1, 0, 0, 1, 0, 0];

  const bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
  const matrixPtr = wasmExports.malloc(6 * 4);
  const clipPtr = wasmExports.malloc(4 * 4);
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    new Float32Array(heap(pdfium).buffer, matrixPtr, 6).set([
      a * scale,
      b * scale,
      c * scale,
      d * scale,
      e * scale - x,
      f * scale - y,
    ]);
    new Float32Array(heap(pdfium).buffer, clipPtr, 4).set([0, 0, width, height]);
    pdfium.FPDF_RenderPageBitmapWithMatrix(
      bitmap,
      entry.page,
      matrixPtr,
      clipPtr,
      FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER,
    );

    const stride = pdfium.FPDFBitmap_GetStride(bitmap);
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap);
    const pixels = new Uint8ClampedArray(width * height * 4);
    const memory = heap(pdfium);
    for (let row = 0; row < height; row++) {
      const start = buffer + row * stride;
      pixels.set(memory.subarray(start, start + width * 4), row * width * 4);
    }
    return createImageBitmap(new ImageData(pixels, width, height));
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap);
    wasmExports.free(matrixPtr);
    wasmExports.free(clipPtr);
  }
}

function close(pdfium: WrappedPdfiumModule, docId: number) {
  const entry = docs.get(docId);
  if (!entry) return;
  pdfium.FPDF_ClosePage(entry.page);
  pdfium.FPDF_CloseDocument(entry.doc);
  pdfium.pdfium.wasmExports.free(entry.dataPtr);
  docs.delete(docId);
}

let wasmUrl = "";

self.onmessage = async (event: MessageEvent<PdfiumRequest>) => {
  const request = event.data;
  const reply = (response: PdfiumResponse, transfer: Transferable[] = []) =>
    self.postMessage(response, transfer);
  try {
    if (request.type === "open") wasmUrl = request.wasmUrl;
    const pdfium = await getModule(wasmUrl);
    if (request.type === "open") {
      await open(pdfium, request.docId, request.bytes);
      reply({ id: request.id, ok: true });
    } else if (request.type === "render") {
      const bitmap = await render(pdfium, request);
      reply({ id: request.id, ok: true, bitmap }, [bitmap]);
    } else {
      close(pdfium, request.docId);
      reply({ id: request.id, ok: true });
    }
  } catch (err) {
    reply({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
