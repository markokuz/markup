// Run: node app/utils/align.test.mjs
import assert from "node:assert/strict";
import { alignAnchor, alignDotLayout, alignMoves, alignShift, moveMarkupAction, unionBox } from "./align.ts";

const a = { x: 0, y: 0, width: 10, height: 10 };
const b = { x: 100, y: 50, width: 30, height: 20 };

assert.deepEqual(unionBox([a, b]), { x: 0, y: 0, width: 130, height: 70 });

// Each dot moves on its own axis only, and lands on the reference's matching edge.
assert.deepEqual(alignShift(a, b, "left"), { x: 100, y: 0 });
assert.deepEqual(alignShift(a, b, "centre"), { x: 110, y: 0 });
assert.deepEqual(alignShift(a, b, "right"), { x: 120, y: 0 });
assert.deepEqual(alignShift(a, b, "top"), { x: 0, y: 50 });
assert.deepEqual(alignShift(a, b, "middle"), { x: 0, y: 55 });
assert.deepEqual(alignShift(a, b, "bottom"), { x: 0, y: 60 });

const items = [
  { id: "a", box: a },
  { id: "b", box: b },
];
const shiftOf = (moves, id) => moves.find((m) => m.item.id === id)?.shift;

// No anchor: both meet at the middle of the whole selection (x = 65).
const free = alignMoves(items, null, "centre");
assert.deepEqual(shiftOf(free, "a"), { x: 60, y: 0 });
assert.deepEqual(shiftOf(free, "b"), { x: -50, y: 0 });

// An anchor stays still and the rest come to it.
const anchored = alignMoves(items, "b", "centre");
assert.equal(anchored.length, 1);
assert.deepEqual(shiftOf(anchored, "a"), { x: 110, y: 0 });

// An anchor id no longer in the selection falls back to the whole selection.
assert.equal(alignMoves(items, "gone", "centre").length, 2);

// A locked item never moves, and the others line up to it.
const withLocked = [{ id: "a", box: a, locked: true }, { id: "b", box: b }];
assert.equal(alignAnchor(withLocked, null)?.id, "a");
const lockedMoves = alignMoves(withLocked, null, "left");
assert.equal(lockedMoves.length, 1);
assert.deepEqual(shiftOf(lockedMoves, "b"), { x: -100, y: 0 });

// A chosen anchor wins over a locked item, which still doesn't move.
const anchorOverLocked = alignMoves([...withLocked, { id: "c", box: { x: 5, y: 5, width: 1, height: 1 } }], "c", "left");
assert.deepEqual(anchorOverLocked.map((m) => m.item.id), ["b"]);

// Everything locked: nothing moves.
assert.equal(alignMoves(withLocked.map((i) => ({ ...i, locked: true })), null, "left").length, 0);

// Already lined up: nothing moves, so no empty undo step.
const lined = [
  { id: "a", box: { x: 5, y: 0, width: 10, height: 10 } },
  { id: "b", box: { x: 5, y: 50, width: 10, height: 10 } },
];
assert.equal(alignMoves(lined, null, "left").length, 0);

const PAGE = { width: 800, height: 600 };
const DOTS = ["left", "centre", "right", "top", "middle", "bottom"];

/** Every dot on the page, and none on top of another. */
function assertUsable(box, label, page = PAGE) {
  const dots = alignDotLayout(box, page.width, page.height);
  for (const name of DOTS) {
    const { x, y } = dots[name];
    assert.ok(x >= 0 && x <= page.width && y >= 0 && y <= page.height, `${label}: ${name} off the page (${x},${y})`);
  }
  for (const first of DOTS) {
    for (const second of DOTS) {
      if (first === second) continue;
      const apart = Math.hypot(dots[first].x - dots[second].x, dots[first].y - dots[second].y);
      assert.ok(apart >= 12, `${label}: ${first} and ${second} only ${apart}px apart`);
    }
  }
  return dots;
}

const roomy = assertUsable({ x: 200, y: 200, width: 300, height: 200 }, "middle of the page");
// The row sits below the box and the column to its left, with the dots at the box's edges.
assert.deepEqual(roomy.left, { x: 200, y: 416 });
assert.deepEqual(roomy.right, { x: 500, y: 416 });
assert.deepEqual(roomy.top, { x: 184, y: 200 });
assert.deepEqual(roomy.bottom, { x: 184, y: 400 });

assertUsable({ x: 300, y: 300, width: 0, height: 0 }, "zero-size box");
assertUsable({ x: 300, y: 100, width: 0, height: 300 }, "two stacked vertical lines");
assertUsable({ x: 100, y: 300, width: 300, height: 0 }, "two stacked horizontal lines");

// Against each edge the rail flips to the free side.
assert.ok(assertUsable({ x: 200, y: 580, width: 100, height: 20 }, "bottom edge").left.y < 580);
assert.ok(assertUsable({ x: 0, y: 200, width: 100, height: 100 }, "left edge").top.x > 100);
assertUsable({ x: 200, y: 0, width: 100, height: 50 }, "top edge");
assertUsable({ x: 700, y: 200, width: 100, height: 100 }, "right edge");
assertUsable({ x: 0, y: 0, width: 20, height: 20 }, "top-left corner");
assertUsable({ x: 780, y: 580, width: 20, height: 20 }, "bottom-right corner");

// Larger than the page, or off it altogether.
assertUsable({ x: 0, y: 0, width: 800, height: 600 }, "whole page");
assertUsable({ x: -200, y: -100, width: 1500, height: 1000 }, "bigger than the page");
assertUsable({ x: -100, y: 300, width: 150, height: 100 }, "partly off the left");
assertUsable({ x: 2000, y: 2000, width: 50, height: 50 }, "entirely off the page");

// Far zoomed out, or a small image: every dot still lands on the page, where it can be clicked.
for (const [width, height] of [[200, 150], [120, 90], [80, 60], [60, 45], [30, 30]]) {
  for (const box of [
    { x: width * 0.1, y: height * 0.1, width: width / 2, height: height / 2 },
    { x: 0, y: 0, width: 4, height: 4 },
    { x: width - 4, y: height - 4, width: 4, height: 4 },
    { x: 0, y: 0, width, height },
  ]) {
    const dots = alignDotLayout(box, width, height);
    for (const name of DOTS) {
      const { x, y } = dots[name];
      assert.ok(
        x >= 0 && x <= width && y >= 0 && y <= height,
        `${width}x${height} page, box ${JSON.stringify(box)}: ${name} off the page (${x},${y})`,
      );
    }
  }
}
// Down to a 120 px page the dots also stay clear of each other.
assertUsable({ x: 10, y: 10, width: 60, height: 45 }, "120x90 page", { width: 120, height: 90 });

// Moving keeps a markup's other fields out of the update.
assert.deepEqual(
  moveMarkupAction({ id: "m", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } }, 10, 20),
  { type: "UPDATE_MEASUREMENT", id: "m", updates: { start: { x: 11, y: 22 }, end: { x: 13, y: 24 } } },
);
assert.deepEqual(
  moveMarkupAction({ id: "r", topLeft: { x: 0, y: 0 }, bottomRight: { x: 5, y: 5 }, rotation: 30 }, 1, 1),
  { type: "UPDATE_RECTANGLE", id: "r", updates: { topLeft: { x: 1, y: 1 }, bottomRight: { x: 6, y: 6 } } },
);
assert.deepEqual(
  moveMarkupAction({ id: "n", position: { x: 0, y: 0 }, text: "hi" }, 2, 3),
  { type: "UPDATE_NOTE", id: "n", updates: { position: { x: 2, y: 3 } } },
);
assert.deepEqual(
  moveMarkupAction({ id: "s", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 1, 2).updates.points,
  [{ x: 1, y: 2 }, { x: 2, y: 3 }],
);
// A callout's card moves; its arrow tips (every other point) stay on what they mark.
assert.deepEqual(
  moveMarkupAction(
    { id: "c", kind: "callout", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] },
    5,
    5,
  ).updates.points,
  [{ x: 0, y: 0 }, { x: 15, y: 15 }, { x: 20, y: 20 }],
);
