// Run: node app/utils/scalePresets.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { SCALE_PRESET_GROUPS, describeScale } = await jiti.import("./scalePresets.ts");

const preset = (label) =>
  SCALE_PRESET_GROUPS.flatMap((g) => g.presets).find((p) => p.label === label)?.scale;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

// A quarter inch of paper (18 points) is one foot.
near(preset(`1/4" = 1'-0"`).unitsPerPdfPoint * 18, 1);
// An inch of paper (72 points) is 20 feet.
near(preset(`1" = 20'`).unitsPerPdfPoint * 72, 20);
// At 1:100, 10 mm of paper is one metre.
near(preset("1:100").unitsPerPdfPoint * (10 / 25.4) * 72, 1);

// Every preset describes itself.
for (const { presets } of SCALE_PRESET_GROUPS) {
  for (const { label, scale } of presets) assert.equal(describeScale(scale), label);
}

// Calibrated by hand: close to a standard scale says so; far from one gives the number.
assert.equal(describeScale({ unitsPerPdfPoint: (1 / 18) * 1.01, calibrationUnit: "ft" }), `≈ 1/4" = 1'-0"`);
assert.equal(describeScale({ unitsPerPdfPoint: 7 / 72, calibrationUnit: "ft" }), `1" = 7'`);
assert.equal(describeScale({ unitsPerPdfPoint: ((25.4 / 72) * 333) / 1000, calibrationUnit: "m" }), "1:333");
// The same scale calibrated in another unit is still that scale.
assert.equal(describeScale({ unitsPerPdfPoint: 12 / 18, calibrationUnit: "in" }), `1/4" = 1'-0"`);

console.log("scalePresets tests passed");
