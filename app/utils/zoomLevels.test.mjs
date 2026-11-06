// Run: node app/utils/zoomLevels.test.mjs
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { fitZoom } = await jiti.import("./zoomLevels.ts");

const sheet = { width: 2592, height: 1728 };

// The limiting side decides, and the result never overflows.
assert.equal(fitZoom("page", sheet, { width: 1296, height: 1728 }), 0.5);
assert.equal(fitZoom("page", sheet, { width: 2592, height: 864 }), 0.5);
assert.equal(fitZoom("width", sheet, { width: 1296, height: 100 }), 0.5);
assert.ok(fitZoom("page", sheet, { width: 1000, height: 1000 }) * sheet.width <= 1000);

// Stays inside the app's zoom limits.
assert.equal(fitZoom("page", sheet, { width: 10, height: 10 }), 0.25);
assert.equal(fitZoom("page", { width: 10, height: 10 }, { width: 5000, height: 5000 }), 16);

console.log("zoomLevels tests passed");
