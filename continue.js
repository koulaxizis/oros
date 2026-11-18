// ============================================================
// orOS continue.js — Continue from another device (CONT-1) and
// the reopen record of RS-1 (v1.0.0)
// Shell core, NOT an app (no apps.json entry). Loaded before
// shell.js; the shell calls orosContinue.init(ctx) at boot.
//
// What it keeps: per device, the last item the person had open in
// each app (the app id, the item's deep-link target, its title),
// never the item's content. Other devices offer "Continue «title»
// in <app>, from <device>" (W2: Overview, Today, smart bar).
//
// Synced slice "continue" (storage key oros-continue), merge = 5th
// argument (Bible Part V, the three rules):
//   { v: 1, d: { <deviceId>: { n, k, na, a: { <appId>: { at, t, ti } } } } }
//     n   the name the person gave the device ("" = by its kind)
//     k   the kind (KINDS) from the browser, so each viewer shows
//         the default name in its own language
//     na  when n / k were set
//     a   the apps: at (ms), t (deep-link target, JSON ≤ 500
//         chars, the same shape as the app's search targets), ti
//         (title, plain text ≤ 80); a cleared item is { at, x: 1 }
//   A forgotten device is { at, x: 1 }.
// Each device writes ONLY its own entry, so nothing can be lost:
// the merge takes, per device and per app, the newest `at` (a tie
// goes to the larger JSON, R5). A tombstoned device comes back only
// with activity newer than the tombstone. Pruned by the clock with
// the same rule in the getter and the merge (rule 3): entries older
// than KEEP_MS go, at most MAX_APPS per device, MAX_DEVS devices.
//
// No endless uploads: note() never calls markDirty by itself. The
// slice travels with the next sync that runs anyway, or is flushed
// (one markDirty) when the tab is hidden or closed, or FLUSH_MS
// after the first unsent note. The same item noted again within
// RENOTE_MS changes nothing.
//
// Never recorded: NEVER (the Gate/Assistant never-apps: Passwords,
// Mail, Diary, Mood, Cycle, Health, Baby, Assistant, Fitness) and
// every app whose apps.json entry has "searchOff": true (Chris
// 2026-11-17, card "Ευαίσθητες: ποτέ"); nothing while Sensitive work
// is on; nothing when the person switched it off on this device.
//
// Device-local keys (never synced): oros-device-id (random id),
// oros-device-name (the name typed in Settings), oros-continue-prefs
// { cont: 0|1, reopen: 0|1 } (absent = on, Chris 2026-11-17),
// oros-apps-last (RS-1, written by the shell).
//
// Tests: tests/continue.test.js.
// ============================================================
(function (root) {
  "use strict";

  var DAY = 86400000;
  var KEEP_MS = 14 * DAY;          // entries and tombstones live 14 days
  var SHOW_MS = 3 * DAY;           // another device's item shows for 3 days
  var MAX_APPS = 12;               // per device
  var MAX_DEVS = 8;
  var TITLE_MAX = 80;
  var TARGET_MAX = 500;            // JSON characters (= Today targets)
  var NAME_MAX = 40;
  var RENOTE_MS = 60000;           // the same item again: no change before
  var FLUSH_MS = 120000;           // an unsent note is flushed after
  var REOPEN_MAX = 6;              // RS-1: apps reopened after a restart
  var SETTLE_MS = 15000;           // RS-1: an app reopened by itself must stay this long

  var NEVER = ["assistant", "baby", "cycle", "diary", "fitness", "health", "mail", "mood", "passwords"];
  var KINDS = ["aphone", "atablet", "chromebook", "ipad", "iphone", "linux", "mac", "other", "windows"];
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var DEV_RE = /^[a-z0-9]{8,16}$/;

  var DATA_KEY = "oros-continue";
  var DEV_KEY = "oros-device-id";
  var NAME_KEY = "oros-device-name";
  var PREFS_KEY = "oros-continue-prefs";
  var LAST_KEY = "oros-apps-last";
  var SEEN_KEY = "oros-continue-seen";   // W2: items dismissed here { "<dev>:<app>": at }, device-local

  // ---------- pure helpers ----------
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function text(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    if (s.length > max) s = s.slice(0, max - 1).replace(/\s+$/, "") + "…";
    return s;
  }
  // The target as clean JSON, or undefined when it cannot travel.
  function target(t) {
    if (t === undefined || t === null) return null;
    var s;
    try { s = JSON.stringify(t); } catch (e) { return undefined; }
    if (typeof s !== "string" || s.length > TARGET_MAX) return undefined;
    try { return JSON.parse(s); } catch (e2) { return undefined; }
  }
  function bigger(a, b) { return JSON.stringify(a) >= JSON.stringify(b) ? a : b; }   // R5 tie

  function kindOf(ua) {
    ua = String(ua || "");
    if (/iPhone/.test(ua)) return "iphone";
    if (/iPad/.test(ua)) return "ipad";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "aphone" : "atablet";
    if (/CrOS/.test(ua)) return "chromebook";
    if (/Windows/.test(ua)) return "windows";
    if (/Mac OS X|Macintosh/.test(ua)) return "mac";
    if (/Linux/.test(ua)) return "linux";
    return "other";
  }

  function normApp(e) {
    e = obj(e);
    if (!e) return null;
    var at = num(e.at);
    if (!at) return null;
    if (e.x) return { at: at, x: 1 };
    var t = target(e.t);
    if (t === undefined) return null;
    var ti = text(e.ti, TITLE_MAX);
    if (!ti) return null;
    return { at: at, t: t, ti: ti };
  }
  function devAt(d) {
    if (!d) return 0;
    if (d.x) return d.at;
    var m = d.na || 0;
    for (var k in d.a) if (own(d.a, k) && d.a[k].at > m) m = d.a[k].at;
    return m;
  }
  function normDev(e) {
    e = obj(e);
    if (!e) return null;
    if (e.x) { var t = num(e.at); return t ? { at: t, x: 1 } : null; }
    var a = {}, src = obj(e.a) || {};
    Object.keys(src).forEach(function (k) {
      if (!ID_RE.test(k)) return;
      var v = normApp(src[k]);
      if (v) a[k] = v;
    });
    var k = KINDS.indexOf(e.k) >= 0 ? e.k : "other";
    return { n: text(e.n, NAME_MAX), k: k, na: num(e.na), a: a };
  }
  // Prune by the clock and order canonically (R26).
  function prune(d, now) {
    if (!d) return null;
    if (d.x) return now - d.at > KEEP_MS ? null : { at: d.at, x: 1 };
    var ids = Object.keys(d.a).filter(function (k) { return now - d.a[k].at <= KEEP_MS; });
    ids.sort(function (x, y) { return (d.a[y].at - d.a[x].at) || (x < y ? -1 : x > y ? 1 : 0); });
    ids = ids.slice(0, MAX_APPS).sort();
    var a = {};
    ids.forEach(function (k) { a[k] = d.a[k]; });
    var out = { n: d.n, k: d.k, na: d.na, a: a };
    if (!ids.length && now - d.na > KEEP_MS) return null;
    return out;
  }
  function norm(data, now) {
    now = num(now) || Date.now();
    var src = obj(data) && obj(data.d) || {};
    var devs = {};
    Object.keys(src).forEach(function (id) {
      if (!DEV_RE.test(id)) return;
      var d = prune(normDev(src[id]), now);
      if (d) devs[id] = d;
    });
    var ids = Object.keys(devs);
    ids.sort(function (x, y) { return (devAt(devs[y]) - devAt(devs[x])) || (x < y ? -1 : x > y ? 1 : 0); });
    ids = ids.slice(0, MAX_DEVS).sort();
    var out = { v: 1, d: {} };
    ids.forEach(function (id) { out.d[id] = devs[id]; });
    return out;
  }

  function mergeApp(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.at !== b.at) return a.at > b.at ? a : b;
    return bigger(a, b);
  }
  function mergeDev(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.x && b.x) return a.at >= b.at ? a : b;
    if (a.x || b.x) {
      var tomb = a.x ? a : b, live = a.x ? b : a;
      if (tomb.at >= devAt(live)) return tomb;
      var kept = {};
      Object.keys(live.a).forEach(function (k) { if (live.a[k].at > tomb.at) kept[k] = live.a[k]; });
      return { n: live.n, k: live.k, na: live.na, a: kept };
    }
    var name = a.na !== b.na ? (a.na > b.na ? a : b)   // same stamp: the larger JSON of { n, k } (R5)
      : (JSON.stringify({ n: a.n, k: a.k }) >= JSON.stringify({ n: b.n, k: b.k }) ? a : b);
    var apps = {};
    Object.keys(a.a).concat(Object.keys(b.a)).forEach(function (k) {
      if (!own(apps, k)) apps[k] = mergeApp(own(a.a, k) ? a.a[k] : null, own(b.a, k) ? b.a[k] : null);
    });
    return { n: name.n, k: name.k, na: name.na, a: apps };
  }
  function merge(local, remote, now) {
    now = num(now) || Date.now();
    var A = norm(local, now), B = norm(remote, now), d = {};
    Object.keys(A.d).concat(Object.keys(B.d)).forEach(function (id) {
      if (!own(d, id)) d[id] = mergeDev(own(A.d, id) ? A.d[id] : null, own(B.d, id) ? B.d[id] : null);
    });
    return norm({ v: 1, d: d }, now);
  }

  function liveDev(data, dev, kind, now) {
    var d = own(data.d, dev) ? data.d[dev] : null;
    if (!d || d.x) {
      var floor = d ? d.at : 0;
      d = { n: "", k: kind || "other", na: Math.max(now, floor + 1), a: {} };
      data.d[dev] = d;
    }
    return d;
  }
  // note(data, { dev, kind, name, app, target, title }, now) → { data, changed }
  function note(data, o, now) {
    now = num(now) || Date.now();
    var d0 = norm(data, now);
    o = obj(o) || {};
    if (!DEV_RE.test(o.dev || "") || !ID_RE.test(o.app || "") || NEVER.indexOf(o.app) >= 0) return { data: d0, changed: false };
    var t = target(o.target), ti = text(o.title, TITLE_MAX);
    if (t === undefined || !ti) return { data: d0, changed: false };
    var before = JSON.stringify(d0);
    var fresh = !own(d0.d, o.dev) || !!d0.d[o.dev].x;
    var dev = liveDev(d0, o.dev, KINDS.indexOf(o.kind) >= 0 ? o.kind : "other", now);
    if (fresh) dev.n = text(o.name, NAME_MAX);
    var cur = own(dev.a, o.app) ? dev.a[o.app] : null;
    if (cur && !cur.x && cur.ti === ti && JSON.stringify(cur.t) === JSON.stringify(t) && now - cur.at < RENOTE_MS) {
      return { data: d0, changed: false };
    }
    dev.a[o.app] = { at: Math.max(now, cur ? cur.at + 1 : 0), t: t, ti: ti };
    var out = norm(d0, now);
    return { data: out, changed: JSON.stringify(out) !== before };
  }
  // clear(data, dev, app, now): the item was deleted or closed for good.
  function clear(data, dev, app, now) {
    now = num(now) || Date.now();
    var d0 = norm(data, now);
    var d = own(d0.d, dev) ? d0.d[dev] : null;
    if (!d || d.x || !own(d.a, app) || d.a[app].x) return { data: d0, changed: false };
    d.a[app] = { at: Math.max(now, d.a[app].at + 1), x: 1 };
    return { data: norm(d0, now), changed: true };
  }
  // name(data, dev, kind, name, now): the device's name / kind changed.
  function rename(data, dev, kind, name, now) {
    now = num(now) || Date.now();
    var d0 = norm(data, now);
    if (!DEV_RE.test(dev || "")) return { data: d0, changed: false };
    var had = own(d0.d, dev) && !d0.d[dev].x;
    var d = liveDev(d0, dev, kind, now);
    var n = text(name, NAME_MAX), k = KINDS.indexOf(kind) >= 0 ? kind : d.k;
    if (had && d.n === n && d.k === k) return { data: d0, changed: false };
    d.n = n; d.k = k; d.na = Math.max(now, d.na + 1);
    return { data: norm(d0, now), changed: true };
  }
  // forget(data, dev, now): another device leaves the list (a tombstone).
  function forget(data, dev, now) {
    now = num(now) || Date.now();
    var d0 = norm(data, now);
    var d = own(d0.d, dev) ? d0.d[dev] : null;
    if (!d || d.x) return { data: d0, changed: false };
    d0.d[dev] = { at: Math.max(now, devAt(d) + 1), x: 1 };
    return { data: norm(d0, now), changed: true };
  }

  // What this device may offer: items of OTHER devices, not older than
  // SHOW_MS, newer than this device's own item in that app, the app
  // allowed here (opts.ok(app)), not dismissed here (opts.seen
  // { "<dev>:<app>": at }). Newest first.
  function shown(data, self, opts) {
    opts = obj(opts) || {};
    var now = num(opts.now) || Date.now();
    var d = norm(data, now), out = [];
    var mine = own(d.d, self) && !d.d[self].x ? d.d[self].a : {};
    var seen = obj(opts.seen) || {};
    var ok = typeof opts.ok === "function" ? opts.ok : function () { return true; };
    Object.keys(d.d).forEach(function (id) {
      if (id === self || d.d[id].x) return;
      var dev = d.d[id];
      Object.keys(dev.a).forEach(function (app) {
        var e = dev.a[app];
        if (e.x || now - e.at > SHOW_MS || NEVER.indexOf(app) >= 0) return;
        if (own(mine, app) && mine[app].at >= e.at) return;
        if (num(seen[id + ":" + app]) >= e.at) return;
        if (!ok(app)) return;
        out.push({ dev: id, name: dev.n, kind: dev.k, app: app, target: e.t, title: e.ti, at: e.at });
      });
    });
    out.sort(function (x, y) { return (y.at - x.at) || (x.dev + x.app < y.dev + y.app ? -1 : 1); });
    return out;
  }
  // The devices other than this one, for Settings (newest first).
  function devices(data, self, now) {
    var d = norm(data, now);
    return Object.keys(d.d).filter(function (id) { return !d.d[id].x; }).map(function (id) {
      return { id: id, name: d.d[id].n, kind: d.d[id].k, at: devAt(d.d[id]), self: id === self };
    }).sort(function (x, y) { return y.at - x.at; });
  }
  // This device's own last item in an app (RS-1 reopens at it).
  function lastOwn(data, self, app, now) {
    var d = norm(data, now);
    var dev = own(d.d, self) ? d.d[self] : null;
    if (!dev || dev.x || !own(dev.a, app) || dev.a[app].x) return null;
    return { target: dev.a[app].t, title: dev.a[app].ti, at: dev.a[app].at };
  }

  // ---------- RS-1: reopen after a restart (pure parts) ----------
  // The record (device-local oros-apps-last): { f: front id | null,
  // o: [other open ids, the one left last first], at, a?: 1 }.
  function lastRecord(front, others, now, auto) {
    var seenId = {}, o = [];
    (others || []).forEach(function (id) {
      if (typeof id === "string" && ID_RE.test(id) && id !== front && !seenId[id]) { seenId[id] = 1; o.push(id); }
    });
    var rec = { f: typeof front === "string" && ID_RE.test(front) ? front : null, o: o.slice(0, REOPEN_MAX - 1), at: num(now) || Date.now() };
    if (auto) rec.a = 1;
    return rec;
  }
  // reopenPlan(rec, opts) → { front, back: [ids] } | null
  //   opts.allow(id) → true when the app may reopen (internal, not a
  //   game (GR-1 has those), not Passwords, still registered)
  //   opts.multitask → the other open apps come back too (hidden)
  function reopenPlan(rec, opts) {
    rec = obj(rec);
    opts = obj(opts) || {};
    if (!rec || rec.a) return null;           // reopened by itself and gone within SETTLE_MS: not again
    var allow = typeof opts.allow === "function" ? opts.allow : function () { return false; };
    var front = typeof rec.f === "string" && ID_RE.test(rec.f) && allow(rec.f) ? rec.f : null;
    var back = [];
    if (opts.multitask && Array.isArray(rec.o)) {
      rec.o.forEach(function (id) {
        if (typeof id === "string" && ID_RE.test(id) && id !== front && back.indexOf(id) < 0 && allow(id)) back.push(id);
      });
    }
    back = back.slice(0, REOPEN_MAX - (front ? 1 : 0));
    if (!front && !back.length) return null;
    return { front: front, back: back };
  }

  var core = {
    KEEP_MS: KEEP_MS, SHOW_MS: SHOW_MS, MAX_APPS: MAX_APPS, MAX_DEVS: MAX_DEVS, TITLE_MAX: TITLE_MAX,
    TARGET_MAX: TARGET_MAX, NAME_MAX: NAME_MAX, RENOTE_MS: RENOTE_MS, FLUSH_MS: FLUSH_MS,
    REOPEN_MAX: REOPEN_MAX, SETTLE_MS: SETTLE_MS, NEVER: NEVER, KINDS: KINDS,
    DATA_KEY: DATA_KEY, DEV_KEY: DEV_KEY, NAME_KEY: NAME_KEY, PREFS_KEY: PREFS_KEY, LAST_KEY: LAST_KEY, SEEN_KEY: SEEN_KEY,
    kindOf: kindOf, norm: norm, merge: merge, note: note, clear: clear, rename: rename, forget: forget,
    shown: shown, devices: devices, lastOwn: lastOwn, lastRecord: lastRecord, reopenPlan: reopenPlan
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }

  // ---------- browser part ----------
  var ctx = null;              // { sync, apps(), strict(), solo }
  var sentJSON = null;         // this device's entry as last handed to sync
  var flushTimer = null;
  var listeners = [];

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function data() { return norm(readJSON(DATA_KEY), Date.now()); }
  function write(d) {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
  }
  function changed() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function devId() {
    var id = null;
    try { id = localStorage.getItem(DEV_KEY); } catch (e) {}
    if (id && DEV_RE.test(id)) return id;
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    try {
      var b = new Uint8Array(12);
      root.crypto.getRandomValues(b);
      for (var i = 0; i < 12; i++) out += a.charAt(b[i] % 36);
    } catch (e) {
      for (var j = 0; j < 12; j++) out += a.charAt(Math.floor(Math.random() * 36));
    }
    try { localStorage.setItem(DEV_KEY, out); } catch (e) {}
    return out;
  }
  function devName() { var n = null; try { n = localStorage.getItem(NAME_KEY); } catch (e) {} return text(n || "", NAME_MAX); }
  function kindHere() { return kindOf(root.navigator && root.navigator.userAgent); }
  function prefs() {
    var p = obj(readJSON(PREFS_KEY)) || {};
    return { cont: p.cont !== 0, reopen: p.reopen !== 0 };
  }
  function setPref(k, on) {
    var p = obj(readJSON(PREFS_KEY)) || {};
    if (on) delete p[k]; else p[k] = 0;
    try {
      if (Object.keys(p).length) localStorage.setItem(PREFS_KEY, JSON.stringify(p));
      else localStorage.removeItem(PREFS_KEY);
    } catch (e) {}
    if (k === "reopen" && !on) { try { localStorage.removeItem(LAST_KEY); } catch (e) {} }
    changed();
  }
  function strictOn() { try { return !!(ctx && ctx.strict && ctx.strict() !== null); } catch (e) { return false; } }
  function appOf(id) {
    var list = ctx && ctx.apps ? ctx.apps() : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  // May this app be recorded / shown on this device?
  function allowed(id) {
    if (!ID_RE.test(id || "") || NEVER.indexOf(id) >= 0) return false;
    var a = appOf(id);
    return !!(a && a.type === "internal" && a.searchOff !== true && a.category !== "Games");
  }

  function ownJSON(d) {
    var id = devId();
    return JSON.stringify(own(d.d, id) ? d.d[id] : null);
  }
  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    var j = ownJSON(data());
    if (j === sentJSON) return;
    sentJSON = j;
    try { if (ctx && ctx.sync && typeof ctx.sync.markDirty === "function") ctx.sync.markDirty(); } catch (e) {}
  }
  function later() {
    if (flushTimer) return;              // the first unsent note sets the clock
    flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function noteApp(app, o) {
    if (!ctx || strictOn() || !prefs().cont || !allowed(String(app || ""))) return false;
    o = obj(o) || {};
    var r = note(data(), { dev: devId(), kind: kindHere(), name: devName(), app: String(app), target: o.target, title: o.title }, Date.now());
    if (!r.changed) return false;
    if (!write(r.data)) return false;
    later();
    changed();
    return true;
  }
  function clearApp(app) {
    if (!ctx) return false;
    var r = clear(data(), devId(), String(app || ""), Date.now());
    if (!r.changed || !write(r.data)) return false;
    later();
    changed();
    return true;
  }
  function setName(n) {
    n = text(String(n || ""), NAME_MAX);
    try { if (n) localStorage.setItem(NAME_KEY, n); else localStorage.removeItem(NAME_KEY); } catch (e) {}
    var r = rename(data(), devId(), kindHere(), n, Date.now());
    if (r.changed && write(r.data)) flush();   // a rename is rare and meant: send it now
    changed();
  }
  function forgetDev(id) {
    if (id === devId()) return false;
    var r = forget(data(), String(id || ""), Date.now());
    if (!r.changed || !write(r.data)) return false;
    flush();
    changed();
    return true;
  }

  // W2: an item dismissed here (× on a card) stays hidden until that
  // device has something newer in that app. Pruned after SHOW_MS.
  function seenRead() {
    var src = obj(readJSON(SEEN_KEY)) || {}, now = Date.now(), out = {};
    Object.keys(src).forEach(function (k) {
      var v = num(src[k]);
      if (v && now - v <= SHOW_MS + DAY && /^[a-z0-9]{8,16}:[a-z0-9-]{1,40}$/.test(k)) out[k] = v;
    });
    return out;
  }
  function dismiss(dev, app, at) {
    var k = String(dev || "") + ":" + String(app || "");
    if (!/^[a-z0-9]{8,16}:[a-z0-9-]{1,40}$/.test(k)) return false;
    var s = seenRead();
    s[k] = Math.max(num(at) || Date.now(), s[k] || 0);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { return false; }
    changed();
    return true;
  }

  // Slice
  function sliceGet() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    return raw ? data() : null;            // a fresh device sends nothing
  }
  function sliceSet(d) {
    if (!d) return;
    write(norm(d, Date.now()));            // pulled: never markDirty (R6)
    changed();
  }
  function sliceMerge(local, remote) { return merge(local, remote, Date.now()); }

  function init(c) {
    if (ctx) return;
    ctx = c || {};
    sentJSON = ownJSON(data());
    var api = ctx.sync;
    if (api && typeof api.registerSlice === "function") api.registerSlice("continue", sliceGet, sliceSet, DATA_KEY, sliceMerge);
    if (api && typeof api.onAutoSync === "function") {
      api.onAutoSync(function (kind) { if (kind === "done") { sentJSON = ownJSON(data()); } });
    }
    // Leaving this device: flush BEFORE sync.js's own hide push (window
    // capture runs before the document's listeners).
    try {
      root.addEventListener("visibilitychange", function () {
        if (root.document && root.document.visibilityState === "hidden") flush();
      }, true);
      root.addEventListener("pagehide", flush, true);
    } catch (e) {}
  }

  root.orosContinue = {
    core: core,
    init: init,
    note: noteApp,                 // (appId, { target, title }) — apps call this
    clear: clearApp,               // (appId)
    allowed: allowed,
    prefs: prefs,
    setPref: setPref,              // ("cont" | "reopen", bool)
    deviceId: devId,
    deviceName: devName,
    kind: kindHere,
    setName: setName,
    forget: forgetDev,
    devices: function () { return devices(data(), devId(), Date.now()); },
    shown: function () {
      if (strictOn() || !prefs().cont) return [];
      return shown(data(), devId(), { now: Date.now(), ok: allowed, seen: seenRead() });
    },
    dismiss: dismiss,              // (devId, appId, at) — × on a card (W2)
    lastOwn: function (app) { return lastOwn(data(), devId(), app, Date.now()); },
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    flush: flush
  };
})(typeof window !== "undefined" ? window : this);
