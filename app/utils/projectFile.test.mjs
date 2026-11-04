// Run: node app/utils/projectFile.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { readProjectFile } = await jiti.import("./projectFile.ts");

const valid = {
  magic: "markup-project",
  version: 2,
  fileName: "plan.png",
  fileType: "image",
  mimeType: "image/png",
  fileBytesBase64: "AAEC",
  scale: { unitsPerPdfPoint: 0.02, calibrationUnit: "ft" },
  measurements: [{ id: "m", start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, labelOffset: { x: 0, y: 0 }, color: "#06b6d4" }],
  rectangles: [{ id: "r", topLeft: { x: 1, y: 2 }, bottomRight: { x: 3, y: 4 }, widthLabelOffset: { x: 0, y: 0 }, heightLabelOffset: { x: 0, y: 0 } }],
  notes: [{ id: "n", position: { x: 1, y: 2 }, text: "Check" }],
  shapes: [{ id: "s", kind: "image", points: [{ x: 1, y: 2 }], image: "data:image/png;base64,AAAA" }],
  groups: [{ id: "g", name: "Group 1", memberIds: ["m"] }],
  displayUnit: "ft",
  zoom: 1,
  rotation: 90,
};
const read = (project) => readProjectFile(new File([JSON.stringify(project)], "plan.mkup"));
const rejected = (changes, why) =>
  assert.rejects(read({ ...valid, ...changes }), /damaged or incomplete/, why);

const loaded = await read(valid);
assert.equal(loaded.measurements.length, 1);
assert.deepEqual([...loaded.bytes], [0, 1, 2]);

// Files from before shapes and groups existed still open, with legacy groups converted.
const { shapes: _shapes, groups: _groups, ...old } = valid;
const oldLoaded = await read({
  ...old,
  version: 1,
  scale: null,
  measurements: [{ ...valid.measurements[0], groupId: "g1", groupName: "Kitchen" }],
});
assert.deepEqual(oldLoaded.shapes, []);
assert.equal(oldLoaded.groups[0].name, "Kitchen");

// An out-of-range zoom is pulled back into range rather than refused.
assert.equal((await read({ ...valid, zoom: 500 })).zoom, 16);

await rejected({ measurements: null, rectangles: null, notes: null, shapes: null, groups: [] }, "null lists");
await rejected({ measurements: [{}] }, "line with no points");
await rejected({ measurements: [{ start: { x: 1, y: 2 }, end: { x: "far", y: 4 } }] }, "non-numeric point");
await rejected({ rectangles: [null] }, "null rectangle");
await rejected({ notes: [{ position: { x: 1, y: 2 } }] }, "note with no text");
await rejected({ notes: [{ position: { x: 1, y: 2 }, text: "a", color: "red" }] }, "colour that isn't hex");
await rejected({ shapes: [{ kind: "virus", points: [] }] }, "unknown shape kind");
await rejected({ shapes: [{ kind: "constructor", points: [] }] }, "inherited name as shape kind");
await rejected({ shapes: [{ kind: "image", points: [], image: "https://example.com/x.png" }] }, "outside image");
await rejected({ groups: [{ id: "g" }] }, "group with no members");
await rejected({ scale: { unitsPerPdfPoint: 0, calibrationUnit: "ft" } }, "zero scale");
await rejected({ scale: { unitsPerPdfPoint: 1, calibrationUnit: "yards" } }, "unknown scale unit");
await rejected({ displayUnit: "yards" }, "unknown display unit");
await rejected({ rotation: 45 }, "rotation");
await rejected({ zoom: "big" }, "zoom");
await rejected({ zoom: 0 }, "zero zoom");
await rejected({ fileType: "exe" }, "file type");
await rejected({ fileBytesBase64: null }, "no file bytes");

await assert.rejects(read({ magic: "something-else" }), /Not a Markup project/);
await assert.rejects(read({ ...valid, version: 99 }), /newer than this app/);

console.log("projectFile: all checks passed");
