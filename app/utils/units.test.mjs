// Run: node app/utils/units.test.mjs
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatDistance, setFeetPrecision, splitFeetInches } = await jiti.import("./units.ts");

// Default: the nearest inch, as labels have always been.
assert.equal(formatDistance(10.0833333, "ft"), `10' 1"`);
assert.equal(formatDistance(5, "ft"), `5'`);
assert.equal(formatDistance(0.5, "ft"), `6"`);
assert.equal(formatDistance(0, "ft"), `0'`);
assert.equal(formatDistance(-1, "ft"), `0'`);
assert.equal(formatDistance(3.25, "in"), `3.25"`);

setFeetPrecision(8);
assert.equal(formatDistance(5 + 3.5 / 12, "ft"), `5' 3 1/2"`);
assert.equal(formatDistance(5 + 3.125 / 12, "ft"), `5' 3 1/8"`);
assert.equal(formatDistance(0.5 / 12, "ft"), `1/2"`);
assert.equal(formatDistance(5, "ft"), `5'`);
// Rounding up carries through the inches into the next foot.
assert.equal(formatDistance(5 + 11.99 / 12, "ft"), `6'`);
assert.equal(formatDistance(3.25, "in"), `3 1/4"`);
assert.equal(formatDistance(0, "in"), `0"`);

setFeetPrecision(16);
assert.equal(formatDistance(1 + 1 / 16 / 12, "ft"), `1' 1/16"`);
assert.equal(formatDistance(1 + 9.0625 / 12, "ft"), `1' 9 1/16"`);

setFeetPrecision("decimal");
assert.equal(formatDistance(5.25, "ft"), "5.25 ft");
assert.equal(formatDistance(3.25, "in"), `3.25"`);

// Metric never changes.
setFeetPrecision(16);
assert.equal(formatDistance(2.5, "m"), "2.50 m");
assert.equal(formatDistance(1234.4, "mm"), "1234 mm");
setFeetPrecision(undefined);

assert.deepEqual(splitFeetInches(`10' 1"`), ["10'", `1"`]);
assert.deepEqual(splitFeetInches(`10' 1 1/2"`), ["10'", `1 1/2"`]);
assert.deepEqual(splitFeetInches(`10' 1/2"`), ["10'", `1/2"`]);
assert.equal(splitFeetInches(`10'`), null);
assert.equal(splitFeetInches("5.25 ft"), null);

console.log("units tests passed");
