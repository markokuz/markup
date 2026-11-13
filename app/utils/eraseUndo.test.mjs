// Run: node app/utils/eraseUndo.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root }, jsx: true });
const { appReducer } = await jiti.import("../context/AppContext.tsx");
const { initialTabsState } = await jiti.import("../types/index.ts");

const original = new Uint8Array([1]);
let state = appReducer(initialTabsState, {
  type: "LOAD_FILE",
  bytes: original,
  fileName: "plan.pdf",
  fileType: "pdf",
  mimeType: "application/pdf",
});
const tabId = state.activeTabId;
const tab = () => state.tabs.find((t) => t.id === tabId);
const erase = (from, bytes) => (state = appReducer(state, { type: "ERASE_CONTENT", tabId, from, bytes, page: 0 }));

// Erasing swaps the file and marks the tab unsaved; undo and redo swap it back and forth.
const erased = new Uint8Array([2]);
erase(original, erased);
assert.equal(tab().fileBytes, erased);
assert.equal(tab().dirty, true);
state = appReducer(state, { type: "UNDO" });
assert.equal(tab().fileBytes, original);
state = appReducer(state, { type: "REDO" });
assert.equal(tab().fileBytes, erased);

// An erase made from a file the tab no longer has is dropped.
erase(original, new Uint8Array([3]));
assert.equal(tab().fileBytes, erased);

// Undo keeps at most 10 older copies of the file; the oldest erases can no longer be undone.
let current = erased;
for (let i = 0; i < 15; i++) {
  const next = new Uint8Array([10 + i]);
  erase(current, next);
  current = next;
}
const held = new Set(tab().history.map((step) => step.fileBytes));
assert.equal(held.size, 10);
assert.ok(!held.has(original));
const oldest = tab().history[0].fileBytes;
for (let i = 0; i < 10; i++) state = appReducer(state, { type: "UNDO" });
assert.equal(tab().history.length, 0);
assert.equal(tab().fileBytes, oldest);

console.log("eraseUndo tests passed");
