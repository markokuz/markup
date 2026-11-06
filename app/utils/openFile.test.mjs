// Run: node app/utils/openFile.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { openDocumentFile, openDroppedFiles, openInputFiles, pickAndOpenFile, restoreSession } =
  await jiti.import("./openFile.ts");
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

// Dropped files each open in order; text items and unsupported files are skipped, and an open file switches.
{
  const { actions, dispatch } = recorder();
  const fileItem = (name, itemHandle) => ({
    kind: "file",
    getAsFile: () => new File(["x"], name),
    getAsFileSystemHandle: async () => itemHandle,
  });
  const items = [
    { kind: "string", getAsFile: () => null },
    fileItem("a.png"),
    fileItem("notes.txt"),
    fileItem("b.pdf", { ...handle("b.pdf"), kind: "file" }),
    fileItem("open.pdf", { ...handle("open.pdf"), kind: "file" }),
    fileItem("c.png"),
  ];
  await openDroppedFiles({ items }, dispatch, [{ id: "open", projectHandle: handle("open.pdf") }]);
  assert.deepEqual(
    actions.map((action) => action.fileName ?? action.tabId),
    ["a.png", "b.pdf", "open", "c.png"],
  );
  assert.equal(actions[0].handle, null);
  assert.equal(actions[1].handle.name, "b.pdf");
}

// The picker offers multi-select and opens each pick in order; an unreadable file doesn't stop the rest.
{
  const { actions, dispatch } = recorder();
  const alerts = [];
  const picked = (name) => ({ ...handle(name), getFile: async () => new File(["x"], name) });
  const unreadable = {
    name: "gone.pdf",
    getFile: async () => {
      throw new Error("not readable");
    },
  };
  let options;
  globalThis.window = {
    alert: (message) => alerts.push(message),
    showOpenFilePicker: async (given) => {
      options = given;
      return [picked("a.png"), unreadable, picked("b.pdf"), picked("open.pdf")];
    },
  };
  await pickAndOpenFile(dispatch, null, [{ id: "open", projectHandle: handle("open.pdf") }]);
  delete globalThis.window;
  assert.equal(options.multiple, true);
  assert.deepEqual(
    actions.map((action) => action.fileName ?? action.tabId),
    ["a.png", "b.pdf", "open"],
  );
  assert.equal(actions[0].handle, null);
  assert.equal(actions[1].handle.name, "b.pdf");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /gone\.pdf/);
}

// The fallback input opens every file, even though clearing it empties its live list.
{
  const { actions, dispatch } = recorder();
  const live = [new File(["x"], "a.png"), new File(["x"], "b.png")];
  const input = {
    files: live,
    set value(_) {
      live.length = 0;
    },
  };
  await openInputFiles(input, dispatch);
  assert.deepEqual(actions.map((action) => action.fileName), ["a.png", "b.png"]);
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

// Opening many .mkups pushes out their own copies before an older backup from a save.
{
  const saved = { id: "saved", savedAt: 0, bytes: new Blob(["x"]) };
  const opened = Array.from({ length: 22 }, (_, i) => ({ id: `o${i}`, savedAt: i + 1 }));
  assert.deepEqual(new Set(sessionsToDrop([saved, ...opened])), new Set(["o0", "o1", "o2"]));
}

// Every file is read before any tab opens, so a batch opens in one go.
{
  const { actions, dispatch } = recorder();
  const seen = [];
  class WatchedFile extends File {
    arrayBuffer() {
      seen.push(actions.length);
      return super.arrayBuffer();
    }
  }
  const input = { files: [new WatchedFile(["x"], "a.png"), new WatchedFile(["x"], "b.png")], value: "" };
  await openInputFiles(input, dispatch);
  assert.deepEqual(seen, [0, 0]);
  assert.equal(actions.length, 2);
}

console.log("openFile: all checks passed");
