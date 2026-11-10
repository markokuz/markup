// Run: node app/utils/selection.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// No canvas in Node: text falls back to its estimated size, which is all these boxes need.
globalThis.document = { createElement: () => ({ getContext: () => null }) };

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { markupScreenBox, nearEllipseOutline } = await jiti.import("./selection.ts");
const { noteCardSize } = await jiti.import("./noteLayout.ts");

// Zoom 2, page offset by (10, 5).
const viewport = {
  width: 800,
  height: 600,
  docOrigin: { x: 0, y: 0 },
  convertToViewportPoint: (x, y) => ({ x: x * 2 + 10, y: y * 2 + 5 }),
};

function assertBox(markup, expected, label) {
  const box = markupScreenBox(markup, viewport);
  assert.ok(box, `${label}: no box`);
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(box[key] - expected[key]) < 1e-6, `${label}: ${key} is ${box[key]}, expected ${expected[key]}`);
  }
}

assertBox({ id: "m", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } }, { x: 10, y: 5, width: 20, height: 10 }, "line");

assertBox(
  { id: "r", topLeft: { x: 0, y: 0 }, bottomRight: { x: 10, y: 20 } },
  { x: 10, y: 5, width: 20, height: 40 },
  "rectangle",
);
// A quarter turn about its centre (20, 25) swaps width and height.
assertBox(
  { id: "r", topLeft: { x: 0, y: 0 }, bottomRight: { x: 10, y: 20 }, rotation: 90 },
  { x: 0, y: 15, width: 40, height: 20 },
  "turned rectangle",
);

const card = noteCardSize("Hi");
assertBox(
  { id: "n", position: { x: 5, y: 5 }, text: "Hi" },
  { x: 20, y: 15, ...card },
  "note: its card, at its screen size",
);

// A callout's box is its card only: the arrow tips (points 0 and 2) stay out of it.
const calloutCard = noteCardSize("Look");
assertBox(
  { id: "c", kind: "callout", text: "Look", points: [{ x: 300, y: 300 }, { x: 5, y: 5 }, { x: -50, y: -50 }] },
  { x: 20, y: 15, ...calloutCard },
  "callout",
);
assert.equal(markupScreenBox({ id: "c", kind: "callout", points: [{ x: 1, y: 1 }] }, viewport), null, "callout without a card");

assertBox(
  { id: "k", kind: "cloud", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
  { x: 10, y: 5, width: 20, height: 20 },
  "two-corner cloud",
);
assertBox(
  { id: "n", kind: "count", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
  { x: 10, y: 5, width: 10, height: 10 },
  "count",
);
assertBox(
  { id: "d", kind: "draw", points: [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 2, y: 8 }] },
  { x: 10, y: 5, width: 8, height: 16 },
  "drawing",
);
// Without a canvas the text box is 2 × the font size wide and one line tall.
assertBox(
  { id: "t", kind: "text", text: "ab", fontSize: 10, points: [{ x: 0, y: 0 }] },
  { x: 10, y: 5, width: 40, height: 25 },
  "text",
);

// Nothing to line up: no box, so the item is left out instead of breaking the rest.
assert.equal(markupScreenBox({ id: "p", kind: "polyline", points: [] }, viewport), null, "shape with no points");
assert.equal(markupScreenBox({ id: "d", kind: "draw", points: [{ x: 1, y: 1 }] }, viewport), null, "single-point drawing");

// Ellipse 100 × 40 at (0, 0): hits along its outline, not at the box corners or centre.
const ellipseBox = { x: 0, y: 0, width: 100, height: 40 };
assert.ok(nearEllipseOutline({ x: 100, y: 20 }, ellipseBox, 6), "ellipse right end");
assert.ok(nearEllipseOutline({ x: 50, y: 3 }, ellipseBox, 6), "ellipse near top");
assert.ok(!nearEllipseOutline({ x: 2, y: 2 }, ellipseBox, 6), "box corner is off the ellipse");
assert.ok(!nearEllipseOutline({ x: 50, y: 20 }, ellipseBox, 6), "ellipse centre");
