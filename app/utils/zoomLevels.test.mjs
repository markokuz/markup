// Run: node app/utils/zoomLevels.test.mjs
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { clampZoom, fitZoom, openingImageZoom, stepZoom } = await jiti.import("./zoomLevels.ts");

const sheet = { width: 2592, height: 1728 };

// The limiting side decides, and the result never overflows.
assert.equal(fitZoom("page", sheet, { width: 1296, height: 1728 }), 0.5);
assert.equal(fitZoom("page", sheet, { width: 2592, height: 864 }), 0.5);
assert.equal(fitZoom("width", sheet, { width: 1296, height: 100 }), 0.5);
assert.ok(fitZoom("page", sheet, { width: 1000, height: 1000 }) * sheet.width <= 1000);

// Stays inside the app's zoom limits.
assert.equal(fitZoom("page", sheet, { width: 10, height: 10 }), 0.05);
assert.equal(fitZoom("page", { width: 10, height: 10 }, { width: 5000, height: 5000 }), 16);

// A big image shrinks to fit, even well below the old 25% floor.
const area = { width: 1000, height: 600 };
assert.equal(openingImageZoom({ width: 2000, height: 1000 }, 0, area), 0.5);
const scan = { width: 12000, height: 8000 };
assert.equal(openingImageZoom(scan, 0, area), 0.07);
assert.ok(openingImageZoom(scan, 0, area) * scan.height <= area.height);

// A small image stays at actual size.
assert.equal(openingImageZoom({ width: 300, height: 200 }, 0, area), 1);

// A rotated image fits by its turned shape.
assert.equal(openingImageZoom({ width: 1000, height: 2000 }, 270, area), 0.5);
assert.equal(openingImageZoom({ width: 1000, height: 2000 }, 0, area), 0.3);

// An area with no size yet keeps actual size instead of the smallest zoom.
assert.equal(openingImageZoom(scan, 0, { width: -48, height: -48 }), 1);

// The controls can leave and return to very low zooms: the wheel's rounding can't get stuck.
assert.equal(stepZoom(0.25, -1), 0.1);
assert.equal(stepZoom(0.05, -1), 0.05);
assert.equal(stepZoom(0.07, 1), 0.1);
let wheel = 0.05;
for (let i = 0; i < 40; i += 1) wheel = clampZoom(wheel * 1.1);
assert.ok(wheel > 1);

console.log("zoomLevels tests passed");
