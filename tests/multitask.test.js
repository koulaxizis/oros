// Multitasking groundwork (wave M1): one place for app frames in the
// shell, and SY-D5 over a SET of live frame documents in sync.js.
// With multitasking off (the only mode today) both must behave exactly
// as the single #app-frame did.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { FakeDropbox, createDevice } = require("./harness");

const ROOT = path.join(__dirname, "..");
const SHELL = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");

test("shell: #app-frame is looked up only by the frame helpers and the open/close core", () => {
  const lines = SHELL.split("\n").filter((l) => l.includes('getElementById("app-frame")'));
  // appFrames, appFrameOf, frameTitle, refreshRunningApp, openApp, returnToDesktop
  assert.equal(lines.length, 6, lines.join("\n"));
  for (const l of lines) {
    assert.match(l, /var f = document|return document|\.src = /, l);
  }
});

test("shell: every live push into a named app finds its frame through appFrameOf", () => {
  // The old inline pattern must not come back in a new bridge.
  assert.doesNotMatch(SHELL, /state\.running && state\.running\.id === ("[a-z0-9]+"|appId)\) \{\s*(\/\/[^\n]*\s*)*(closeMenu\(\);\s*menuReset\(\);\s*)?var f = /);
  const uses = SHELL.match(/var f = appFrameOf\(/g) || [];
  assert.ok(uses.length >= 30, "bridges through appFrameOf: " + uses.length);
  // Each appFrameOf(X) sits under an appLive(X) guard for the same app.
  const re = /if \(appLive\(("[a-z0-9]+"|appId)\)\) \{[\s\S]{0,200}?var f = appFrameOf\(("[a-z0-9]+"|appId)\)/g;
  let m, n = 0;
  while ((m = re.exec(SHELL))) { assert.equal(m[1], m[2]); n++; }
  assert.equal(n, uses.length);
});

test("shell: frame helpers mirror the single frame (multitasking off)", () => {
  const vm = require("vm");
  const start = SHELL.indexOf("  function appFrames() {");
  const end = SHELL.indexOf("  // ---------- 10. App opening");
  assert.ok(start > 0 && end > start);
  const frame = { contentDocument: { id: "doc" }, contentWindow: {} };
  const ctx = { state: { running: null }, document: { getElementById: (id) => (id === "app-frame" ? frame : null) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SHELL.slice(start, end) + "\nthis.h = { appFrames, appFrameOf, appLive };", ctx);
  const h = ctx.h;
  assert.equal(h.appFrames().length, 1);
  assert.equal(h.appFrameOf("notes"), null);
  assert.equal(h.appLive("notes"), false);
  assert.equal(ctx.__orosAppDocs().length, 0, "nothing running: no live document");
  ctx.state.running = { id: "notes" };
  assert.equal(h.appFrameOf("notes"), frame);
  assert.equal(h.appLive("notes"), true);
  assert.equal(h.appLive("todo"), false);
  const docs = ctx.__orosAppDocs();
  assert.equal(docs.length, 1);
  assert.equal(docs[0], frame.contentDocument);
});

// A frame document as sync.js sees it: its window makes the functions.
function fakeDoc(name) { return { name, defaultView: { Function } }; }

async function deviceWithDocs(live) {
  const dev = await createDevice(new FakeDropbox(), "A", {});
  dev.ctx.__orosAppDocs = () => live.slice();
  dev.localStorage.setItem("app-x", JSON.stringify({ v: "stored" }));
  return dev;
}
const exported = (dev) => JSON.parse(dev.sync.exportData()).apps.x;

test("sync SY-D5: an app in a live frame keeps its live slice", async () => {
  const docA = fakeDoc("A");
  const live = [docA];
  const dev = await deviceWithDocs(live);
  dev.sync.registerSlice("x", () => ({ v: "memory" }), () => {}, "app-x");
  assert.deepEqual(exported(dev), { v: "memory" });
});

test("sync SY-D5: a hidden frame (still in the live set) stays live; a closed one goes back to stored", async () => {
  const docA = fakeDoc("A"), docB = fakeDoc("B");
  const live = [docA, docB];
  const dev = await createDevice(new FakeDropbox(), "A", {});
  dev.ctx.__orosAppDocs = () => live.slice();
  dev.localStorage.setItem("app-x", JSON.stringify({ v: "stored" }));
  // Registered while both frames are live: the owner is the first frame
  // whose window made the getter (here both share Node's realm, so A).
  dev.sync.registerSlice("x", () => ({ v: "memory" }), () => {}, "app-x");
  live.splice(1, 1);                       // B closes, A (the owner) stays hidden
  assert.deepEqual(exported(dev), { v: "memory" });
  live.splice(0, 1);                       // A closes too
  assert.deepEqual(exported(dev), { v: "stored" });
});

test("sync SY-D5: the owner is the frame whose window made the getter", async () => {
  const vm = require("vm");
  const other = vm.createContext({});
  const docA = { name: "A", defaultView: { Function: vm.runInContext("Function", other) } };
  const docB = fakeDoc("B");
  const live = [docA, docB];
  const dev = await createDevice(new FakeDropbox(), "A", {});
  dev.ctx.__orosAppDocs = () => live.slice();
  dev.localStorage.setItem("app-x", JSON.stringify({ v: "stored" }));
  dev.sync.registerSlice("x", () => ({ v: "memory" }), () => {}, "app-x");   // made in B's realm
  live.splice(0, 1);                       // A closes: B's app is still live
  assert.deepEqual(exported(dev), { v: "memory" });
  live.splice(0, 1);                       // B closes
  assert.deepEqual(exported(dev), { v: "stored" });
});

test("sync SY-D5: without the shell helper, the single #app-frame rule is unchanged", async () => {
  const dev = await createDevice(new FakeDropbox(), "A", {});
  const frame = { contentDocument: fakeDoc("A") };
  dev.ctx.document.getElementById = (id) => (id === "app-frame" ? frame : null);
  dev.localStorage.setItem("app-x", JSON.stringify({ v: "stored" }));
  dev.sync.registerSlice("x", () => ({ v: "memory" }), () => {}, "app-x");
  assert.deepEqual(exported(dev), { v: "memory" });
  frame.contentDocument = fakeDoc("blank");   // the frame shows another document
  assert.deepEqual(exported(dev), { v: "stored" });
});

test("qa memory.js: weights and summary", () => {
  const M = require("../.github/qa/memory.js");
  const MB = 1048576;
  assert.equal(M.weightOf({ id: "notes", bytes: 2 * MB, canvas: 0, gl: 0 }), 1);
  assert.equal(M.weightOf({ id: "studio", bytes: 1 * MB, canvas: 0, gl: 0 }), 2, "declared heavy");
  assert.equal(M.weightOf({ id: "x", bytes: 15 * MB, canvas: 6 * MB, gl: 0 }), 2, "over the byte limit");
  assert.equal(M.weightOf({ id: "y", bytes: 1 * MB, canvas: 0, gl: 1 }), 2, "WebGL");
  const s = M.summarize([
    { id: "a", opened: true, bytes: 1 * MB, canvas: 0, gl: 0, retained: [] },
    { id: "b", opened: true, bytes: 3 * MB, canvas: 0, gl: 0, retained: ["a"] },
    { id: "c", opened: false, bytes: 0, canvas: 0, gl: 0, retained: [] },
  ]);
  assert.equal(s.opened, 2);
  assert.deepEqual(s.failed, ["c"]);
  assert.deepEqual(s.retained, ["b (a)"]);
  assert.match(M.report([{ id: "a", opened: true, bytes: MB, canvas: 0, nodes: 3, gl: 0, retained: [] }], 10 * MB), /The shell itself: 10\.0 MB/);
});

test("qa writers.js: finds foreign writers, hosts and listeners", () => {
  const W = require("../.github/qa/writers.js");
  assert.equal(W.writes('var K = "oros-a-data"; localStorage.setItem(K, x);', "oros-a-data"), true);
  assert.equal(W.writes('localStorage.getItem("oros-a-data")', "oros-a-data"), false);
  const files = {
    "index.html": '<script src="a/host.js"></script><script src="shell.js"></script>',
    "shell.js": 'localStorage.setItem("oros-b-data", "1");',
    "a/index.html": '<script src="a.js"></script>',
    "a/a.js": 'localStorage.setItem("oros-a-data", "1");',
    "a/host.js": 'localStorage.setItem("oros-a-data", "2");',
    "b/index.html": '<script src="b.js"></script>',
    "b/b.js": 'localStorage.setItem("oros-b-data", "1"); addEventListener("storage", f);',
    "c/index.html": '<script src="c.js"></script>',
    "c/c.js": 'localStorage.setItem("oros-c-data", "1");',
    "d/index.html": '<script src="d.js"></script><script src="../c/c.js"></script>',
    "d/d.js": "",
  };
  const apps = ["a", "b", "c", "d"].map((id) => ({ id, url: id + "/" }));
  const v = Object.fromEntries(W.scan(files, apps).map((r) => [r.id, r.verdict]));
  assert.deepEqual(v, { a: "host", b: "listens", c: "check", d: "ok" });
});
