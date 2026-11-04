// Run: node app/utils/dimensions.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { parseDimensionInput } = await jiti.import("./dimensions.ts");

const near = (text, unit, expected) => {
  const value = parseDimensionInput(text, unit);
  assert.ok(value !== null, `${text} (${unit}) should be readable`);
  assert.ok(Math.abs(value - expected) < 1e-9, `${text} (${unit}): got ${value}, want ${expected}`);
};

// Feet mode: the forms people write on drawings.
for (const [text, feet] of [
  ["5", 5],
  ["5.5", 5.5],
  [".5", 0.5],
  ["5.", 5],
  ["1/2", 0.5],
  ["6 1/2", 6.5],
  ["5'", 5],
  ["5 ft", 5],
  ["5 feet", 5],
  ["5FT", 5],
  [`5'-6"`, 5.5],
  [`5' 6"`, 5.5],
  [`5'6"`, 5.5],
  ["5' 6", 5.5],
  ["5 ft 6 in", 5.5],
  [`5' 6 1/2"`, 5 + 6.5 / 12],
  [`5'-6 1/2"`, 5 + 6.5 / 12],
  [`6"`, 0.5],
  ["6 in", 0.5],
  [`1/2"`, 0.5 / 12],
  [`6 1/2"`, 6.5 / 12],
  ["5’ 6”", 5.5],
  ["5′ 6″", 5.5],
  [`  5' 6"  `, 5.5],
  [`0' 6"`, 0.5],
]) {
  near(text, "ft", feet);
}

// Other units: a number with an optional matching unit.
near("10", "mm", 10);
near("10 mm", "mm", 10);
near("10mm", "mm", 10);
near("2.5 m", "m", 2.5);
near("2.5", "m", 2.5);
near(`6"`, "in", 6);
near("6 in", "in", 6);
near(`6 1/2"`, "in", 6.5);

// Anything else is refused rather than half read.
for (const [text, unit] of [
  ["", "ft"],
  ["   ", "ft"],
  ["0", "ft"],
  [`0' 0"`, "ft"],
  ["-5", "ft"],
  [`-5' 6"`, "ft"],
  ["1/0", "ft"],
  ["12abc", "ft"],
  ["5 6", "ft"],
  ["5..5", "ft"],
  [`5'-`, "ft"],
  [`6'8"`, "in"],
  ["5 ft", "in"],
  ["10 m", "mm"],
  ["10 mm", "m"],
  ["5 ft", "m"],
  ["1,000", "mm"],
  ["1,5", "m"],
  ["1e3", "mm"],
  ["Infinity", "m"],
]) {
  assert.equal(parseDimensionInput(text, unit), null, `${JSON.stringify(text)} (${unit}) should be refused`);
}

console.log("dimensions: all checks passed");
