import type { DocumentRotation, Point2D, Scale } from "@/app/types";

// Kept free of runtime imports so its test can load it directly.

/** The page a markup is on. Files from before multi-page PDFs have no `page`: they are all on page 1. */
export function pageOf(markup: { page?: number }): number {
  return markup.page ?? 0;
}

const pageLists = new WeakMap<object, Map<number, unknown[]>>();

/**
 * The markups on `page`. Same input gives the same array, or every reader's effects and
 * memos would re-run on every dispatch. A one-page document returns the list itself.
 */
export function markupsOnPage<T extends { page?: number }>(list: T[], page: number, pageCount: number): T[] {
  if (pageCount <= 1) return list;
  let byPage = pageLists.get(list);
  if (!byPage) {
    byPage = new Map();
    pageLists.set(list, byPage);
  }
  let filtered = byPage.get(page) as T[] | undefined;
  if (!filtered) {
    filtered = list.filter((markup) => pageOf(markup) === page);
    byPage.set(page, filtered);
  }
  return filtered;
}

/** Pages that have at least one markup, calibration lines included. */
export function pagesWithMarkups(lists: { page?: number }[][]): Set<number> {
  return new Set(lists.flat().map(pageOf));
}

/** The file's own label for a page ("A-101"), when it says more than the page number. */
export function fileLabel(page: number, pageLabels: string[] | null): string | null {
  const label = pageLabels?.[page];
  return label && label !== String(page + 1) ? label : null;
}

/** The calibrated sheet closest to `page` in the shown list; on a tie, the earlier one. */
export function nearestCalibratedSheet(
  sheets: number[],
  scales: Record<number, Scale>,
  page: number,
): number | null {
  const here = sheets.indexOf(page);
  let nearest: number | null = null;
  let nearestGap = Infinity;
  sheets.forEach((sheet, index) => {
    const gap = Math.abs(index - here);
    if (sheet !== page && scales[sheet] && gap < nearestGap) {
      nearest = sheet;
      nearestGap = gap;
    }
  });
  return nearest;
}

/** Doc-space direction that reads as "up" on screen, for a PDF page shown at this rotation. */
export function screenUpForRotation(rotation: DocumentRotation): Point2D {
  if (rotation === 90) return { x: -1, y: 0 };
  if (rotation === 180) return { x: 0, y: -1 };
  if (rotation === 270) return { x: 1, y: 0 };
  return { x: 0, y: 1 };
}

interface SavedPageFields {
  scale?: Scale | null;
  rotation?: DocumentRotation;
  scales?: Record<number, Scale>;
  rotations?: Record<number, DocumentRotation>;
  page?: number;
  sheets?: number[] | null;
}

/**
 * Per-page state from any saved form (.mkup, PDF). Files saved before
 * multi-page PDFs only have one `scale` and `rotation`, which belong to page 1. `sheets`
 * stays null for them, so a multi-page PDF asks which pages to show.
 */
export function withPages(data: SavedPageFields): {
  scales: Record<number, Scale>;
  rotations: Record<number, DocumentRotation>;
  page: number;
  sheets: number[] | null;
} {
  return {
    scales: data.scales ?? (data.scale ? { 0: data.scale } : {}),
    rotations: data.rotations ?? (data.rotation === undefined ? {} : { 0: data.rotation }),
    page: data.page ?? 0,
    sheets: data.sheets ?? null,
  };
}
