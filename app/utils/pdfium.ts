"use client";

import type { PdfiumRequest, PdfiumResponse } from "@/app/workers/pdfium.worker";

const PDFIUM_WASM_URL = "/pdfium/pdfium.wasm";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let nextRequestId = 1;
let nextDocId = 1;
const pending = new Map<
  number,
  { resolve: (bitmap: ImageBitmap | undefined) => void; reject: (err: Error) => void }
>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../workers/pdfium.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<PdfiumResponse>) => {
      const response = event.data;
      const callbacks = pending.get(response.id);
      if (!callbacks) return;
      pending.delete(response.id);
      if (response.ok) callbacks.resolve(response.bitmap);
      else callbacks.reject(new Error(response.error));
    };
  }
  return worker;
}

function call(request: DistributiveOmit<PdfiumRequest, "id">, transfer: Transferable[] = []) {
  const id = nextRequestId++;
  return new Promise<ImageBitmap | undefined>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...request, id }, transfer);
  });
}

// One PDFium document per tab's bytes; closed in the worker once the tab's
// bytes are garbage-collected.
const docIds = new WeakMap<Uint8Array, Promise<number>>();
const closeRegistry = new FinalizationRegistry<number>((docId) => {
  void call({ type: "close", docId }).catch(() => {});
});

function openDocument(bytes: Uint8Array) {
  let docId = docIds.get(bytes);
  if (!docId) {
    const id = nextDocId++;
    const copy = bytes.slice();
    docId = call({ type: "open", docId: id, bytes: copy.buffer, wasmUrl: PDFIUM_WASM_URL }, [
      copy.buffer,
    ]).then(() => id);
    docId.catch(() => docIds.delete(bytes));
    docIds.set(bytes, docId);
    closeRegistry.register(bytes, id);
  }
  return docId;
}

export interface PdfRegion {
  /** Clockwise rotation, as passed to pdf.js getViewport (absolute). */
  rotation: number;
  /** Output pixels per PDF point. */
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Job {
  priority: number;
  signal?: AbortSignal;
  start: () => Promise<unknown>;
  abort: () => void;
}

// One render at a time, so a visible-area request never waits behind more
// than one queued background strip.
const queue: Job[] = [];
let busy = false;

function pump() {
  if (busy) return;
  queue.sort((a, b) => b.priority - a.priority);
  let job = queue.shift();
  while (job?.signal?.aborted) {
    job.abort();
    job = queue.shift();
  }
  if (!job) return;
  busy = true;
  void job.start().finally(() => {
    busy = false;
    pump();
  });
}

function abortError() {
  return new DOMException("Render cancelled", "AbortError");
}

/**
 * Renders part of page 1 in the PDFium worker. "high" jobs (what is on screen)
 * jump ahead of "low" ones (background full-page strips).
 */
export function renderPdfRegion(
  bytes: Uint8Array,
  region: PdfRegion,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const job: Job = {
      priority: priority === "high" ? 1 : 0,
      signal,
      abort: () => reject(abortError()),
      start: async () => {
        try {
          const docId = await openDocument(bytes);
          if (signal?.aborted) throw abortError();
          const bitmap = await call({ type: "render", docId, ...region });
          if (!bitmap) throw new Error("PDFium returned no image");
          if (signal?.aborted) {
            bitmap.close();
            throw abortError();
          }
          resolve(bitmap);
        } catch (err) {
          reject(err);
        }
      },
    };
    queue.push(job);
    signal?.addEventListener("abort", () => {
      const index = queue.indexOf(job);
      if (index >= 0) {
        queue.splice(index, 1);
        job.abort();
      }
    });
    pump();
  });
}

export function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}
