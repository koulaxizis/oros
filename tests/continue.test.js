// Tests for continue.js (CONT-1 + RS-1 pure parts): the synced
// "continue" slice (merge, prune, caps, tombstones, canonical getter),
// what another device may offer, the lazy flush (no endless uploads),
// the never-list and the reopen plan.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../continue.js");

const ROOT = path.join(__dirname, "..");
const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
const MIN = 60000, DAY = 86400000;
const A = "aaaaaaaaaaaa", B = "bbbbbbbbbbbb", Cc = "cccccccccccc";

function noted(data, dev, app, title, at, extra) {
  return C.note(data, Object.assign({ dev, kind: "windows", name: "", app, target: { id: title }, title }, extra || {}), at).data;
}

test("note: records the item, never content fields; title and target are bounded", () => {
  let d = noted(null, A, "writer", "Chapter 3", T0);
  assert.deepEqual(d, { v: 1, d: { [A]: { n: "", k: "windows", na: T0, a: { writer: { at: T0, t: { id: "Chapter 3" }, ti: "Chapter 3" } } } } });
  const long = C.note(null, { dev: A, kind: "windows", app: "writer", target: { id: 1 }, title: "x".repeat(300) }, T0).data;
  assert.ok(long.d[A].a.writer.ti.length <= C.TITLE_MAX);
  const big = C.note(null, { dev: A, app: "writer", target: { s: "y".repeat(600) }, title: "t" }, T0);
  assert.equal(big.changed, false);
  const ctl = C.note(null, { dev: A, app: "writer", target: null, title: "a\u0000b\nc  d" }, T0).data;
  assert.equal(ctl.d[A].a.writer.ti, "a b c d");
});

test("note: never-list apps and bad ids are refused", () => {
  for (const app of C.NEVER) {
    assert.equal(C.note(null, { dev: A, app, target: { id: 1 }, title: "x" }, T0).changed, false, app);
  }
  assert.deepEqual(C.NEVER.slice().sort(), ["assistant", "baby", "cycle", "diary", "fitness", "health", "mail", "mood", "passwords"]);
  assert.equal(C.note(null, { dev: "BAD", app: "writer", title: "x" }, T0).changed, false);
  assert.equal(C.note(null, { dev: A, app: "../x", title: "x" }, T0).changed, false);
  assert.equal(C.note(null, { dev: A, app: "writer", title: "  " }, T0).changed, false);
});

test("note: the same item within RENOTE_MS changes nothing; later it moves at", () => {
  let d = noted(null, A, "writer", "Ch", T0);
  assert.equal(C.note(d, { dev: A, kind: "windows", app: "writer", target: { id: "Ch" }, title: "Ch" }, T0 + 30000).changed, false);
  const r = C.note(d, { dev: A, kind: "windows", app: "writer", target: { id: "Ch" }, title: "Ch" }, T0 + C.RENOTE_MS + 1);
  assert.equal(r.changed, true);
  assert.equal(r.data.d[A].a.writer.at, T0 + C.RENOTE_MS + 1);
  // another item at once is a change
  assert.equal(C.note(d, { dev: A, app: "writer", target: { id: "Ch2" }, title: "Ch2" }, T0 + 1).changed, true);
});

test("merge: two devices, each its own entry, nothing lost; commutative", () => {
  const a = noted(null, A, "writer", "Phone chapter", T0);
  const b = noted(null, B, "notes", "PC note", T0 + 5);
  const m1 = C.merge(a, b, T0 + 10), m2 = C.merge(b, a, T0 + 10);
  assert.deepEqual(m1, m2);
  assert.deepEqual(Object.keys(m1.d), [A, B]);
  assert.equal(m1.d[A].a.writer.ti, "Phone chapter");
  assert.equal(m1.d[B].a.notes.ti, "PC note");
});

test("merge: same device, same app → newest at; a tie → larger JSON (R5)", () => {
  const x = noted(null, A, "writer", "Old", T0);
  const y = noted(null, A, "writer", "New", T0 + 100);
  assert.equal(C.merge(x, y, T0 + 200).d[A].a.writer.ti, "New");
  assert.equal(C.merge(y, x, T0 + 200).d[A].a.writer.ti, "New");
  const p = noted(null, A, "writer", "Aaa", T0), q = noted(null, A, "writer", "Bbb", T0);
  assert.deepEqual(C.merge(p, q, T0 + 1), C.merge(q, p, T0 + 1));
  assert.equal(C.merge(p, q, T0 + 1).d[A].a.writer.ti, "Bbb");
});

test("merge: idempotent and canonical (no upload when nothing changed)", () => {
  let d = noted(null, B, "notes", "n", T0);
  d = noted(d, A, "writer", "w", T0 + 1);
  d = noted(d, A, "kanban", "k", T0 + 2);
  const m = C.merge(d, d, T0 + 3);
  assert.deepEqual(m, C.norm(d, T0 + 3));
  assert.equal(JSON.stringify(C.merge(m, m, T0 + 4)), JSON.stringify(m));
  // key order is sorted whatever the input order
  const shuffled = { v: 1, d: { [B]: d.d[B], [A]: { a: { writer: d.d[A].a.writer, kanban: d.d[A].a.kanban }, na: d.d[A].na, k: "windows", n: "" } } };
  assert.equal(JSON.stringify(C.norm(shuffled, T0 + 3)), JSON.stringify(C.norm(d, T0 + 3)));
});

test("prune: by the clock in norm and in merge (rule 3)", () => {
  const old = noted(null, A, "writer", "old", T0);
  const fresh = noted(old, A, "notes", "fresh", T0 + 13 * DAY);
  const later = T0 + C.KEEP_MS + DAY;
  assert.deepEqual(Object.keys(C.norm(fresh, later).d[A].a), ["notes"]);
  // a remote copy that still carries the old item does not bring it back
  assert.deepEqual(Object.keys(C.merge(C.norm(fresh, later), old, later).d[A].a), ["notes"]);
  // a device with nothing left goes
  assert.deepEqual(C.norm(old, T0 + C.KEEP_MS + DAY).d, {});
});

test("caps: MAX_APPS per device (newest kept), MAX_DEVS devices", () => {
  let d = null;
  for (let i = 0; i < C.MAX_APPS + 3; i++) d = noted(d, A, "app" + String(i).padStart(2, "0"), "t" + i, T0 + i);
  const apps = Object.keys(C.norm(d, T0 + 100).d[A].a);
  assert.equal(apps.length, C.MAX_APPS);
  assert.ok(!apps.includes("app00") && apps.includes("app14"));
  let e = null;
  for (let i = 0; i < C.MAX_DEVS + 2; i++) e = noted(e, "dev" + String(i).padStart(9, "0"), "writer", "t", T0 + i);
  const devs = Object.keys(C.norm(e, T0 + 100).d);
  assert.equal(devs.length, C.MAX_DEVS);
  assert.ok(!devs.includes("dev000000000"));
});

test("clear: a tombstone that wins over the older item from another copy", () => {
  const d = noted(null, A, "writer", "gone", T0);
  const c = C.clear(d, A, "writer", T0 + 10);
  assert.equal(c.changed, true);
  assert.deepEqual(c.data.d[A].a.writer, { at: T0 + 10, x: 1 });
  assert.deepEqual(C.merge(d, c.data, T0 + 20).d[A].a.writer, { at: T0 + 10, x: 1 });
  assert.equal(C.clear(c.data, A, "writer", T0 + 30).changed, false);
});

test("forget: a forgotten device stays gone, but comes back with newer activity", () => {
  let d = noted(null, B, "notes", "x", T0);
  d = noted(d, A, "writer", "w", T0);
  const f = C.forget(d, B, T0 + 100);
  assert.equal(f.changed, true);
  assert.deepEqual(f.data.d[B], { at: T0 + 100, x: 1 });
  // B's own older copy does not undo it
  assert.deepEqual(C.merge(f.data, d, T0 + 200).d[B], { at: T0 + 100, x: 1 });
  // B is still in use and notes something new: it is back, with only the new item
  const back = noted(d, B, "kanban", "k", T0 + 300);
  const m = C.merge(f.data, back, T0 + 400);
  assert.deepEqual(Object.keys(m.d[B].a), ["kanban"]);
  assert.equal(C.devices(m, A, T0 + 400).length, 2);
});

test("rename: the newer name wins; kind travels so each viewer translates", () => {
  const d = noted(null, A, "writer", "w", T0);
  const r = C.rename(d, A, "aphone", "Chris's phone", T0 + 5);
  assert.equal(r.changed, true);
  assert.equal(r.data.d[A].n, "Chris's phone");
  assert.equal(r.data.d[A].k, "aphone");
  assert.equal(C.merge(d, r.data, T0 + 6).d[A].n, "Chris's phone");
  assert.equal(C.rename(r.data, A, "aphone", "Chris's phone", T0 + 7).changed, false);
});

test("kindOf: the browser's kind", () => {
  assert.equal(C.kindOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"), "aphone");
  assert.equal(C.kindOf("Mozilla/5.0 (Linux; Android 14; Tab)"), "atablet");
  assert.equal(C.kindOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(C.kindOf("Mozilla/5.0 (X11; Linux x86_64)"), "linux");
  assert.equal(C.kindOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iphone");
  assert.equal(C.kindOf(""), "other");
});

test("shown: other devices only, newer than mine, within SHOW_MS, allowed, not dismissed", () => {
  let d = noted(null, A, "writer", "mine-old", T0);
  d = noted(d, B, "writer", "phone-new", T0 + 10 * MIN);
  d = noted(d, B, "notes", "phone-note", T0 + 5 * MIN);
  d = noted(d, B, "kanban", "hidden-here", T0 + 6 * MIN);
  d = noted(d, Cc, "spreadsheet", "too-old", T0 - 4 * DAY);
  const now = T0 + 20 * MIN;
  const ok = (id) => id !== "kanban";
  let s = C.shown(d, A, { now, ok });
  assert.deepEqual(s.map((x) => x.title), ["phone-new", "phone-note"]);
  assert.equal(s[0].dev, B);
  assert.deepEqual(s[0].target, { id: "phone-new" });
  // I open the same app later here: its phone item no longer shows
  const mine = noted(d, A, "writer", "mine-newer", T0 + 15 * MIN);
  assert.deepEqual(C.shown(mine, A, { now, ok }).map((x) => x.title), ["phone-note"]);
  // dismissed here
  s = C.shown(d, A, { now, ok, seen: { [B + ":writer"]: T0 + 10 * MIN } });
  assert.deepEqual(s.map((x) => x.title), ["phone-note"]);
  // a never-app that slipped into a synced copy is never shown
  const bad = JSON.parse(JSON.stringify(d));
  bad.d[B].a.diary = { at: T0 + 11 * MIN, t: null, ti: "Dear diary" };
  assert.ok(!C.shown(bad, A, { now }).some((x) => x.app === "diary"));
});

test("reopen: record and plan (RS-1)", () => {
  const rec = C.lastRecord("writer", ["notes", "writer", "kanban", "notes"], T0);
  assert.deepEqual(rec, { f: "writer", o: ["notes", "kanban"], at: T0 });
  const allow = (id) => id !== "passwords" && id !== "chess";
  assert.deepEqual(C.reopenPlan(rec, { allow, multitask: true }), { front: "writer", back: ["notes", "kanban"] });
  assert.deepEqual(C.reopenPlan(rec, { allow, multitask: false }), { front: "writer", back: [] });
  // reopened by itself and gone before SETTLE_MS: never again
  assert.equal(C.reopenPlan(C.lastRecord("writer", [], T0, true), { allow }), null);
  // not allowed front, open apps still come back with multitasking
  assert.deepEqual(C.reopenPlan(C.lastRecord("passwords", ["notes"], T0), { allow, multitask: true }), { front: null, back: ["notes"] });
  assert.equal(C.reopenPlan(C.lastRecord(null, [], T0), { allow }), null);
  // at most REOPEN_MAX apps
  const many = C.lastRecord("a0", ["a1", "a2", "a3", "a4", "a5", "a6", "a7"], T0);
  const p = C.reopenPlan(many, { allow: () => true, multitask: true });
  assert.equal(1 + p.back.length, C.REOPEN_MAX);
});

// ---------- browser part, in a small fake window ----------
function fakeWindow(apps, opts) {
  opts = opts || {};
  const store = new Map();
  const listeners = {};
  const timers = [];
  const win = {
    navigator: { userAgent: opts.ua || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    document: { visibilityState: "visible" },
    crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = (i * 7 + 3) & 255; return b; } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    console
  };
  win.window = win;
  const src = fs.readFileSync(path.join(ROOT, "continue.js"), "utf8");
  vm.runInNewContext(src, Object.assign(win, { Uint8Array, JSON, Math, Date, Object, Array, String, Number, isFinite }));
  let dirty = 0, slice = null, autoFn = null;
  const sync = {
    registerSlice: (name, get, set, key, merge) => { slice = { name, get, set, key, merge }; },
    markDirty: () => { dirty++; },
    onAutoSync: (fn) => { autoFn = fn; }
  };
  let strict = null;
  win.orosContinue.init({ sync, apps: () => apps, strict: () => strict });
  return {
    win, store, timers, listeners, get dirty() { return dirty; }, get slice() { return slice; },
    auto: (k) => autoFn && autoFn(k), setStrict: (v) => { strict = v; },
    fire: (t) => (listeners[t] || []).forEach((fn) => fn())
  };
}
const APPS = [
  { id: "writer", type: "internal", category: "Office" },
  { id: "notes", type: "internal", category: "Office" },
  { id: "budget", type: "internal", category: "Money", searchOff: true },
  { id: "chess", type: "internal", category: "Games" },
  { id: "passwords", type: "internal", category: "Utilities" }
];

test("browser: registers the slice with 5 args; getter null on a fresh device", () => {
  const w = fakeWindow(APPS);
  assert.equal(w.slice.name, "continue");
  assert.equal(w.slice.key, "oros-continue");
  assert.equal(typeof w.slice.merge, "function");
  assert.equal(w.slice.get(), null);
});

test("browser: 100 notes in a minute → no markDirty until hide, then exactly one", () => {
  const w = fakeWindow(APPS);
  const C2 = w.win.orosContinue;
  for (let i = 0; i < 100; i++) C2.note(i % 2 ? "writer" : "notes", { target: { id: i }, title: "Item " + i });
  assert.equal(w.dirty, 0);
  assert.equal(w.timers.filter((t) => t.fn).length, 1, "one flush timer, not one per note");
  w.win.document.visibilityState = "hidden";
  w.fire("visibilitychange");
  assert.equal(w.dirty, 1);
  w.fire("pagehide");
  assert.equal(w.dirty, 1, "nothing new: no second upload");
});

test("browser: the flush timer marks dirty once; a sync that already sent it means none", () => {
  const w = fakeWindow(APPS);
  w.win.orosContinue.note("writer", { target: { id: 1 }, title: "A" });
  w.timers[0].fn();
  assert.equal(w.dirty, 1);
  w.win.orosContinue.note("notes", { target: { id: 2 }, title: "B" });
  w.auto("done");                      // another change's push carried it
  w.timers[w.timers.length - 1].fn();
  assert.equal(w.dirty, 1);
});

test("browser: never-apps, sensitive (searchOff), games, Sensitive work and the switch record nothing", () => {
  const w = fakeWindow(APPS);
  const C2 = w.win.orosContinue;
  assert.equal(C2.note("passwords", { target: null, title: "x" }), false);
  assert.equal(C2.note("budget", { target: null, title: "x" }), false);
  assert.equal(C2.note("chess", { target: null, title: "x" }), false);
  assert.equal(C2.note("unknown", { target: null, title: "x" }), false);
  w.setStrict("normal");
  assert.equal(C2.note("writer", { target: null, title: "x" }), false);
  w.setStrict(null);
  C2.setPref("cont", false);
  assert.equal(C2.note("writer", { target: null, title: "x" }), false);
  C2.setPref("cont", true);
  assert.equal(C2.note("writer", { target: null, title: "x" }), true);
  assert.equal(w.store.get("oros-continue-prefs"), undefined, "on = no key");
});

test("browser: the setter never marks dirty; remote items show here", () => {
  const w = fakeWindow(APPS);
  const C2 = w.win.orosContinue;
  const remote = noted(null, B, "writer", "From the phone", Date.now() - MIN, { kind: "aphone" });
  w.slice.set(remote);
  assert.equal(w.dirty, 0);
  const s = C2.shown();
  assert.equal(s.length, 1);
  assert.equal(s[0].title, "From the phone");
  assert.equal(s[0].kind, "aphone");
  C2.setPref("cont", false);
  assert.equal(C2.shown().length, 0);
});

test("browser: reopen switch off drops the reopen record", () => {
  const w = fakeWindow(APPS);
  w.store.set("oros-apps-last", "{}");
  w.win.orosContinue.setPref("reopen", false);
  assert.equal(w.store.has("oros-apps-last"), false);
  assert.equal(w.win.orosContinue.prefs().reopen, false);
});

test("wiring: the shell calls init; once index.html loads continue.js, it comes before shell.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ci = html.indexOf('src="continue.js?v='), si = html.indexOf('src="shell.js?v=');
  if (ci >= 0) assert.ok(ci < si);   // the stamp commit adds the script line, the preload and the sw.js entry (rule 14)
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.match(shell, /orosContinue\.init\(/);
});

// ---------- W2: where the items show ----------
test("browser: × on a card hides that item here until the device has something newer", () => {
  const w = fakeWindow(APPS);
  const C2 = w.win.orosContinue;
  const at = Date.now() - MIN;
  w.slice.set(noted(null, B, "writer", "From the phone", at, { kind: "aphone" }));
  assert.equal(C2.shown().length, 1);
  assert.equal(C2.dismiss(B, "writer", at), true);
  assert.equal(C2.shown().length, 0);
  assert.equal(w.dirty, 0, "a dismiss stays on this device");
  w.slice.set(noted(JSON.parse(w.store.get("oros-continue")), B, "writer", "Next chapter", at + 2 * MIN, { kind: "aphone" }));
  assert.equal(C2.shown()[0].title, "Next chapter");
  assert.equal(C2.dismiss("BAD", "writer", at), false);
});

test("wiring W2: Overview section, Today card and the smart bar kind use the same items", () => {
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.match(shell, /ovSection\("ov-cont", "cont\.title"\)/);
  assert.match(shell, /window\.orosContinueUi = \{/);
  // titles only through textContent
  const ov = shell.slice(shell.indexOf("function ovRenderCont()"), shell.indexOf("function ovTile("));
  assert.match(ov, /\.ov-fname"\)\.textContent = it\.title/);
  assert.doesNotMatch(ov, /innerHTML[^;]*it\.title/);
  const sb = fs.readFileSync(path.join(ROOT, "smartbar.js"), "utf8");
  assert.match(sb, /"reading", "continue"\]/);
  assert.match(sb, /continue: function \(now\)/);
  const today = fs.readFileSync(path.join(ROOT, "today", "today.js"), "utf8");
  assert.match(today, /var cc = contCard\(\);/);
  for (const k of ["cont.title", "cont.from", "cont.tip", "cont.hide", "sb.k.continue"]) {
    assert.ok(shell.length && fs.readFileSync(path.join(ROOT, "translations.js"), "utf8").split('"' + k + '"').length === 3, k + " EN + EL");
    assert.ok(fs.readFileSync(path.join(ROOT, "i18n", "de", "shell.js"), "utf8").includes('"' + k + '"'), k + " DE");
  }
});

test("RS-1 + SW-2: apps reopened by the start and untouched since let a waiting update reload", () => {
  const fs = require("fs"), path = require("path");
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(shell, /window\.__orosRsSafe = function \(\) \{\n\s*if \(!appsUntouched\) return false;/);
  assert.match(shell, /window\.addEventListener\("blur", touched\);/, "a tap inside a frame counts as touched");
  assert.match(page, /var rsSafe = typeof window\.__orosRsSafe === "function" && window\.__orosRsSafe\(\);/);
  assert.match(page, /run\.classList\.contains\("active"\) && !soloHidden && !rsSafe\) return false;/);
});
