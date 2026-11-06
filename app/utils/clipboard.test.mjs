// Run: node app/utils/clipboard.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { buildPaste, copySelection, duplicateSelection } = await jiti.import("./clipboard.ts");

const viewport = {
  width: 1000,
  height: 500,
  docOrigin: { x: 0, y: 0 },
  convertToDocPoint: (x, y) => ({ x, y }),
  convertToViewportPoint: (x, y) => ({ x, y }),
};
const source = (shapes, selectedIds) => ({
  measurements: [],
  rectangles: [],
  notes: [],
  shapes,
  selectedIds,
  scale: null,
  zoom: 1,
});
const marker = (id, x, y) => ({ id, kind: "count", points: [{ x, y }] });
const firstPoint = (pasted) => pasted.shapes[0].points[0];

// In open space a duplicate lands just off the original, with a new id.
const open = duplicateSelection(source([marker("a", 100, 100)], ["a"]), viewport);
assert.deepEqual(firstPoint(open), { x: 120, y: 120 });
assert.notEqual(open.shapes[0].id, "a");

// At the page's corner it steps back onto the page instead of off it.
assert.deepEqual(firstPoint(duplicateSelection(source([marker("a", 995, 495)], ["a"]), viewport)), { x: 975, y: 475 });

// Duplicating leaves what was copied alone.
copySelection(source([marker("copied", 10, 10)], ["copied"]), viewport);
duplicateSelection(source([marker("other", 50, 50)], ["other"]), viewport);
const paste = (x, y) => buildPaste({ viewport, zoom: 1, scale: null, targetScreen: { x, y } });
assert.deepEqual(firstPoint(paste(300, 300)), { x: 300, y: 300 });

// A paste past the edge is pulled back so the whole group is on the page.
copySelection(
  source([{ id: "wide", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] }], ["wide"]),
  viewport,
);
assert.deepEqual(paste(5, 5).shapes[0].points, [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
assert.deepEqual(paste(990, 490).shapes[0].points, [{ x: 800, y: 400 }, { x: 1000, y: 500 }]);

// A group too big for the page is centred on it rather than thrown off one side.
copySelection(
  source([{ id: "huge", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 2000, y: 100 }] }], ["huge"]),
  viewport,
);
assert.deepEqual(paste(0, 250).shapes[0].points[0].x, -500);

console.log("clipboard tests passed");
