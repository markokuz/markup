// Run: node app/utils/pageRanges.test.mjs
import assert from "node:assert/strict";
import { formatPageRanges, parsePageRanges } from "./pageRanges.ts";

const pages = (text, count = 42) => parsePageRanges(text, count).pages;
const error = (text, count = 42) => parsePageRanges(text, count).error;

// The forms from a printer dialog.
assert.deepEqual(pages("1-10"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.deepEqual(pages("1,2,3 5-8"), [0, 1, 2, 4, 5, 6, 7]);
assert.deepEqual(pages("7"), [6]);

// Commas and spaces mix; spaces around a dash stay part of the range; en and em dashes count.
assert.deepEqual(pages("5 - 8"), [4, 5, 6, 7]);
assert.deepEqual(pages("5–8"), [4, 5, 6, 7]);
assert.deepEqual(pages("5—8"), [4, 5, 6, 7]);
assert.deepEqual(pages(" 1 , 2,,3  "), [0, 1, 2]);
assert.deepEqual(pages("1-2, 4 -5,7"), [0, 1, 3, 4, 6]);

// Document order, whatever was typed, and each page once.
assert.deepEqual(pages("8 2 5"), [1, 4, 7]);
assert.deepEqual(pages("1-3 2-4 3"), [0, 1, 2, 3]);

// The last page is in range; one past it isn't, and the error says how many there are.
assert.deepEqual(pages("42"), [41]);
assert.match(error("43"), /has 42 pages/);
assert.match(error("40-43"), /Page 43/);
assert.match(error("2", 1), /has 1 page\./);

// Everything else is refused rather than guessed at.
assert.match(error(""), /Enter the pages/);
assert.match(error("   "), /Enter the pages/);
assert.match(error(", ,"), /Enter the pages/);
assert.match(error("0"), /start at 1/);
assert.match(error("0-3"), /start at 1/);
assert.match(error("8-5"), /backwards.*5-8/);
assert.match(error("abc"), /"abc" isn't a page/);
assert.match(error("1-"), /"1-" isn't/);
assert.match(error("-3"), /"-3" isn't/);
assert.match(error("1-2-3"), /"1-2-3" isn't/);
assert.match(error("1.5"), /"1.5" isn't/);

// Back to text, shortest form; parsing it gives the same pages.
assert.equal(formatPageRanges([0, 1, 2, 4]), "1-3, 5");
assert.equal(formatPageRanges([3]), "4");
assert.equal(formatPageRanges([]), "");
assert.equal(formatPageRanges([0, 2, 4]), "1, 3, 5");
for (const list of [[0], [0, 1], [0, 2, 3, 9], [5, 6, 7, 40, 41]]) {
  assert.deepEqual(pages(formatPageRanges(list)), list);
}

console.log("pageRanges: all checks passed");
