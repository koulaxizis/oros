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
  assert.equal(shows.length, uses.length - 5, "all but the 5 background pushes (timesheet x3, cycle check, contacts/CRM sync reload)");
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
    const cls = new Set();
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) };
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
    const win = { location: { href: "http://x/" + u }, Event: class { constructor(t) { this.type = t; } }, events, on: {},
      addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); } };
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
  const rcls = new Set();
  const running = { classList: { add: (c) => rcls.add(c), remove: (c) => rcls.delete(c), contains: (c) => rcls.has(c) }, children: [], appendChild(f) { f.parentNode = this; this.children.push(f); }, removeChild(f) { this.children.splice(this.children.indexOf(f), 1); f.parentNode = null; } };
  const first = new FakeFrame();
  first.id = "app-frame";
  running.appendChild(first);
  const on = {};
  const ctx = {
    state: { running: null, apps: (opts.apps || []).map((id) => ({ id, type: "internal", url: id + "/" })) },
    location: { href: "http://x/index.html", pathname: "/index.html" },
    addEventListener: (t, fn) => { (on[t] = on[t] || []).push(fn); },
    __on: on,
    URL, setTimeout,
    SOLO: opts.solo || "",
    navigator: { deviceMemory: opts.mem },
    innerWidth: opts.width || 1280,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: {
      getElementById: (id) => (id === "oros-running" ? running : running.children.find((f) => f.id === id) || null),
      createElement: () => new FakeFrame(),
    },
    cmdWireFrame: () => {},
    extWireFrame: () => {},
    Date, Array, Object,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SHELL.slice(start, end) +
    "\nthis.h = { appFrames, appFrameOf, appLive, mtSlots, mtSwitch, mtLeave, mtKeepable, mtSetUser, mtSnapshot, mtActive, mtList, mtOpenList, mtClose, mtCloseAll, mtSideOpen, mtSideEnd, mt, mtOwns };" +
    // the parts of openApp / returnToDesktop that touch frames
    "\nthis.open = function (app, at) { var prev = state.running; state.running = app; if (mtActive()) mtSwitch(prev, app, at); else document.getElementById('app-frame').src = app.url + (at || ''); };" +
    "\nthis.home = function () { var prev = state.running; state.running = null; if (!(mtActive() && mtLeave(prev))) document.getElementById('app-frame').src = 'about:blank'; };" +
    "\nthis.openApp = this.open; this.returnToDesktop = this.home;", ctx);
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

test("shell switcher: the list is the app in front, then the ones left last first; closing one or all", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8 });
  const h = c.h;
  const ids = () => Array.from(h.mtOpenList(), (r) => r.app.id + (r.front ? "*" : ""));
  c.open(app("notes"));
  c.open(app("todo"));
  h.mtList().forEach((r) => { r.at -= 1000; });   // todo is left later than notes
  c.open(app("writer"));
  assert.deepEqual(ids(), ["writer*", "todo", "notes"]);
  h.mtClose("todo");
  assert.deepEqual(ids(), ["writer*", "notes"]);
  assert.equal(h.appLive("todo"), false);
  h.mtClose("writer");                      // the app in front closes for good, it is not kept
  assert.deepEqual(ids(), ["notes"]);
  assert.equal(c.state.running, null);
  assert.equal(c.document.getElementById("app-frame").src, "about:blank");
  c.open(app("calculator"));
  h.mtCloseAll();
  assert.deepEqual(ids(), []);
  assert.equal(c.running.children.length, 1, "one empty frame, as at boot");
});

test("shell switcher: Ctrl+Alt+Shift+W, the bar button and the menu / Dock marks", () => {
  const defs = SHELL.slice(SHELL.indexOf("var SC_DEFS = ["), SHELL.indexOf("];", SHELL.indexOf("var SC_DEFS = [")));
  assert.match(defs, /key: "w", label: "sc\.desc\.switcher",\s*fn: function\(\) \{ mtSwitcher\(\); \}/);
  assert.match(SHELL, /mtOnChange = mtPaint;/);
  assert.match(SHELL, /btn\.id = "mt-btn";/);
  assert.match(SHELL, /isOpen: function \(id\) \{ return mtActive\(\) && appLive\(id\); \}/);
  assert.match(fs.readFileSync(path.join(ROOT, "launcher.js"), "utf8"), /host\.isOpen && host\.isOpen\(id\) \? " open"/);
  // every visible string exists in English, Greek and German
  const tr = fs.readFileSync(path.join(ROOT, "translations.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/shell.js"), "utf8");
  const keys = [...new Set([...SHELL.matchAll(/window\.t\("(mt\.(?:sw|split)\.[a-z]+)"\)/g)].map((m) => m[1]))]
    .concat(["sc.desc.switcher", "mt.sw.tip", "mt.sw.split.beside", "mt.sw.split.pick", "mt.sw.split.stop"]);
  assert.ok(keys.length >= 10);
  keys.forEach((k) => {
    assert.equal(tr.split('"' + k + '"').length - 1, 2, k + " in translations.js EN + EL");
    assert.ok(de.includes('"' + k + '"'), k + " in i18n/de/shell.js");
  });
});

test("shell side by side: a background app opens beside the one in front, live, and steps back after", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, width: 1280 });
  const h = c.h;
  c.open(app("notes"));
  const notes = c.running.children[0];
  c.open(app("todo"));
  assert.equal(h.mtSideOpen(app("notes")), true);
  assert.equal(notes.getAttribute("data-oros-side"), "notes");
  assert.equal(notes.style.display, "");
  assert.deepEqual(notes.loads, ["notes/"], "same window, no reload");
  assert.equal(c.running.classList.contains("mt-split"), true);
  assert.equal(h.appFrameOf("notes"), notes);
  assert.equal(h.appFrames().length, 2);
  assert.equal(c.__orosAppDocs().length, 2);
  assert.deepEqual(Array.from(h.mtOpenList(), (r) => r.app.id + (r.front ? "*" : r.side ? "|" : "")), ["todo*", "notes|"]);
  assert.equal(h.mtSideOpen(app("todo")), false, "not the app in front");
  h.mtSideEnd(true);
  assert.equal(c.running.classList.contains("mt-split"), false);
  assert.equal(notes.getAttribute("data-oros-app"), "notes", "back in the background");
  assert.equal(notes.style.display, "none");
  // a fresh app beside; closing the one in front gives the side app the screen
  assert.equal(h.mtSideOpen(app("writer")), true);
  const writer = h.appFrameOf("writer");
  h.mtClose("todo");
  assert.equal(c.state.running.id, "writer");
  assert.equal(c.document.getElementById("app-frame"), writer);
  assert.deepEqual(writer.loads, ["writer/"], "no reload");
  assert.equal(h.appLive("todo"), false, "closed, not kept");
  assert.equal(h.mt.side, null);
});

test("shell side by side: only from 1024 px wide, and switching off ends it", () => {
  const narrow = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, width: 900 });
  narrow.open(app("notes"));
  narrow.open(app("todo"));
  assert.equal(narrow.h.mtSideOpen(app("notes")), false);
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, width: 1280 });
  c.open(app("notes"));
  c.open(app("todo"));
  c.h.mtSideOpen(app("notes"));
  c.h.mtSetUser(false);
  assert.equal(c.h.mt.side, null);
  assert.equal(c.running.children.length, 1);
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

// MT-S1: a write by another window must not be undone by a live app's
// old copy (found 2026-10-27: a hidden To-Do saved over a task the
// Assistant had just added).
const storageIn = (frame, key) => (frame.contentWindow.on.storage || []).forEach((fn) => fn({ key }));
const storageInShell = (c, key, url) => (c.__on.storage || []).forEach((fn) => fn({ key, url }));
const tick = () => new Promise((r) => setTimeout(r, 5));

test("shell MT-S1: another window writing a hidden app's keys closes that app; other keys and hosted apps do not", async () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, apps: ["todo", "notes", "music", "writer"] });
  const h = c.h;
  c.open(app("todo"));
  const todoFrame = c.running.children[0];
  c.open(app("music"));
  const musicFrame = h.appFrameOf("music");
  c.open(app("notes"));
  storageIn(todoFrame, "oros-notes-data");
  storageIn(musicFrame, "oros-music-data");     // its shell host: by design
  await tick();
  assert.equal(h.appLive("todo"), true);
  assert.equal(h.appLive("music"), true);
  storageIn(todoFrame, "oros-todo-data");
  await tick();
  assert.equal(h.appLive("todo"), false, "closed: it opens fresh next time");
  assert.equal(todoFrame.parentNode, null);
  c.open(app("todo"));
  assert.notEqual(h.appFrameOf("todo"), todoFrame, "a new frame, a fresh read");
});

test("shell MT-S1: keys an app was seen writing count as its own", async () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, apps: ["atelier", "writer", "layout"] });
  const h = c.h;
  storageInShell(c, "oros-recipes", "http://x/atelier/index.html");
  storageInShell(c, "oros-recipes", "http://x/layout/index.html");   // first writer keeps it
  assert.equal(h.mtOwns("atelier", "oros-recipes"), true);
  assert.equal(h.mtOwns("layout", "oros-recipes"), false);
  assert.equal(h.mtOwns("writer", "oros-writer-docs"), true);
  c.open(app("atelier"));
  const f = c.running.children[0];
  c.open(app("writer"));
  storageIn(f, "oros-recipes");
  await tick();
  assert.equal(h.appLive("atelier"), false);
});

test("shell MT-S1: side by side, one app writing the other's keys reloads the other", () => {
  const c = sandbox({ storage: { "oros-multitask": "1" }, mem: 8, width: 1280, apps: ["todo", "notes"] });
  const h = c.h;
  c.open(app("todo"));
  const todoFrame = c.running.children[0];
  assert.equal(h.mtSideOpen(app("notes")), true);
  storageInShell(c, "oros-notes-data", "http://x/notes/index.html");   // its own write
  assert.deepEqual(todoFrame.loads, ["todo/"]);
  storageInShell(c, "oros-todo-data", "http://x/notes/index.html");
  assert.deepEqual(todoFrame.loads, ["todo/", "todo/"], "To-Do reads the new data");
});
