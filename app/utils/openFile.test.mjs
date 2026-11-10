// Run: node app/utils/openFile.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { openDocumentFile, openDroppedFiles, openInputFiles, pickAndOpenFile } = await jiti.import("./openFile.ts");

const recorder = () => {
  const actions = [];
  return { actions, dispatch: (action) => actions.push(action) };
};

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
