// Run: node app/utils/zoomAnchor.test.mjs
import assert from "node:assert/strict";
import { previewOrigin, scrollAfterZoom } from "./zoomAnchor.ts";

const PADDING = 24;
const start = (size, client) => Math.max(PADDING, (client - size) / 2);
const pointUnder = (scroll, anchor, size, client) => scroll + anchor - start(size, client);

// Zooming a page bigger than the window keeps the point under the cursor in place.
for (const [scroll, anchor, size, scale, client] of [
  [100, 200, 1000, 2, 500],
  [300, 50, 2000, 0.8, 700],
  [0, 350, 800, 1.5, 700],
]) {
  const next = scrollAfterZoom(scroll, anchor, size, scale, client);
  assert.ok(Math.abs(pointUnder(next, anchor, size * scale, client) - pointUnder(scroll, anchor, size, client) * scale) < 1e-9);
}

// Same when a centred page grows past the window: the old centring offset is allowed for.
const grown = scrollAfterZoom(0, 300, 400, 4, 700);
assert.equal(pointUnder(0, 300, 400, 700), 150);
assert.equal(pointUnder(grown, 300, 1600, 700), 600);

// Zooming with the anchor in the middle of the window keeps the page's middle there.
assert.equal(pointUnder(scrollAfterZoom(0, 350, 400, 4, 700), 350, 1600, 700), 800);

// Preview, where the page lands: its start plus origin * (1 - scale).
const landing = (scroll, anchor, size, scale, client) =>
  start(size, client) - scroll + previewOrigin(scroll, anchor, size, scale, client) * (1 - scale);

// Fits before and after: shrinks about its own middle, whatever the cursor does.
assert.equal(previewOrigin(0, 30, 400, 0.5, 700), 200);
assert.equal(landing(0, 30, 400, 0.5, 700), 250);
assert.equal(landing(0, 650, 400, 0.5, 700), 250);

// Bigger than the window and scrolled, shrinking to fit: lands dead centre too.
assert.equal(landing(150, 500, 1000, 0.5, 700), 100);

// Still doesn't fit afterwards: the point under the cursor stays put.
assert.equal(previewOrigin(100, 200, 1000, 2, 500), 276);
assert.equal(previewOrigin(100, 200, 1000, 0.8, 500), 276);

console.log("zoomAnchor: all checks passed");
