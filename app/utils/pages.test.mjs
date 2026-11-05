// Run: node app/utils/pages.test.mjs
import assert from "node:assert/strict";
import {
  fileLabel,
  markupsOnPage,
  nearestCalibratedSheet,
  pageOf,
  pagesWithMarkups,
  screenUpForRotation,
  withPages,
} from "./pages.ts";

// Markups saved before pages existed are on page 1.
assert.equal(pageOf({}), 0);
assert.equal(pageOf({ page: 3 }), 3);

const list = [{ id: "a" }, { id: "b", page: 2 }, { id: "c", page: 0 }];
assert.deepEqual(markupsOnPage(list, 0, 3).map((m) => m.id), ["a", "c"]);
assert.deepEqual(markupsOnPage(list, 2, 3).map((m) => m.id), ["b"]);
assert.deepEqual(markupsOnPage(list, 1, 3), []);

// Same input, same array: readers use it in effect and memo dependencies.
assert.equal(markupsOnPage(list, 0, 3), markupsOnPage(list, 0, 3));
assert.equal(markupsOnPage(list, 1, 3), markupsOnPage(list, 1, 3));
assert.notEqual(markupsOnPage(list, 0, 3), markupsOnPage([...list], 0, 3));
// A one-page document skips filtering altogether.
assert.equal(markupsOnPage(list, 0, 1), list);

assert.deepEqual([...pagesWithMarkups([list, [{ page: 5 }], []])].sort(), [0, 2, 5]);
assert.equal(pagesWithMarkups([[], []]).size, 0);

// A label only shows when it says more than the page number.
assert.equal(fileLabel(2, null), null);
assert.equal(fileLabel(2, ["1", "2", "3"]), null);
assert.equal(fileLabel(0, ["A-101"]), "A-101");
assert.equal(fileLabel(4, ["A-101"]), null);

// The closest calibrated sheet in the shown list, counting sheets rather than page numbers.
const s = { unitsPerPdfPoint: 1, calibrationUnit: "ft" };
assert.equal(nearestCalibratedSheet([0, 1, 2], {}, 1), null);
assert.equal(nearestCalibratedSheet([0, 1, 2], { 1: s }, 1), null);
assert.equal(nearestCalibratedSheet([0, 1, 2, 3], { 0: s, 3: s }, 2), 3);
assert.equal(nearestCalibratedSheet([0, 1, 2], { 0: s, 2: s }, 1), 0);
assert.equal(nearestCalibratedSheet([0, 90, 91, 99], { 0: s, 99: s }, 90), 0);
// Calibrated but no longer shown doesn't count.
assert.equal(nearestCalibratedSheet([1, 2], { 0: s }, 1), null);

// Matches pdf.js: rotate the page clockwise, then ask which doc direction is screen-up.
assert.deepEqual(screenUpForRotation(0), { x: 0, y: 1 });
assert.deepEqual(screenUpForRotation(90), { x: -1, y: 0 });
assert.deepEqual(screenUpForRotation(180), { x: 0, y: -1 });
assert.deepEqual(screenUpForRotation(270), { x: 1, y: 0 });

// Older saved files: one scale and rotation, for page 1, and the page question still to ask.
const scale = { unitsPerPdfPoint: 0.1, calibrationUnit: "ft" };
assert.deepEqual(withPages({ scale, rotation: 90 }), { scales: { 0: scale }, rotations: { 0: 90 }, page: 0, sheets: null });
assert.deepEqual(withPages({ scale: null }), { scales: {}, rotations: {}, page: 0, sheets: null });
// Current files keep what they say, even with the page 1 copies alongside.
const other = { unitsPerPdfPoint: 0.5, calibrationUnit: "m" };
assert.deepEqual(
  withPages({ scale, rotation: 0, scales: { 0: scale, 2: other }, rotations: { 2: 270 }, page: 2, sheets: [0, 2] }),
  { scales: { 0: scale, 2: other }, rotations: { 2: 270 }, page: 2, sheets: [0, 2] },
);

console.log("pages: all checks passed");
