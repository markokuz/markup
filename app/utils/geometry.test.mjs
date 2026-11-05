// Run: node app/utils/geometry.test.mjs
import assert from "node:assert/strict";
import {
  areaRings,
  cloudOutline,
  pointInRings,
  ringsPath,
  cloudPath,
  eraseFromStrokes,
  joinStrokes,
  simplifyPath,
  splitStrokes,
  smoothClosedPath,
  formatArea,
  polygonArea,
  polygonCentroid,
  polylineLength,
  polylineMidpoint,
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

// An area's rings: outline first, then cutouts; a stray short ring doesn't count.
const hole = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }];
const holed = joinStrokes([square, hole]);
assert.deepEqual(areaRings(holed), [square, hole]);
assert.deepEqual(areaRings({ points: [...square, { x: 1, y: 1 }], breaks: [4] }), [square]);
assert.ok(pointInRings({ x: 8, y: 8 }, [square, hole]));
assert.ok(!pointInRings({ x: 3, y: 3 }, [square, hole]));
assert.ok(!pointInRings({ x: 20, y: 20 }, [square, hole]));
assert.ok(!pointInRings({ x: 1, y: 1 }, []));

// Cutouts wind against the outline whichever way they were clicked, so nonzero fill leaves them empty.
const pathWinding = (d) =>
  d.split("Z").filter((s) => s.trim()).map((ring) => {
    const pts = [...ring.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    return Math.sign(pts.reduce((sum, a, i) => {
      const b = pts[(i + 1) % pts.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0));
  });
const [outlineWay, holeWay] = pathWinding(ringsPath([square, hole]));
assert.equal(holeWay, -outlineWay);
const [outlineWay2, holeWay2] = pathWinding(ringsPath([square, [...hole].reverse()]));
assert.equal(holeWay2, -outlineWay2);
assert.equal(ringsPath([]), "");

// Halfway along the path, not the middle vertex: 10 + 30 long puts it 10 into the second leg.
assert.deepEqual(polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]), { x: 10, y: 10 });
assert.deepEqual(polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }]), { x: 5, y: 0 });
// Zero-length legs (a duplicate vertex) don't divide by zero.
assert.deepEqual(polylineMidpoint([{ x: 2, y: 2 }, { x: 2, y: 2 }]), { x: 2, y: 2 });

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

// Drawings: pieces round-trip through points + breaks.
const twoPieces = [
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }],
];
const joined = joinStrokes(twoPieces);
assert.deepEqual(joined.breaks, [2]);
assert.deepEqual(splitStrokes(joined.points, joined.breaks), twoPieces);
assert.equal(joinStrokes([twoPieces[0]]).breaks, undefined);
assert.deepEqual(splitStrokes(twoPieces[0]), [twoPieces[0]]);

// Erasing the middle of a straight two-point line leaves two pieces with a gap.
const line = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]];
const cut = eraseFromStrokes(line, { x: 50, y: 0 }, 10);
assert.equal(cut.length, 2);
assert.ok(near(cut[0][cut[0].length - 1], { x: 40, y: 0 }) && near(cut[1][0], { x: 60, y: 0 }));
// Missing the line changes nothing; covering an end trims it; covering it all removes it.
assert.equal(eraseFromStrokes(line, { x: 50, y: 30 }, 10), null);
const trimmed = eraseFromStrokes(line, { x: 0, y: 0 }, 10);
assert.equal(trimmed.length, 1);
assert.ok(near(trimmed[0][0], { x: 10, y: 0 }));
assert.deepEqual(eraseFromStrokes(line, { x: 50, y: 0 }, 80), []);
// A cut across a bend keeps the corner on whichever side it falls.
const bend = [[{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]];
const bendCut = eraseFromStrokes(bend, { x: 50, y: 25 }, 5);
assert.equal(bendCut.length, 2);
assert.ok(near(bendCut[0][1], { x: 50, y: 0 }) && near(bendCut[0][2], { x: 50, y: 20 }));
assert.ok(near(bendCut[1][0], { x: 50, y: 30 }));
// Leftovers shorter than minLength are dropped.
assert.equal(eraseFromStrokes(line, { x: 50, y: 0 }, 49.5, 1).length, 0);

console.log("geometry: all checks passed");
