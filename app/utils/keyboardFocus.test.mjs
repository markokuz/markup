// Run: node app/utils/keyboardFocus.test.mjs
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isLeftoverFocus, isTextEntry } = await jiti.import("./keyboardFocus.ts");

const element = (tagName, fields = {}, inside = false) => ({
  tagName,
  isContentEditable: false,
  closest: () => (inside ? {} : null),
  ...fields,
});

// Fields that keys type into, and controls they don't.
assert.equal(isTextEntry(element("INPUT", { type: "text" })), true);
assert.equal(isTextEntry(element("TEXTAREA")), true);
assert.equal(isTextEntry(element("DIV", { isContentEditable: true })), true);
assert.equal(isTextEntry(element("INPUT", { type: "range" })), false);
assert.equal(isTextEntry(element("INPUT", { type: "checkbox" })), false);
assert.equal(isTextEntry(element("SELECT")), false);
assert.equal(isTextEntry(element("BUTTON")), false);

// A clicked button, select or slider gives the keys back to the app; the page itself does too.
assert.equal(isLeftoverFocus(element("BUTTON")), true);
assert.equal(isLeftoverFocus(element("SELECT")), true);
assert.equal(isLeftoverFocus(element("INPUT", { type: "range" })), true);
assert.equal(isLeftoverFocus(element("BODY")), true);

// A text field keeps its keys, and so does anything in a dialog or an open menu.
assert.equal(isLeftoverFocus(element("INPUT", { type: "text" })), false);
assert.equal(isLeftoverFocus(element("BUTTON", {}, true)), false);

console.log("keyboardFocus tests passed");
