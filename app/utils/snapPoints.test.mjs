// Run: node app/utils/snapPoints.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { buildSegmentIndex, extractSegments, findSnap } = await jiti.import("./snapPoints.ts");

const segments = (list, curves = []) => ({
  coords: Float32Array.from(list.flat()),
  curve: Uint8Array.from(list.map((_, i) => (curves.includes(i) ? 1 : 0))),
  count: list.length,
});
const indexOf = (...args) => buildSegmentIndex(segments(...args));
const snap = (index, x, y, radius = 10, more = {}) =>
  findSnap({ x, y }, radius, index, more.markups ?? [], { alongLines: more.alongLines ?? true, excludeId: more.excludeId });

// One long wall, and a second one crossing it at (100, 100).
const walls = indexOf([
  [0, 100, 300, 100],
  [100, 0, 100, 300],
]);

assert.deepEqual(snap(walls, 3, 104), { point: { x: 0, y: 100 }, kind: "end" });
assert.deepEqual(snap(walls, 104, 97), { point: { x: 100, y: 100 }, kind: "intersection" });
assert.deepEqual(snap(walls, 150, 300), null);
assert.deepEqual(snap(walls, 203, 103), { point: { x: 203, y: 100 }, kind: "line" });
assert.equal(snap(walls, 203, 103, 10, { alongLines: false }), null);
// Along a line pulls from less far than a real point does.
assert.equal(snap(walls, 203, 108), null);
assert.deepEqual(snap(walls, 8, 100), { point: { x: 0, y: 100 }, kind: "end" });

// Midpoints, but not on a stub whose middle is right beside its ends.
const beam = indexOf([[0, 0, 200, 0]]);
assert.deepEqual(snap(beam, 104, 4), { point: { x: 100, y: 0 }, kind: "midpoint" });
assert.deepEqual(snap(indexOf([[0, 0, 20, 0]]), 10, 2).kind, "line");

// A point wins over a nearer line; a corner reads as an end, not a crossing.
assert.equal(snap(indexOf([[0, 0, 100, 0], [0, 0, 0, 100]]), 2, 2).kind, "end");

// A curve's chord only offers its ends: its middle isn't on the curve.
const arc = indexOf([[0, 0, 100, 100]], [0]);
assert.equal(snap(arc, 50, 50), null);
assert.deepEqual(snap(arc, 98, 98), { point: { x: 100, y: 100 }, kind: "end" });

// Markups snap too, a markup and a drawing line cross, and a markup ignores itself.
const line = { id: "m", a: { x: 50, y: 50 }, b: { x: 50, y: 250 } };
assert.deepEqual(snap(null, 48, 53, 10, { markups: [line] }), { point: { x: 50, y: 50 }, kind: "end" });
assert.equal(snap(null, 48, 53, 10, { markups: [line], excludeId: "m" }), null);
assert.deepEqual(snap(walls, 52, 98, 10, { markups: [line] }), { point: { x: 50, y: 100 }, kind: "intersection" });

// Nothing to snap to, and a query far off the drawing, are both just no snap.
assert.equal(snap(indexOf([]), 5, 5), null);
assert.equal(snap(walls, -5000, 9000), null);
assert.ok(snap(walls, 100, 100, 100000));

// A long diagonal is found all along it, including where it clips a grid cell's corner.
const diagonal = indexOf([[0, 0, 2000, 1337], [0, 1337, 1, 1337]]);
for (let t = 0.01; t < 1; t += 0.0173) {
  const hit = snap(diagonal, 2000 * t, 1337 * t, 1);
  assert.ok(hit, `diagonal at ${t}`);
}

// The real thing: pdf.js's operator list for a real PDF, in page coordinates.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
const doc = await PDFDocument.create();
const page = doc.addPage([600, 400]);
page.drawRectangle({ x: 100, y: 100, width: 200, height: 100, borderWidth: 2, borderColor: rgb(0, 0, 0) });
page.drawLine({ start: { x: 10, y: 20 }, end: { x: 50, y: 60 }, thickness: 1 });
// Moved by a transform, and upside down the way pdf-lib draws SVG paths.
page.drawSvgPath("M 0 0 L 30 0 L 30 30 Z", { x: 400, y: 300, color: rgb(1, 0, 0) });
// A letter-sized filled path should be left out; a stroked circle gives its quarter points.
page.drawSvgPath("M 0 0 L 5 0 L 5 5 Z", { x: 500, y: 100, color: rgb(0, 0, 0) });
page.drawCircle({ x: 300, y: 300, size: 20, borderWidth: 1, borderColor: rgb(0, 0, 0) });
// A form XObject: its content arrives under its own matrix.
const form = await doc.embedPdf(await (async () => {
  const inner = await PDFDocument.create();
  inner.addPage([100, 100]).drawLine({ start: { x: 0, y: 0 }, end: { x: 40, y: 0 }, thickness: 1 });
  return inner.save();
})());
page.drawPage(form[0], { x: 450, y: 200 });

const task = pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false, disableFontFace: true });
const pdf = await task.promise;
const list = await (await pdf.getPage(1)).getOperatorList();
const index = buildSegmentIndex(extractSegments(list, pdfjs.OPS));
await task.destroy();

const at = (x, y, radius = 3) => snap(index, x, y, radius);
assert.deepEqual(at(101, 101), { point: { x: 100, y: 100 }, kind: "end" });
assert.deepEqual(at(299, 199), { point: { x: 300, y: 200 }, kind: "end" });
assert.deepEqual(at(49, 61), { point: { x: 50, y: 60 }, kind: "end" });
assert.deepEqual(at(431, 269), { point: { x: 430, y: 270 }, kind: "end" });
assert.equal(at(505, 95), null);
assert.deepEqual(at(280, 301), { point: { x: 280, y: 300 }, kind: "end" });
assert.deepEqual(at(489, 201), { point: { x: 490, y: 200 }, kind: "end" });

// Lines the Erase tool hid don't snap; a line only partly hidden still does.
{
  const { erasePdfArea } = await jiti.import("./pdfErase.ts");
  const sheet = await PDFDocument.create();
  const p = sheet.addPage([600, 400]);
  p.drawLine({ start: { x: 100, y: 100 }, end: { x: 150, y: 100 }, thickness: 1 });
  p.drawLine({ start: { x: 300, y: 100 }, end: { x: 400, y: 100 }, thickness: 1 });
  const hole = [{ x: 90, y: 90 }, { x: 160, y: 90 }, { x: 350, y: 90 }, { x: 350, y: 110 }, { x: 90, y: 110 }];
  const erased = await erasePdfArea(await sheet.save(), 0, hole);
  const t = pdfjs.getDocument({ data: erased, isEvalSupported: false, disableFontFace: true });
  const ops = await (await (await t.promise).getPage(1)).getOperatorList();
  const erasedIndex = buildSegmentIndex(extractSegments(ops, pdfjs.OPS));
  await t.destroy();
  assert.equal(snap(erasedIndex, 101, 101, 3), null);
  assert.deepEqual(snap(erasedIndex, 399, 101, 3), { point: { x: 400, y: 100 }, kind: "end" });
}

// Fast enough to run on every pointer move, on a very dense sheet.
const dense = [];
for (let i = 0; i < 500000; i++) {
  const x = (i * 7.3) % 2592;
  const y = (i * 3.1) % 1728;
  dense.push([x, y, x + 6, y + 4]);
}
const started = performance.now();
const denseIndex = indexOf(dense);
const built = performance.now() - started;
const queryStart = performance.now();
for (let i = 0; i < 1000; i++) findSnap({ x: (i * 13) % 2592, y: (i * 17) % 1728 }, 10, denseIndex, [], { alongLines: true });
const perQuery = (performance.now() - queryStart) / 1000;
console.log(`500k segments: built in ${built.toFixed(0)} ms, ${perQuery.toFixed(2)} ms per query`);
assert.ok(perQuery < 8, `query took ${perQuery} ms`);

console.log("snapPoints tests passed");
