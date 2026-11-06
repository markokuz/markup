/** Low enough to fit a big scan on screen: 5% shows a 20,000 px wide image in 1,000 px. */
const MIN_ZOOM = 0.05;
/** High enough to read small print on a dense drawing sheet. */
const MAX_ZOOM = 16;

/** Stops for the toolbar's + and − buttons. */
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];

export function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

/**
 * Zoom that fits the page in the scroll area. Rounds down, since rounding up would
 * overflow by a pixel and bring the scrollbars back.
 */
export function fitZoom(
  mode: "page" | "width",
  page: { width: number; height: number },
  area: { width: number; height: number },
): number {
  const across = area.width / page.width;
  const zoom = mode === "width" ? across : Math.min(across, area.height / page.height);
  return clampZoom(Math.floor(zoom * 100) / 100);
}

/** Zoom a newly opened image starts at: fits the area, but small images stay at actual size. */
export function openingImageZoom(
  image: { width: number; height: number },
  rotation: number,
  area: { width: number; height: number },
): number {
  // An area with no size yet can't be fitted to.
  if (area.width <= 0 || area.height <= 0) return 1;
  const sideways = rotation === 90 || rotation === 270;
  const page = sideways ? { width: image.height, height: image.width } : image;
  return Math.min(1, fitZoom("page", page, area));
}

/** The next button stop above (`direction` 1) or below (-1) `zoom`. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > zoom + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001);
  return next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM);
}
