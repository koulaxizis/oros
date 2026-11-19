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
  assert.deepEqual(n, { v: 1, on: false, days: {}, limits: {}, remind: { day: "2026-11-17", apps: {} }, bed: M.BED_DEFAULT });
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

test("limits (S2): steps only, never Settings or the desktop, reminders per day", () => {
  assert.deepEqual(M.LIMITS, [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480]);
  assert.ok(M.limitable("notes"));
  assert.ok(!M.limitable("settings") && !M.limitable("~desk") && !M.limitable("~sens") && !M.limitable("Bad Id"));
  const n = M.normalize({ limits: { notes: 30, todo: 17, settings: 60, "~desk": 15, reader: "60" },
    remind: { day: "2026-11-17", apps: { notes: { w: 1, s: 99999, d: 2 }, settings: { d: 1 } } } }, "2026-11-17");
  assert.deepEqual(n.limits, { notes: 30, reader: 60 });
  assert.deepEqual(n.remind.apps, { notes: { w: 1, s: 86400 } });
  // Yesterday's reminders do not carry over.
  assert.deepEqual(M.normalize({ remind: { day: "2026-11-16", apps: { notes: { d: 1 } } } }, "2026-11-17").remind,
    { day: "2026-11-17", apps: {} });
  let p = M.normalize({ limits: { notes: 30 } }, "2026-11-17");
  assert.equal(M.due(p, "notes", 24 * 60), "");
  assert.equal(M.due(p, "notes", 25 * 60), "warn");
  assert.equal(M.due(p, "todo", 9999), "", "no limit, nothing due");
  p = M.answered(p, "notes", "warned", 25 * 60);
  assert.equal(M.due(p, "notes", 26 * 60), "", "the warning comes once");
  assert.equal(M.due(p, "notes", 30 * 60), "card");
  p = M.answered(p, "notes", "more", 30 * 60);
  assert.equal(p.remind.apps.notes.s, 45 * 60);
  assert.equal(M.due(p, "notes", 44 * 60), "", "no second warning inside the 15 more minutes");
  assert.equal(M.due(p, "notes", 45 * 60), "card");
  p = M.answered(p, "notes", "done", 45 * 60);
  assert.equal(M.due(p, "notes", 8 * 3600), "", "no more today");
  // The shortest limit (15 minutes) still warns 5 minutes before.
  const q = M.normalize({ limits: { todo: 15 } }, "2026-11-17");
  assert.equal(M.due(q, "todo", 10 * 60), "warn");
});

function fakeDom() {
  const mk = (tag) => {
    const e = { tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, textContent: "", open: false,
      get firstChild() { return this.children[0] || null; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === "open") this.open = true; },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      focus() { focused = this; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      click() { (this.listeners.click || []).forEach((f) => f({})); }
    };
    return e;
  };
  let focused = null;
  return { mk, head: mk("head"), body: mk("body"), focused: () => focused };
}

test("shell side (S2): warning toast, the pause card, its answers and the hourglass", () => {
  const store = {};
  let now = at(2026, 11, 17, 10, 0);
  const listeners = {};
  const dom = fakeDom();
  const doc = {
    visibilityState: "visible",
    hasFocus: () => true,
    head: dom.head, body: dom.body,
    createElement: dom.mk,
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
  const ctx = {
    document: doc, Date: FakeDate, Math, JSON, Object, Array, Number, String, isFinite, WeakSet,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setInterval: (fn) => { timers.push(fn); return 1; },
    addEventListener: () => {},
    t: (k) => k
  };
  win.window = win;
  Object.assign(win, ctx);
  vm.createContext(win);
  vm.runInContext(SRC.replace('typeof window !== "undefined" ? window : globalThis', "window"), win);
  const ST = win.orosScreenTime;
  const toasts = [];
  let homes = 0, sensitive = false;
  ST.attach({ front: () => "notes", locked: () => false, sensitive: () => sensitive, media: () => false, docs: () => [],
    appName: () => "Notes", toast: (a, b) => toasts.push([a, b]), home: () => { homes++; } });
  const tick = timers[0];
  const step = (n) => { for (let i = 0; i < n; i++) { now += M.TICK; listeners.pointerdown[0](); tick(); } };
  ST.setOn(true);
  ST.setLimit("notes", 15);
  ST.setLimit("notes", 17);                      // not a step: ignored
  ST.setLimit("settings", 15);                   // never limited
  assert.deepEqual(JSON.parse(store["oros-screentime"]).limits, { notes: 15 });
  step(10 * 4);                                  // 10 minutes
  assert.equal(toasts.length, 1, "one quiet warning 5 minutes before");
  assert.equal(toasts[0][0], "st.warn.title");
  step(4 * 4);
  assert.equal(toasts.length, 1);
  const dlg = () => dom.body.children.find((c) => c.attrs && c.tagName === "DIALOG");
  assert.equal(dlg(), undefined);
  assert.equal(ST.over("notes"), false);
  step(4);                                       // 15 minutes: the card
  const d = dlg();
  assert.ok(d && d.open, "the pause card is open");
  assert.equal(d.attrs["aria-labelledby"], "oros-st-pause-t");
  const acts = d.children[3].children;
  assert.deepEqual(acts.map((b) => b.textContent), ["st.pause.more", "st.pause.done", "st.pause.home"]);
  assert.equal(dom.focused(), acts[0], "focus starts on \"15 more minutes\"");
  now += 6000;
  assert.equal(ST.over("notes"), true, "the hourglass shows past the limit");
  // Escape is "15 more minutes".
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  d.listeners.cancel[0](ev);
  assert.ok(ev.prevented && !d.open);
  step(14 * 4);
  assert.ok(!d.open, "quiet for 15 minutes");
  step(4);
  assert.ok(d.open, "the card comes back after 15 more minutes");
  d.children[3].children[2].click();             // go to the desktop
  assert.equal(homes, 1);
  assert.ok(!d.open);
  step(15 * 4);
  assert.ok(d.open);
  d.children[3].children[1].click();             // no more today
  step(60 * 4);
  assert.ok(!d.open, "no more reminders today");
  // Sensitive work: no reminders at all.
  ST.setLimit("notes", 30);
  sensitive = true;
  step(60 * 4);
  assert.ok(!d.open);
  // Off: nothing.
  sensitive = false;
  ST.setOn(false);
  step(4);
  assert.ok(!d.open);
  assert.equal(ST.over("notes"), false);
});

test("bedtime (S3): nights across midnight, chosen evenings, Not tonight, the notice, Sleep focus", () => {
  assert.deepEqual(M.cleanBed(null), M.BED_DEFAULT);
  assert.equal(M.cleanBed({ from: 1385, to: 99999 }).from, 1380, "half hours only");
  assert.equal(M.cleanBed({ from: 600, to: 600 }).to, 630, "never a night of no length");
  assert.deepEqual(M.cleanBed({ days: [5, 5, 9, "1", 0] }).days, [0, 5]);
  const b = { on: true, from: 23 * 60, to: 7 * 60 };
  assert.equal(M.bedNight({ ...b, on: false }, at(2026, 11, 18, 23, 30)).active, false, "off: nothing");
  let n = M.bedNight(b, at(2026, 11, 18, 23, 30));
  assert.equal(n.active, true);
  assert.equal(n.key, "2026-11-18");
  assert.equal(n.end, at(2026, 11, 19, 7, 0));
  assert.equal(M.bedNight(b, at(2026, 11, 19, 6, 59)).key, "2026-11-18", "the morning belongs to the evening before");
  n = M.bedNight(b, at(2026, 11, 19, 7, 0));
  assert.equal(n.active, false);
  assert.equal(n.next, at(2026, 11, 19, 23, 0));
  // Only Friday and Saturday evenings (2026-11-20 is a Friday).
  const we = { ...b, days: [5, 6] };
  assert.equal(M.bedNight(we, at(2026, 11, 19, 23, 30)).active, false);
  assert.equal(M.bedNight(we, at(2026, 11, 19, 23, 30)).nextKey, "2026-11-20");
  assert.equal(M.bedNight(we, at(2026, 11, 21, 2, 0)).key, "2026-11-20");
  // A night inside one day (21:00-23:30) and one across the clock change.
  assert.equal(M.bedNight({ on: true, from: 1260, to: 1410 }, at(2026, 11, 18, 23, 45)).active, false);
  assert.equal(M.bedNight(b, at(2026, 10, 25, 6, 30)).key, "2026-10-24", "EU winter time ends that night");
  // What is due.
  assert.equal(M.bedWants(b, at(2026, 11, 18, 22, 44)).warn, false);
  assert.equal(M.bedWants(b, at(2026, 11, 18, 22, 45)).warn, true, "15 minutes before");
  assert.equal(M.bedWants({ ...b, warned: "2026-11-18" }, at(2026, 11, 18, 22, 50)).warn, false, "once a night");
  assert.equal(M.bedWants({ ...b, skip: "2026-11-18" }, at(2026, 11, 18, 22, 50)).warn, false);
  assert.equal(M.bedWants(b, at(2026, 11, 18, 23, 1)).grey, true);
  assert.equal(M.bedWants({ ...b, skip: "2026-11-18" }, at(2026, 11, 19, 1, 0)).grey, false, "Not tonight");
  assert.equal(M.bedWants({ ...b, skip: "2026-11-18" }, at(2026, 11, 19, 23, 1)).grey, true, "back the next evening");
  assert.equal(M.bedWants(b, at(2026, 11, 18, 23, 1)).sleep, false, "Sleep focus only when chosen");
  assert.equal(M.bedWants({ ...b, sleep: true }, at(2026, 11, 18, 23, 1)).sleep, true);
  assert.equal(M.bedWants({ ...b, sleep: true, slept: "2026-11-18" }, at(2026, 11, 18, 23, 30)).sleep, false, "started once a night");
});

test("shell side (S3): grey fades in and out, the notice with Not tonight, Sleep focus starts and stops", () => {
  const store = {};
  let now = at(2026, 11, 18, 22, 40);
  const doc = { visibilityState: "visible", hasFocus: () => true, head: { appendChild() {} }, body: { appendChild() {} },
    createElement: () => ({}), addEventListener: () => {}, querySelectorAll: () => [] };
  const timers = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const win = {};
  Object.assign(win, { document: doc, Date: FakeDate, Math, JSON, Object, Array, Number, String, isFinite, WeakSet,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setInterval: (fn) => { timers.push(fn); return 1; }, addEventListener: () => {}, t: (k) => k });
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC.replace('typeof window !== "undefined" ? window : globalThis', "window"), win);
  const ST = win.orosScreenTime;
  const grey = [], toasts = [], focus = [];
  let running = null;
  const F = { start: (id, o) => { focus.push(["start", id, o.until]); running = { id }; }, stop: () => { focus.push(["stop"]); running = null; },
    active: () => running };
  ST.attach({ front: () => "", locked: () => false, sensitive: () => false, media: () => false, docs: () => [],
    grey: (on, ms) => grey.push([on, ms]), toast: (a, b, act) => toasts.push([a, b, act]), focus: () => F });
  const tick = timers[0];
  assert.deepEqual(grey, [[false, 60000]], "off: no grey (counting is off too: bedtime works on its own)");
  ST.setBed({ on: true, sleep: true });
  assert.equal(ST.bed().on, true);
  assert.equal(toasts.length, 0);
  now = at(2026, 11, 18, 22, 46); tick();
  assert.equal(toasts.length, 1, "the notice 15 minutes before");
  assert.equal(toasts[0][1], "st.bed.warn.body".replace("{time}", "23:00"));
  assert.equal(toasts[0][2].label, "st.bed.skip");
  tick();
  assert.equal(toasts.length, 1, "once");
  now = at(2026, 11, 18, 23, 0); tick();
  assert.deepEqual(grey[grey.length - 1], [true, 60000], "grey, faded over a minute");
  assert.deepEqual(focus, [["start", "sleep", at(2026, 11, 19, 7, 0)]], "Sleep focus until the night ends");
  tick();
  assert.equal(focus.length, 1);
  const s = ST.bed();
  assert.equal(s.active && s.grey && !s.skipped && s.focus, true);
  ST.bedSkip(true);                     // Not tonight (Quick settings or Settings)
  assert.deepEqual(grey[grey.length - 1], [false, 60000]);
  assert.deepEqual(focus[1], ["stop"], "the Sleep focus bedtime started stops with it");
  assert.equal(ST.bed().skipped, true);
  ST.bedSkip(false);                    // on again tonight
  assert.deepEqual(grey[grey.length - 1], [true, 60000]);
  assert.equal(focus.length, 2, "not started twice in one night");
  now = at(2026, 11, 19, 7, 0); tick();
  assert.deepEqual(grey[grey.length - 1], [false, 60000], "morning: colour back");
  // A Sleep focus someone else started is never stopped by Not tonight.
  ST.setBed({ sleep: false });
  running = { id: "work" };
  now = at(2026, 11, 19, 23, 5); tick();
  ST.bedSkip(true);
  assert.equal(running && running.id, "work", "only the Sleep focus bedtime started tonight is stopped");
  assert.deepEqual(JSON.parse(store["oros-screentime"]).days, {}, "bedtime writes no counted time");
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
  assert.ok(uses.length >= 4 && uses.length <= 30, "shell uses: " + uses.length);
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
  assert.equal(C.stDur("el", 3600), "1 ώρ.");
  assert.deepEqual(C.findSettings("el", "χρόνος οθόνης", () => true).slice(0, 1).map((r) => r.section), ["screentime"]);
  assert.deepEqual(C.findSettings("en", "screen time", () => true).slice(0, 1).map((r) => r.section), ["screentime"]);
  // Text goes in as text: the section writes no innerHTML.
  assert.doesNotMatch(MOD, /innerHTML|localStorage/);
  for (const m of MOD.matchAll(/\.style\.(\w+)\s*=\s*([^;]+);/g)) assert.match(m[2].trim(), /^stPct\(/, m[0]);
});
