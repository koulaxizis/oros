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

test("shell: #app-frame is looked up only in section 10 (frames, open/close) and two old helpers", () => {
  const start = SHELL.indexOf("// ---------- 10. App opening");
  const end = SHELL.indexOf("// ---------- 11. Menu open/close");
  assert.ok(start > 0 && end > start);
  const outside = (SHELL.slice(0, start) + SHELL.slice(end)).split("\n").filter((l) => l.includes('getElementById("app-frame")'));
  // frameTitle, refreshRunningApp
  assert.equal(outside.length, 2, outside.join("\n"));
});

test("shell: every live push into a named app finds its frame through appFrameOf", () => {
  // The old inline pattern must not come back in a new bridge.
  assert.doesNotMatch(SHELL, /state\.running && state\.running\.id === ("[a-z0-9]+"|appId)\) \{\s*(\/\/[^\n]*\s*)*(closeMenu\(\);\s*menuReset\(\);\s*)?var f = /);
  const uses = SHELL.match(/var f = appFrameOf\(/g) || [];
  assert.ok(uses.length >= 30, "bridges through appFrameOf: " + uses.length);
  // Each appFrameOf(X) sits under an appLive(X) guard for the same app,
  // and an open-type bridge brings a hidden app forward first.
  const re = /if \(appLive\(("[a-z0-9]+"|appId)\)\) \{[\s\S]{0,200}?var f = appFrameOf\(("[a-z0-9]+"|appId)\)/g;
  let m, n = 0;
  while ((m = re.exec(SHELL))) { assert.equal(m[1], m[2]); n++; }
  assert.equal(n, uses.length);
  const shows = SHELL.match(/appShow\(("[a-z0-9]+"|appId)\);[^\n]*\n\s*var f = appFrameOf\(/g) || [];
  assert.equal(shows.length, uses.length - 4, "all but the 4 background pushes (timesheet x3, cycle check)");
});

// ---------- the frame code of shell.js in a sandbox ----------
class FakeFrame {
  constructor(doc) {
    this.attrs = {};
    this.style = { display: "" };
    this.listeners = {};
    this.parentNode = null;
    this.loads = [];
    this._doc = doc || null;
  }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = v; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  set src(u) {
    this._src = u;
    this.loads.push(u);
    if (u === "about:blank") { this._doc = null; return; }
    const events = [];
    const win = { location: { href: "http://x/" + u }, Event: class { constructor(t) { this.type = t; } }, events };
    this._doc = { url: u, defaultView: win, querySelectorAll: () => [], dispatchEvent: (e) => events.push(e.type) };
    win.document = this._doc;
  }
  get src() { return this._src; }
  get contentDocument() { return this._doc; }
  get contentWindow() { return this._doc ? this._doc.defaultView : { location: { href: "about:blank" } }; }
}

function sandbox(opts) {
  const vm = require("vm");
  const start = SHELL.indexOf("  function appFrames() {");
  const end = SHELL.indexOf("  function openApp(app, at) {");
  assert.ok(start > 0 && end > start);
  const store = new Map(Object.entries(opts.storage || {}));
  const running = { children: [], appendChild(f) { f.parentNode = this; this.children.push(f); }, removeChild(f) { this.children.splice(this.children.indexOf(f), 1); f.parentNode = null; } };
  const first = new FakeFrame();
  first.id = "app-frame";
  running.appendChild(first);
  const ctx = {
    state: { running: null },
    SOLO: opts.solo || "",
    navigator: { deviceMemory: opts.mem },
    innerWidth: opts.width || 1280,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: {
      getElementById: (id) => (id === "oros-running" ? running : running.children.find((f) => f.id === id) || null),
      createElement: () => new FakeFrame(),
    },
    cmdWireFrame: () => {},
    Date, Array, Object,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SHELL.slice(start, end) +
    "\nthis.h = { appFrames, appFrameOf, appLive, mtSlots, mtSwitch, mtLeave, mtKeepable, mtSetUser, mtSnapshot, mtActive, mtList };" +
    // the parts of openApp / returnToDesktop that touch frames
    "\nthis.open = function (app, at) { var prev = state.running; state.running = app; if (mtActive()) mtSwitch(prev, app, at); else document.getElementById('app-frame').src = app.url + (at || ''); };" +
    "\nthis.home = function () { var prev = state.running; state.running = null; if (!(mtActive() && mtLeave(prev))) document.getElementById('app-frame').src = 'about:blank'; };" +
    "\nthis.openApp = this.open;", ctx);
  ctx.running = running;
  return ctx;
}
const app = (id) => ({ id, type: "internal", url: id + "/" });

test("shell: with multitasking off there is one frame, exactly as before", () => {
  const c = sandbox({});
  const h = c.h;
  assert.equal(h.mtActive(), false);
  c.open(app("notes"));
  c.open(app("todo"));
  assert.equal(c.running.children.length, 1);
  assert.deepEqual(c.running.children[0].loads, ["notes/", "todo/"]);
  assert.equal(h.appLive("notes"), false);
  assert.equal(h.appLive("todo"), true);
  c.home();
  assert.equal(c.running.children[0].src, "about:blank");
  assert.equal(c.__orosAppDocs().length, 0, "nothing running: no live document");
  assert.equal(h.mtList().length, 0);
});

test("shell: a single app (SOLO) never multitasks, even with the switch on", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, solo: "todo" });
  assert.equal(c.h.mtActive(), false);
  assert.equal(c.h.mtSnapshot(), null);
});

test("shell: slots follow the device memory, else the screen width", () => {
  const { mtSlots } = sandbox({}).h;
  assert.equal(mtSlots(0.5, 400), 2);
  assert.equal(mtSlots(1, 400), 2);
  assert.equal(mtSlots(2, 400), 3);
  assert.equal(mtSlots(4, 1280), 4);
  assert.equal(mtSlots(8, 1280), 8);
  assert.equal(mtSlots(undefined, 400), 3);
  assert.equal(mtSlots(undefined, 1280), 6);
});

test("shell: multitasking on keeps the app you leave alive, hidden, and brings it back without a reload", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8 });
  const h = c.h;
  c.open(app("notes"));
  const notesFrame = c.running.children[0];
  c.open(app("todo"));
  assert.equal(c.running.children.length, 2);
  assert.equal(notesFrame.id, "", "the hidden frame gives up the id");
  assert.equal(notesFrame.style.display, "none");
  assert.equal(notesFrame.getAttribute("data-oros-app"), "notes");
  assert.equal(notesFrame.contentDocument.visibilityState, "hidden");
  assert.deepEqual(notesFrame.contentWindow.events, ["visibilitychange"]);
  assert.equal(h.appLive("notes"), true);
  assert.equal(h.appFrameOf("notes"), notesFrame);
  assert.equal(c.__orosAppDocs().length, 2, "sync sees both documents as live");
  c.open(app("notes"));
  assert.equal(notesFrame.id, "app-frame");
  assert.equal(notesFrame.style.display, "");
  assert.deepEqual(notesFrame.loads, ["notes/"], "no reload");
  assert.equal(notesFrame.contentDocument.visibilityState, undefined, "the override is gone");
  assert.equal(c.running.children.filter((f) => f.id === "app-frame").length, 1, "one front frame");
  assert.equal(h.appFrameOf("todo").style.display, "none");
});

test("shell: apps on the close-on-leave list close as before", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8 });
  c.open(app("mail"));
  c.open(app("notes"));
  assert.equal(c.running.children.length, 1, "Mail's frame was reused");
  assert.equal(c.h.appLive("mail"), false);
  assert.equal(c.h.mtKeepable(app("passwords")), false);
  assert.equal(c.h.mtKeepable(app("camera-less")), true);
  assert.equal(c.h.mtKeepable({ id: "x", type: "external", url: "https://x" }), false);
});

test("shell: when the slots are full the app used longest ago closes; heavy apps count twice", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 1 });   // 2 slots
  const h = c.h;
  c.open(app("notes"));
  c.open(app("todo"));
  assert.deepEqual(Array.from(h.mtList(), (r) => r.app.id), ["notes"]);
  c.open(app("writer"));                      // notes (oldest) closes
  assert.deepEqual(Array.from(h.mtList(), (r) => r.app.id), ["todo"]);
  assert.equal(h.appLive("notes"), false);
  c.open(app("atelier"));                     // heavy: 2 slots alone
  assert.equal(h.mtList().length, 0);
  assert.equal(c.running.children.length, 1);
});

test("shell: going home keeps the app alive behind a fresh empty front frame; the switch off closes all", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8 });
  const h = c.h;
  c.open(app("notes"));
  c.home();
  assert.equal(h.appLive("notes"), true);
  const front = c.document.getElementById("app-frame");
  assert.equal(front.contentDocument, null, "an empty front frame");
  assert.equal(c.running.children.length, 2);
  c.open(app("todo"));
  assert.equal(c.running.children.length, 2, "the empty front frame is used");
  h.mtSetUser(false);
  assert.equal(h.mtList().length, 0);
  assert.equal(c.running.children.length, 1);
  assert.equal(h.mtSnapshot().on, false);
});

test("shell: reopening the app in front reloads it, as before", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8 });
  c.open(app("notes"));
  c.open(app("notes"), "#x");
  assert.deepEqual(c.running.children[0].loads, ["notes/", "notes/#x"]);
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
