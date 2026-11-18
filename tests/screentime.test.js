// Screen time (screentime.js, ST-1): the pure model, the shell's
// wiring and the privacy rules (device-local, never synced, never in
// a backup, never read by the Assistant, orOS Gate, Today or
// Automations), and the Settings section.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require("../device/screentime.js");
const SRC = read("device/screentime.js");
const SHELL = read("shell.js");
const C = require("../settings/core.js");
const APP = read("settings/settings.js");

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();

test("days: local date keys, adding days across months and DST", () => {
  assert.equal(M.dayKey(at(2026, 11, 17, 23, 59)), "2026-11-17");
  assert.equal(M.dayKey(at(2026, 11, 18, 0, 1)), "2026-11-18");
  assert.equal(M.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(M.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(M.addDays("2026-03-29", 1), "2026-03-30");   // EU summer time starts
  assert.ok(!isFinite(M.dayMs("2026-02-30")));
  assert.ok(!isFinite(M.dayMs("nope")));
});

test("normalize: junk falls back, off by default, later fields ride along", () => {
  const n = M.normalize(null, "2026-11-17");
  assert.deepEqual(n, { v: 1, on: false, days: {} });
  const p = M.normalize({ on: "yes", days: { "2026-11-17": { notes: 60, "Bad Id": 5, x: -3, todo: "12.9" } }, limits: { notes: 30 } }, "2026-11-17");
  assert.equal(p.on, false);
  assert.deepEqual(p.days, { "2026-11-17": { notes: 60, todo: 12 } });
  assert.deepEqual(p.limits, { notes: 30 });
  assert.equal(M.normalize([], "2026-11-17").on, false);
});

test("prune: keeps 4 weeks (Chris 2026-11-17), drops older, junk and far-future days", () => {
  assert.equal(M.KEEP_DAYS, 28);
  const days = {};
  for (let i = 0; i < 40; i++) days[M.addDays("2026-11-17", -i)] = { notes: 60 };
  days["2026-11-18"] = { notes: 1 };
  days["2026-11-25"] = { notes: 1 };
  days["2026-13-01"] = { notes: 1 };
  days["2026-11-10"] = {};
  const k = Object.keys(M.prune(days, "2026-11-17")).sort();
  assert.equal(k[0], M.addDays("2026-11-17", -27));
  assert.equal(k[k.length - 1], "2026-11-18");
  assert.equal(k.length, 28);   // 27 back + today + tomorrow, minus the emptied 10th
});

test("addAll: adds to what is stored (two windows never overwrite), caps a day", () => {
  const p = { on: true, days: { "2026-11-17": { notes: 100 } } };
  const o = M.addAll(p, { "2026-11-17": { notes: 30, todo: 15 }, "bad": { x: 1 } }, "2026-11-17");
  assert.deepEqual(o.days["2026-11-17"], { notes: 130, todo: 15 });
  assert.deepEqual(p.days["2026-11-17"], { notes: 100 }, "the input is not changed");
  assert.equal(M.addAll({ days: { "2026-11-17": { a: 86000 } } }, { "2026-11-17": { a: 9999 } }, "2026-11-17").days["2026-11-17"].a, 86400);
});

test("what counts: on screen, unlocked, in use (focus + input in 5 min) or sound/video", () => {
  const base = { on: true, visible: true, locked: false, focused: true, media: false, idle: 1000 };
  assert.equal(M.counts(base), true);
  assert.equal(M.counts(Object.assign({}, base, { on: false })), false);
  assert.equal(M.counts(Object.assign({}, base, { visible: false })), false);
  assert.equal(M.counts(Object.assign({}, base, { locked: true })), false);
  assert.equal(M.counts(Object.assign({}, base, { locked: true, media: true })), false);
  assert.equal(M.counts(Object.assign({}, base, { idle: M.IDLE })), false);
  assert.equal(M.counts(Object.assign({}, base, { idle: M.IDLE, media: true })), true);
  assert.equal(M.counts(Object.assign({}, base, { focused: false })), false);
  assert.equal(M.counts(Object.assign({}, base, { focused: false, media: true })), true);
  // A gap (sleep, a paused tab) counts nothing.
  assert.equal(M.stepOf(M.TICK), M.TICK);
  assert.equal(M.stepOf(M.MAX_STEP + 1), 0);
  assert.equal(M.stepOf(-5), 0);
});

test("buckets: the app in front, the desktop, and no names in Sensitive work", () => {
  assert.equal(M.bucket("notes", false), "notes");
  assert.equal(M.bucket("", false), M.DESK);
  assert.equal(M.bucket("~sens", false), M.DESK);
  assert.equal(M.bucket("<b>", false), M.DESK);
  assert.equal(M.bucket("notes", true), M.SENS);
});

test("views: a day's apps longest first, the last 7 days oldest first", () => {
  const p = M.normalize({ days: { "2026-11-17": { notes: 60, todo: 600, mail: 60 }, "2026-11-12": { notes: 5 } } }, "2026-11-17");
  const v = M.dayView(p, "2026-11-17");
  assert.equal(v.total, 720);
  assert.deepEqual(v.apps.map((a) => a.id), ["todo", "mail", "notes"]);
  const w = M.lastDays(p, "2026-11-17", 7);
  assert.equal(w.length, 7);
  assert.equal(w[0].day, "2026-11-11");
  assert.equal(w[1].total, 5);
  assert.equal(w[6].day, "2026-11-17");
});

test("shell side: ticks count the front app, write at most once a minute, add to storage", () => {
  const store = {};
  let now = at(2026, 11, 17, 10, 0);
  const listeners = {};
  const doc = {
    visibilityState: "visible",
    hasFocus: () => true,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelectorAll: () => []
  };
  const timers = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const win = {};
  let writes = 0;
  const ctx = {
    document: doc, Date: FakeDate, Math, JSON, Object, Array, Number, String, isFinite, WeakSet,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { writes++; store[k] = String(v); }
    },
    setInterval: (fn) => { timers.push(fn); return 1; },
    addEventListener: () => {}
  };
  win.window = win;
  Object.assign(win, ctx);
  vm.createContext(win);
  vm.runInContext(SRC.replace('typeof window !== "undefined" ? window : globalThis', "window"), win);
  const ST = win.orosScreenTime;
  let front = "notes", locked = false;
  ST.attach({ front: () => front, locked: () => locked, sensitive: () => false, media: () => false, docs: () => [], appName: (id) => id.toUpperCase() });
  const tick = timers[0];
  const step = (n) => { for (let i = 0; i < n; i++) { now += M.TICK; listeners.pointerdown[0](); tick(); } };
  step(4);
  assert.equal(store["oros-screentime"], undefined, "off by default: nothing is written");
  ST.setOn(true);
  writes = 0;
  step(3);            // 45 s: not written yet
  assert.equal(writes, 0);
  step(1);            // a minute: one write
  assert.equal(writes, 1);
  let p = JSON.parse(store["oros-screentime"]);
  assert.equal(p.days["2026-11-17"].notes, 60);
  front = "";         // back to the desktop (the shell calls note() first)
  ST.note();
  step(4);
  locked = true;      // locked: nothing counts
  step(8);
  p = JSON.parse(store["oros-screentime"]);
  assert.equal(p.days["2026-11-17"]["~desk"], 60);
  assert.equal(p.days["2026-11-17"].notes, 60);
  locked = false;
  now += 10 * 60000;  // asleep for 10 minutes: a gap counts nothing
  tick();
  const s = ST.snapshot();
  assert.equal(s.on, true);
  assert.equal(s.days[6].total, 120);
  assert.equal(s.days[6].apps.find((a) => a.id === "notes").name, "NOTES");
  assert.equal(s.days[6].apps.find((a) => a.id === "~desk").name, "");
  ST.clear();
  assert.deepEqual(JSON.parse(store["oros-screentime"]).days, {});
  ST.setOn(false);
  assert.equal(JSON.parse(store["oros-screentime"]).on, false);
});

test("privacy: device-local only, never in sync, backups, Assistant, Gate, Today or Automations", () => {
  assert.doesNotMatch(SRC, /registerSlice|markDirty|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|orosSync/);
  const offLimits = ["sync.js", "davsync.js", "vault.js", "gate/gate.js", "today/agg.js", "today/host.js",
    "automations/host.js", "automations/hookin.js", "device/view.js"];
  if (fs.existsSync(path.join(ROOT, "assistant"))) {
    fs.readdirSync(path.join(ROOT, "assistant")).filter((f) => f.endsWith(".js")).forEach((f) => offLimits.push("assistant/" + f));
  }
  offLimits.filter((f) => fs.existsSync(path.join(ROOT, f))).forEach((f) => {
    assert.doesNotMatch(read(f), /oros-screentime|orosScreenTime/, f + " must not read screen time");
  });
  // In the shell only the attach, note() and the Settings bridge use it.
  const uses = SHELL.match(/orosScreenTime/g) || [];
  assert.ok(uses.length >= 4 && uses.length <= 10, "shell uses: " + uses.length);
  assert.doesNotMatch(SHELL, /oros-screentime/);
  assert.equal(C.scopeOf("screentime"), "device");
});

test("shell wiring: late bundle, note() before the front app changes, Settings bridge", () => {
  const html = read("index.html");
  const late = html.match(/<template data-oros-late>[\s\S]*?<\/template>/g).join("\n");
  assert.match(late, /<script src="device\/screentime\.js\?v=[^"]+"><\/script>/);
  assert.match(SHELL, /lateWhen\(function \(\) \{\s*if \(!window\.orosScreenTime\) return;\s*window\.orosScreenTime\.attach\(/);
  const open = SHELL.slice(SHELL.indexOf("function openApp(app, at)"), SHELL.indexOf("function returnToDesktop()"));
  assert.ok(open.indexOf("stNote();") !== -1 && open.indexOf("stNote();") < open.indexOf("state.running = app;"));
  const home = SHELL.slice(SHELL.indexOf("function returnToDesktop()"), SHELL.indexOf("function returnToDesktop()") + 600);
  assert.ok(home.indexOf("stNote();") !== -1 && home.indexOf("stNote();") < home.indexOf("state.running = null;"));
  assert.match(SHELL, /case "screentime":\s+if \(window\.orosScreenTime\)/);
  assert.match(SHELL, /case "screentimeClear":/);
  assert.match(SHELL, /screentime: window\.orosScreenTime \? window\.orosScreenTime\.snapshot\(\) : null/);
});

test("settings: section, search rows, strings in EN/EL/DE, durations", () => {
  assert.ok(C.SECTIONS.includes("screentime"));
  assert.match(APP, /screentime: secScreenTime/);
  assert.match(APP, /ICON = \{[\s\S]*?\n    screentime: '<svg/);
  assert.match(APP, /go\("screentime", true\)/, "a link from Settings › Device");
  const keys = Object.keys(C.STRINGS.en).filter((k) => /^(st\.|s\.screentime|d\.screentime|w\.screentime)/.test(k));
  assert.ok(keys.length >= 12, "strings: " + keys.length);
  const de = {};
  global.orosPack = (l, n, o) => Object.assign(de, o);
  require("../i18n/de/settings.js");
  delete global.orosPack;
  keys.forEach((k) => {
    assert.ok(C.STRINGS.el[k], "el " + k);
    assert.ok(de[k], "de " + k);
  });
  // The section itself loads on first open (settings/screentime.js +
  // screentime.css, Settings size budget); its own strings join the tables.
  const MOD = read("settings/screentime.js");
  const w = { SettingsCore: { STRINGS: { en: {}, el: {} } } };
  vm.runInNewContext(MOD, { window: w });
  const own = w.SettingsScreenTime.STRINGS;
  assert.equal(typeof w.SettingsScreenTime.draw, "function");
  assert.ok(Object.keys(own.en).length >= 8);
  Object.keys(own.en).forEach((k) => {
    assert.ok(own.el[k], "el " + k);
    assert.ok(de[k], "de " + k);
    assert.equal(C.STRINGS.en[k], undefined, k + " lives in one place");
  });
  assert.equal(w.SettingsCore.STRINGS.en["st.hint"], own.en["st.hint"], "merged on load");
  assert.match(APP, /loadScript\("screentime\.js"\)/);
  assert.match(APP, /css\.href = "screentime\.css"/);
  assert.ok(fs.existsSync(path.join(ROOT, "settings/screentime.css")));
  // every st.* key the page and the section use exists
  [...(APP + MOD).matchAll(/t\("(st\.[a-zA-Z.]+)"/g)].forEach((m) => assert.ok(C.STRINGS.en[m[1]] || own.en[m[1]], m[1]));
  assert.equal(C.stDur("en", 0), "under 1 min");
  assert.equal(C.stDur("en", 59 * 60 + 59), "59 min");
  assert.equal(C.stDur("en", 2 * 3600 + 5 * 60), "2 h 5 min");
  assert.equal(C.stDur("el", 3600), "1 ώρ. 0 λεπ.");
  assert.deepEqual(C.findSettings("el", "χρόνος οθόνης", () => true).slice(0, 1).map((r) => r.section), ["screentime"]);
  assert.deepEqual(C.findSettings("en", "screen time", () => true).slice(0, 1).map((r) => r.section), ["screentime"]);
  // Text goes in as text: the section writes no innerHTML.
  assert.doesNotMatch(MOD, /innerHTML|localStorage/);
  for (const m of MOD.matchAll(/\.style\.(\w+)\s*=\s*([^;]+);/g)) assert.match(m[2].trim(), /^stPct\(/, m[0]);
});
