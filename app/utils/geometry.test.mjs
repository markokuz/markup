// Run: node app/utils/geometry.test.mjs
import assert from "node:assert/strict";
import {
  cloudOutline,
  cloudPath,
  simplifyPath,
  smoothClosedPath,
  formatArea,
  polygonArea,
  polygonCentroid,
  polylineLength,
  rotateAround,
  rotatedBoxCorners,
} from "./geometry.ts";

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
assert.equal(polygonArea(square), 100);
assert.equal(polygonArea([...square].reverse()), 100);
assert.equal(polylineLength(square, true), 40);
assert.equal(polylineLength(square, false), 30);
assert.deepEqual(polygonCentroid(square), { x: 5, y: 5 });

const triangle = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 3 },
];
assert.equal(polygonArea(triangle), 6);
assert.equal(polylineLength(triangle, true), 12);

// Cloud: 40-unit edges with 10-unit arcs -> 4 scallops per edge, 16 total.
const path = cloudPath(
  square.map((p) => ({ x: p.x * 4, y: p.y * 4 })),
  10,
);
assert.equal((path.match(/ A /g) ?? []).length, 16);

// Freehand cloud: a jittery circle simplifies to far fewer points, Chaikin doubles per pass.
const jittery = Array.from({ length: 200 }, (_, i) => {
  const t = (i / 200) * Math.PI * 2;
  const r = 100 + (i % 2 ? 1 : -1);
  return { x: Math.cos(t) * r, y: Math.sin(t) * r };
});
const simplified = simplifyPath(jittery, 4);
assert.ok(simplified.length < 40 && simplified.length >= 8, `simplified to ${simplified.length}`);
const smoothed = smoothClosedPath(simplified, 2);
assert.equal(smoothed.length, simplified.length * 4);
assert.ok(Math.abs(polygonArea(smoothed) - Math.PI * 100 * 100) / (Math.PI * 10000) < 0.1);
// Freehand cloud scallops are evenly sized: circumference ~628 / arc 20 -> ~31 scallops.
const freehandArcs = cloudPath(smoothed, 20).match(/ A /g).length;
assert.ok(Math.abs(freehandArcs - 31) <= 2, `freehand scallops ${freehandArcs}`);
assert.deepEqual(cloudOutline([{ x: 0, y: 0 }, { x: 2, y: 3 }]).length, 4);
assert.equal(cloudOutline(triangle), triangle);

assert.equal(formatArea(1234.56, "ft"), "1,234.6 sq ft");
assert.equal(formatArea(12.345, "m"), "12.35 m²");

const near = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
// 90° clockwise on a y-down screen: right -> down.
assert.ok(near(rotateAround({ x: 2, y: 1 }, { x: 1, y: 1 }, 90), { x: 1, y: 2 }));
assert.ok(near(rotateAround({ x: 3, y: 4 }, { x: 0, y: 0 }, 360), { x: 3, y: 4 }));
const turned = rotatedBoxCorners({ x: 0, y: 0 }, 4, 2, 90);
assert.ok(near(turned[1], { x: 0, y: 4 }) && near(turned[2], { x: -2, y: 4 }) && near(turned[3], { x: -2, y: 0 }));

console.log("geometry: all checks passed");
