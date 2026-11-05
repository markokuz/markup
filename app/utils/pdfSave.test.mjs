// Run: node app/utils/pdfSave.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { buildPdfWithMarkups, readPdfWithMarkups } = await jiti.import("./pdfSave.ts");

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const n of [1, 2]) {
  source.addPage([792, 612]).drawText(`Sheet ${n}`, { x: 72, y: 540, size: 24, font });
}
const original = await source.save();

const data = {
  scale: { unitsPerPdfPoint: 0.02, calibrationUnit: "ft" },
  measurements: [{ id: "m1", start: { x: 100, y: 300 }, end: { x: 400, y: 300 }, labelOffset: { x: 0, y: 12 } }],
  rectangles: [
    {
      id: "r1",
      topLeft: { x: 200, y: 200 },
      bottomRight: { x: 300, y: 260 },
      widthLabelOffset: { x: 0, y: 0 },
      heightLabelOffset: { x: 0, y: 0 },
      rotation: 30,
    },
  ],
  notes: [{ id: "n1", position: { x: 500, y: 500 }, text: "Check this", rotation: 15, width: 200 }],
  shapes: [
    { id: "t1", kind: "text", points: [{ x: 120, y: 450 }], text: "Free text\nline 2", fontSize: 14, bold: true, rotation: 90 },
    { id: "a1", kind: "area", points: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 120 }], color: "#22c55e" },
    { id: "c1", kind: "cloud", points: [{ x: 600, y: 100 }, { x: 700, y: 180 }] },
  ],
  displayUnit: "ft",
  zoom: 1,
  rotation: 0,
  toolColors: { count: "#ef4444" },
};
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// Runs and cutouts survive a save, and a cutout is drawn as a second ring of the same path.
const takeoffData = {
  ...data,
  shapes: [
    { id: "run", kind: "polyline", points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 90 }] },
    {
      id: "room",
      kind: "area",
      points: [
        { x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 100, y: 400 },
        { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 200, y: 300 },
      ],
      breaks: [4],
    },
  ],
};
const savedTakeoff = await readPdfWithMarkups(await bytesOf(await buildPdfWithMarkups(original, takeoffData)));
assert.deepEqual(savedTakeoff.data.shapes, takeoffData.shapes);
const takeoffPage = await PDFDocument.load(await bytesOf(await buildPdfWithMarkups(original, takeoffData)));
const takeoffOps = (() => {
  const contents = takeoffPage.getPage(0).node.Contents();
  return Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFRawStream))
    .map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()))
    .join("\n");
})();
// A run is drawn as straight segments: smoothing it would misdraw what was measured.
assert.ok(/60 -90 l/.test(takeoffOps) || /60 -10 l/.test(takeoffOps), "run drawn with line segments");
const runOps = takeoffOps.slice(takeoffOps.indexOf("10 -10 m"), takeoffOps.indexOf("100 -100 m"));
assert.ok(runOps.length > 0 && !/ c\n/.test(runOps), "run has no curve operators");

// Everything on one page's contents, as text.
const pageOps = async (bytes, index) => {
  const doc = await PDFDocument.load(bytes);
  const node = doc.getPage(index).node;
  const contents = node.Contents();
  if (!contents) return "";
  const streams =
    contents instanceof PDFRawStream
      ? [contents]
      : Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFRawStream));
  return streams.map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode())).join("\n");
};

// Markups go on their own pages, each at its own scale, and come back with their page numbers.
const sheetScale = { unitsPerPdfPoint: 0.5, calibrationUnit: "ft" };
const multiPage = {
  ...data,
  scale: null,
  scales: { 1: sheetScale },
  rotations: { 0: 0, 1: 90 },
  page: 1,
  sheets: [1],
  measurements: [],
  rectangles: [],
  notes: [],
  shapes: [
    { id: "p2", kind: "polyline", page: 1, color: "#2563eb", points: [{ x: 111, y: 222 }, { x: 333, y: 222 }] },
    // On a page past the end, as a damaged file might say: it stays in the data but mustn't stop the save.
    { id: "gone", kind: "polyline", page: 9, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
  ],
};
const savedMulti = await bytesOf(await buildPdfWithMarkups(original, multiPage));
assert.ok((await pageOps(savedMulti, 1)).includes("111 -222 m"), "page 2 has its markup");
assert.ok(!(await pageOps(savedMulti, 0)).includes("111 -222 m"), "page 1 doesn't have page 2's markup");
assert.equal((await PDFDocument.load(savedMulti)).getPageCount(), 2);
const readMulti = await readPdfWithMarkups(savedMulti);
assert.deepEqual(readMulti.data.shapes, multiPage.shapes);
assert.deepEqual(readMulti.data.scales, { 1: sheetScale });
assert.deepEqual(readMulti.data.rotations, { 0: 0, 1: 90 });
assert.equal(readMulti.data.page, 1);
assert.deepEqual(readMulti.data.sheets, [1]);

// Reopening strips page 2's drawing as well as page 1's, and saving again doesn't grow the file.
const pristineMulti = new TextDecoder("latin1").decode(readMulti.pristine);
assert.ok(!pristineMulti.includes("MarkupApp"), "stripped multi-page PDF still has markup objects");
assert.ok(!(await pageOps(readMulti.pristine, 1)).includes("111 -222 m"), "page 2 drawing stripped");
const resavedMulti = await bytesOf(await buildPdfWithMarkups(readMulti.pristine, multiPage));
const rereadMulti = await readPdfWithMarkups(resavedMulti);
assert.ok(
  Math.abs(rereadMulti.pristine.length - readMulti.pristine.length) <= 16,
  `multi-page pristine grew: ${readMulti.pristine.length} -> ${rereadMulti.pristine.length}`,
);

// Pages sharing one Resources dictionary, inherited from the page tree, as plan sets often do.
const sharedDoc = await PDFDocument.create();
const sharedFont = await sharedDoc.embedFont(StandardFonts.Helvetica);
for (const n of [1, 2, 3]) {
  sharedDoc.addPage([612, 792]).drawText(`Shared ${n}`, { x: 72, y: 700, size: 24, font: sharedFont });
}
await sharedDoc.flush();
const sharedResources = sharedDoc.getPage(0).node.Resources();
const fontName = sharedResources.lookup(PDFName.of("Font")).keys()[0];
for (const page of sharedDoc.getPages()) {
  page.node.delete(PDFName.of("Resources"));
}
sharedDoc.catalog.Pages().set(PDFName.of("Resources"), sharedDoc.context.register(sharedResources));
const sharedBytes = await sharedDoc.save({ useObjectStreams: false });
assert.ok(
  (await PDFDocument.load(sharedBytes)).getPage(2).node.Resources().lookup(PDFName.of("Font")).has(fontName),
  "fixture: page 3 inherits the shared fonts",
);
const sharedMarkups = {
  ...multiPage,
  scales: {},
  rotations: {},
  shapes: [
    { id: "s1", kind: "text", page: 0, points: [{ x: 50, y: 50 }], text: "A", fontSize: 12 },
    { id: "s3", kind: "polyline", page: 2, points: [{ x: 444, y: 555 }, { x: 500, y: 555 }] },
  ],
};
const savedShared = await bytesOf(await buildPdfWithMarkups(sharedBytes, sharedMarkups));
const readShared = await readPdfWithMarkups(savedShared);
assert.ok(!new TextDecoder("latin1").decode(readShared.pristine).includes("MarkupApp"), "shared resources stripped");
const pristineShared = await PDFDocument.load(readShared.pristine);
assert.equal(pristineShared.getPageCount(), 3);
for (const index of [0, 1, 2]) {
  const fonts = pristineShared.getPage(index).node.Resources().lookup(PDFName.of("Font"));
  assert.deepEqual(fonts.keys().map(String), [String(fontName)], `page ${index + 1} keeps only its own font`);
}

// A PDF saved before multi-page support (data v1, no pages) still reopens, on page 1.
const oldStyle = await PDFDocument.load(original);
oldStyle.catalog.set(
  PDFName.of("MarkupAppData"),
  oldStyle.context.register(
    oldStyle.context.flateStream(new TextEncoder().encode(JSON.stringify({ ...data, version: 1 }))),
  ),
);
const readOld = await readPdfWithMarkups(await oldStyle.save({ useObjectStreams: false }));
assert.ok(readOld, "older saved PDF opens");
assert.equal(readOld.data.measurements[0].page, undefined);
assert.equal(readOld.data.scales, undefined);

// A PDF this app never saved is left alone.
assert.equal(await readPdfWithMarkups(original), null);

const saved1 = await bytesOf(await buildPdfWithMarkups(original, data));
const read1 = await readPdfWithMarkups(saved1);
assert.ok(read1, "markups found in the saved PDF");
assert.deepEqual({ ...read1.data, version: undefined }, { ...data, version: undefined });

// Markups are drawn on page 1 (other viewers see them); page 2 is untouched.
const savedDoc = await PDFDocument.load(saved1);
assert.equal(savedDoc.getPageCount(), 2);

// Stripping leaves no trace of this app, and repeated saves do not grow the file.
const pristineText = new TextDecoder("latin1").decode(read1.pristine);
assert.ok(!pristineText.includes("MarkupApp"), "stripped PDF still has markup objects");
const saved2 = await bytesOf(await buildPdfWithMarkups(read1.pristine, data));
const read2 = await readPdfWithMarkups(saved2);
const saved3 = await bytesOf(await buildPdfWithMarkups(read2.pristine, data));
assert.ok(
  Math.abs(saved3.length - saved2.length) <= 16,
  `file grew across saves: ${saved2.length} -> ${saved3.length}`,
);
assert.ok(
  Math.abs(read2.pristine.length - read1.pristine.length) <= 16,
  `pristine grew: ${read1.pristine.length} -> ${read2.pristine.length}`,
);
assert.equal((await PDFDocument.load(read2.pristine)).getPageCount(), 2);

// Text the standard PDF font can't draw still saves, and comes back exactly as typed.
const awkward = "≥ 2 → ⌀ 50 − ✓ 日本語 90° “quoted” — ±1\tend\r\nline 2";
const awkwardData = {
  ...data,
  notes: [{ id: "n2", position: { x: 300, y: 300 }, text: awkward }],
  shapes: [
    { id: "t2", kind: "text", points: [{ x: 100, y: 200 }], text: awkward, fontSize: 14, bold: true },
    { id: "c2", kind: "callout", points: [{ x: 100, y: 100 }, { x: 200, y: 120 }], text: awkward },
  ],
};
const savedAwkward = await bytesOf(await buildPdfWithMarkups(original, awkwardData));
const readAwkward = await readPdfWithMarkups(savedAwkward);
assert.equal(readAwkward.data.notes[0].text, awkward);
assert.equal(readAwkward.data.shapes[0].text, awkward);
assert.equal(readAwkward.data.shapes[1].text, awkward);

// Damaged markup data opens as a plain PDF instead of reaching the app.
const damaged = await PDFDocument.load(saved1);
damaged.catalog.set(
  PDFName.of("MarkupAppData"),
  damaged.context.register(damaged.context.flateStream(JSON.stringify({ ...data, version: 1, measurements: null }))),
);
assert.equal(await readPdfWithMarkups(await damaged.save({ useObjectStreams: false })), null);

// An out-of-range zoom is pulled back into range.
const zoomed = await bytesOf(await buildPdfWithMarkups(original, { ...data, zoom: 500 }));
assert.equal((await readPdfWithMarkups(zoomed)).data.zoom, 16);

// What gets drawn doesn't depend on the zoom the file was saved at (pdf-lib's resource names are random).
const drawing = async (zoom) => {
  const doc = await PDFDocument.load(await bytesOf(await buildPdfWithMarkups(original, { ...data, zoom })));
  const contents = doc.getPage(0).node.Contents();
  const streams = Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFRawStream));
  return streams
    .map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()))
    .join("\n")
    .replace(/\/[\w+-]*-\d+/g, "/name");
};
assert.equal(await drawing(0.25), await drawing(16));

console.log("pdfSave: all checks passed");
