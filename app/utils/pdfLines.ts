import { getPdfDocumentOptions, PDFJS_WORKER_SRC } from "@/app/utils/pdfjsConfig";
import { buildSegmentIndex, extractSegments, type SegmentIndex } from "@/app/utils/snapPoints";

/** Sheets of a file whose line work stays in memory; a dense one can take tens of megabytes. */
const MAX_SHEETS_KEPT = 6;

const cache = new WeakMap<Uint8Array, Map<number, Promise<SegmentIndex | null>>>();

/**
 * shortcut: opens the file again for each new sheet, since useDocument closes its pdf.js
 * task once it has the page sizes. Keep one task open if that shows up on huge files.
 */
async function readSheet(bytes: Uint8Array, page: number): Promise<SegmentIndex | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  const task = pdfjs.getDocument(getPdfDocumentOptions(bytes.slice()));
  try {
    const pdf = await task.promise;
    const operators = await (await pdf.getPage(page + 1)).getOperatorList();
    return buildSegmentIndex(extractSegments(operators, pdfjs.OPS));
  } catch {
    // Without the drawing's lines, snapping still has the markups: nothing here should stop the sheet opening.
    return null;
  } finally {
    void task.destroy();
  }
}

/** Drops a file's line work now: an erase replaced the file, and undo history still holds it. */
export function releaseSheetLines(bytes: Uint8Array) {
  cache.delete(bytes);
}

/** A sheet's line work, read once and in the background. Null if it can't be read. */
export function sheetLines(bytes: Uint8Array, page: number): Promise<SegmentIndex | null> {
  let sheets = cache.get(bytes);
  if (!sheets) {
    sheets = new Map();
    cache.set(bytes, sheets);
  }
  const known = sheets.get(page);
  // Re-inserted so the map's first entry is always the sheet least recently used.
  if (known) sheets.delete(page);
  const lines = known ?? readSheet(bytes, page);
  sheets.set(page, lines);
  if (sheets.size > MAX_SHEETS_KEPT) sheets.delete(sheets.keys().next().value as number);
  return lines;
}
