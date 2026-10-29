// Kept free of runtime imports so `node app/utils/snapshot.test.mjs` can load it directly.

/** Lightness at or above this becomes fully transparent ("paper"). */
const WHITE = 235;
/** Below this a pixel is fully kept; between the two, alpha ramps for smooth edges. */
const SOLID = 205;

/** True when any pixel is clearly visible after the knockout. */
export function hasInk(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 64) return true;
  }
  return false;
}

/**
 * Makes near-white pixels transparent in place, so a snapshot keeps only the linework.
 * shortcut: fixed white threshold; add a sensitivity slider if scans on grey/yellow paper leave a tint.
 */
export function knockOutWhite(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const lightness = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (lightness >= WHITE) {
      rgba[i + 3] = 0;
    } else if (lightness > SOLID) {
      rgba[i + 3] = Math.round((rgba[i + 3] * (WHITE - lightness)) / (WHITE - SOLID));
    }
  }
}
