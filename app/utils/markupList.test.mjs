// Run: node app/utils/markupList.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { buildMarkupRows, rowsToCsv, summarizeRows } = await jiti.import("./markupList.ts");

const row = (fields) => ({ id: "x", type: "Note", name: "", color: "#000000", text: "", display: "", ...fields });
const cells = (fields) => rowsToCsv([row(fields)], "ft").split("\r\n")[1];

// Text a spreadsheet would run as a formula is neutralised, however it starts.
assert.equal(cells({ text: "=1+1" }), ",Note,,'=1+1,,,,,,#000000,");
assert.equal(cells({ text: "+1" }), ",Note,,'+1,,,,,,#000000,");
assert.equal(cells({ text: "-1" }), ",Note,,'-1,,,,,,#000000,");
assert.equal(cells({ text: "@SUM(A1)" }), ",Note,,'@SUM(A1),,,,,,#000000,");
assert.equal(cells({ name: "=cmd" }), ",Note,'=cmd,,,,,,,#000000,");
assert.equal(cells({ text: '=HYPERLINK("http://x")' }), `,Note,,"'=HYPERLINK(""http://x"")",,,,,,#000000,`);

// Line breaks and commas stay inside one quoted cell.
assert.equal(cells({ text: "line1\rline2" }), `,Note,,"line1\rline2",,,,,,#000000,`);
assert.equal(cells({ text: "line1\nline2" }), `,Note,,"line1\nline2",,,,,,#000000,`);
assert.equal(cells({ text: "a, b" }), `,Note,,"a, b",,,,,,#000000,`);

// Ordinary text and every number are left alone, negative or not.
assert.equal(cells({ text: "Check this" }), ",Note,,Check this,,,,,,#000000,");
assert.equal(cells({ type: "Length", length: 5.5555 }), ",Length,,,5.556,,,,,#000000,");
assert.equal(cells({ type: "Length", length: -5 }), ",Length,,,-5,,,,,#000000,");

// A run is measured along every segment, and totals with two-point lines of the same colour.
const scaled = {
  measurements: [{ id: "line", start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, color: "#111111" }],
  rectangles: [],
  notes: [],
  shapes: [
    { id: "run", kind: "polyline", color: "#111111", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] },
    { id: "short", kind: "polyline", color: "#111111", points: [{ x: 0, y: 0 }] },
  ],
  scales: { 0: { unitsPerPdfPoint: 1, calibrationUnit: "ft" } },
  displayUnit: "ft",
};
const rows = buildMarkupRows(scaled);
assert.equal(rows.find((r) => r.id === "run").type, "Length");
assert.equal(rows.find((r) => r.id === "run").length, 7);
assert.equal(rows.find((r) => r.id === "short").display, "—");
assert.equal(summarizeRows(rows, "ft").length, 1);
// The line and the run; a one-point run has no length yet, so it isn't counted.
assert.match(summarizeRows(rows, "ft")[0].display, /\(2\)$/);
assert.equal(buildMarkupRows({ ...scaled, scales: {} }).find((r) => r.id === "run").display, "Not calibrated");

// Cutouts come off the area but not the perimeter, and the row says they are there.
const room = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const opening = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }];
const [holed] = buildMarkupRows({
  ...scaled,
  measurements: [],
  shapes: [{ id: "room", kind: "area", color: "#111111", points: [...room, ...opening], breaks: [4] }],
});
assert.equal(holed.area, 96);
assert.equal(holed.perimeter, 40);
assert.match(holed.display, /1 cutout$/);

// Each markup is measured at its own sheet's scale, and an uncalibrated sheet says so.
const line = (id, page) => ({ id, page, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
const sheetRows = buildMarkupRows({
  ...scaled,
  shapes: [],
  measurements: [line("first"), line("third", 2), line("fourth", 3)],
  scales: {
    0: { unitsPerPdfPoint: 1, calibrationUnit: "ft" },
    2: { unitsPerPdfPoint: 4, calibrationUnit: "ft" },
  },
});
const sheetRow = (id) => sheetRows.find((r) => r.id === id);
assert.equal(sheetRow("first").length, 10);
assert.equal(sheetRow("first").page, 0);
assert.equal(sheetRow("third").length, 40);
assert.equal(sheetRow("third").page, 2);
assert.equal(sheetRow("fourth").display, "Not calibrated");
assert.match(summarizeRows(sheetRows, "ft")[0].display, /50'.*\(2\)$/);

// The sheet is the last CSV column, counted from 1 like the page numbers people see.
const csv = rowsToCsv(sheetRows, "ft").split("\r\n");
assert.ok(csv[0].endsWith(",Color,Sheet"));
assert.ok(csv[1].endsWith(",1"));
assert.ok(csv[2].endsWith(",3"));

console.log("markupList: all checks passed");
