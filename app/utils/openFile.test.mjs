// Run: node app/utils/openFile.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { openDocumentFile, restoreSession } = await jiti.import("./openFile.ts");
const { buildProjectBlob } = await jiti.import("./projectFile.ts");
const { sessionsToDrop } = await jiti.import("./sessionStore.ts");

const fields = {
  fileName: "plan.png",
  fileType: "image",
  mimeType: "image/png",
  scale: null,
  measurements: [],
  rectangles: [],
  notes: [{ id: "n", position: { x: 1, y: 2 }, text: "Check" }],
  shapes: [],
  groups: [],
  displayUnit: "ft",
  zoom: 2,
  rotation: 90,
  toolColors: {},
};
const recorder = () => {
  const actions = [];
  return { actions, dispatch: (action) => actions.push(action) };
};

// A backup keeps the document as raw bytes beside the markups.
{
  const { actions, dispatch } = recorder();
  const project = buildProjectBlob({ ...fields, fileBytes: new Uint8Array() });
  await restoreSession(
    { id: "tab1", fileName: "plan.mkup", project, bytes: new Blob([new Uint8Array([7, 8, 9])]), handle: null, savedAt: 1 },
    dispatch,
    [],
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "LOAD_PROJECT");
  assert.equal(actions[0].tabId, "tab1");
  assert.deepEqual([...actions[0].bytes], [7, 8, 9]);
  assert.equal(actions[0].notes[0].text, "Check");
  assert.equal(actions[0].zoom, 2);
}

// An older backup, and an opened .mkup, hold the document inside the project.
{
  const { actions, dispatch } = recorder();
  const project = buildProjectBlob({ ...fields, fileBytes: new Uint8Array([1, 2, 3]) });
  await restoreSession({ id: "tab2", fileName: "plan.mkup", project, handle: null, savedAt: 1 }, dispatch, []);
  assert.deepEqual([...actions[0].bytes], [1, 2, 3]);
}

// A file already open in a tab switches to that tab instead of opening it again.
const handle = (name) => ({ name, isSameEntry: async (other) => other.name === name });
{
  const { actions, dispatch } = recorder();
  const tabs = [
    { id: "unlinked", projectHandle: null },
    { id: "other", projectHandle: handle("other.pdf") },
    { id: "plan", projectHandle: handle("plan.pdf") },
  ];
  await openDocumentFile(new File(["x"], "plan.pdf"), dispatch, handle("plan.pdf"), tabs);
  assert.deepEqual(actions, [{ type: "SWITCH_TAB", tabId: "plan" }]);
}

// A different file opens normally.
{
  const { actions, dispatch } = recorder();
  const tabs = [{ id: "other", projectHandle: handle("other.png") }];
  await openDocumentFile(new File(["x"], "plan.png"), dispatch, handle("plan.png"), tabs);
  assert.equal(actions[0].type, "LOAD_FILE");
}

// A backup whose file is open switches too.
{
  const { actions, dispatch } = recorder();
  const project = buildProjectBlob({ ...fields, fileBytes: new Uint8Array() });
  const tabs = [{ id: "plan", projectHandle: handle("plan.mkup") }];
  await restoreSession(
    { id: "tab3", fileName: "plan.mkup", project, handle: handle("plan.mkup"), savedAt: 1 },
    dispatch,
    tabs,
  );
  assert.deepEqual(actions, [{ type: "SWITCH_TAB", tabId: "plan" }]);
}

// Only backups past the newest 20 are dropped, whatever order they come back in.
const backups = Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, savedAt: (i * 7) % 23 }));
const newestFirst = [...backups].sort((a, b) => b.savedAt - a.savedAt);
assert.deepEqual(new Set(sessionsToDrop(backups)), new Set(newestFirst.slice(20).map((b) => b.id)));
assert.deepEqual(sessionsToDrop(backups.slice(0, 20)), []);

console.log("openFile: all checks passed");
