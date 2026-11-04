// Run: node app/utils/markupList.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { rowsToCsv } = await jiti.import("./markupList.ts");

const row = (fields) => ({ id: "x", type: "Note", name: "", color: "#000000", text: "", display: "", ...fields });
const cells = (fields) => rowsToCsv([row(fields)], "ft").split("\r\n")[1];

// Text a spreadsheet would run as a formula is neutralised, however it starts.
assert.equal(cells({ text: "=1+1" }), ",Note,,'=1+1,,,,,,#000000");
assert.equal(cells({ text: "+1" }), ",Note,,'+1,,,,,,#000000");
assert.equal(cells({ text: "-1" }), ",Note,,'-1,,,,,,#000000");
assert.equal(cells({ text: "@SUM(A1)" }), ",Note,,'@SUM(A1),,,,,,#000000");
assert.equal(cells({ name: "=cmd" }), ",Note,'=cmd,,,,,,,#000000");
assert.equal(cells({ text: '=HYPERLINK("http://x")' }), `,Note,,"'=HYPERLINK(""http://x"")",,,,,,#000000`);

// Line breaks and commas stay inside one quoted cell.
assert.equal(cells({ text: "line1\rline2" }), `,Note,,"line1\rline2",,,,,,#000000`);
assert.equal(cells({ text: "line1\nline2" }), `,Note,,"line1\nline2",,,,,,#000000`);
assert.equal(cells({ text: "a, b" }), `,Note,,"a, b",,,,,,#000000`);

// Ordinary text and every number are left alone, negative or not.
assert.equal(cells({ text: "Check this" }), ",Note,,Check this,,,,,,#000000");
assert.equal(cells({ type: "Length", length: 5.5555 }), ",Length,,,5.556,,,,,#000000");
assert.equal(cells({ type: "Length", length: -5 }), ",Length,,,-5,,,,,#000000");

console.log("markupList: all checks passed");
