// Run: node app/utils/snapshot.test.mjs
import assert from "node:assert/strict";
import { hasInk, knockOutWhite } from "./snapshotPixels.ts";

const px = new Uint8ClampedArray([
  255, 255, 255, 255, // white paper -> transparent
  0, 0, 0, 255, // black ink -> kept
  220, 220, 220, 255, // light grey edge -> half
  255, 0, 0, 255, // pure red markup (min channel 0) -> kept
  240, 240, 200, 255, // yellowish paper, blue channel 200 -> kept (below ramp)
]);
knockOutWhite(px);
assert.equal(px[3], 0);
assert.equal(px[7], 255);
assert.equal(px[11], 128);
assert.equal(px[15], 255);
assert.equal(px[19], 255);
assert.deepEqual([...px.slice(4, 7)], [0, 0, 0], "colour channels untouched");

assert.equal(hasInk(px), true);
const paper = new Uint8ClampedArray([250, 250, 250, 255, 255, 255, 255, 255]);
knockOutWhite(paper);
assert.equal(hasInk(paper), false);

console.log("snapshot: all checks passed");
