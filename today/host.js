// ============================================================
// orOS Today — shell side (v1.0.0)
// Runs in the SHELL window (index.html loads it after
// notifications.js, with today/agg.js before it). It
//   - keeps the synced settings slice "today" (oros-today-data):
//     on/off, start hour, which apps, "quiet the morning reminders
//     the summary covers"
//   - loads the apps' today.js providers (apps.json "today") the
//     first time a summary is built, from the precache
//   - builds the summary (today/agg.js) for the Today app and for
//     the daily notice
//   - once a day, from the start hour (default 06:00) and only after
//     the unlock and the first sync merge, posts ONE notice
//     (ns "today", key "day-<ymd>": the synced inbox shows it once on
//     every device) when something is late or due today
// Reads only. It never writes another app's data; its own writes
// are the settings slice and the device-local "oros-today-local"
// { last: "YYYY-MM-DD", sent: bool } (the day it decided, and
// whether the notice is in the inbox).
// Runs on the shell's clock tick (window.orosToday.tick, throttled
// by the shell): no timer of its own. orOS closed = nothing fires;
// the first open after the start hour catches up (honest limit).
// ============================================================
(function (root) {
  "use strict";
  var A = root.OrosTodayAgg;
  if (!A) return;                               // stale bundle without agg.js

  var KEY = "oros-today-data";
  var LOCAL_KEY = "oros-today-local";
  var LOAD_MS = 3000;
  var bootAt = Date.now();
  var sync = { at: 0, failAt: 0 };
  var emptyAt = 0;
  var building = null;
  var listeners = [];

  function env() { return root.orosTodayEnv || null; }
  function lang() { var e = env(); try { return e && e.lang() === "el" ? "el" : "en"; } catch (x) { return "en"; } }
  function S() { return root.orosSync || null; }

  // ---------- Settings slice ----------
  function read() {
    try { return A.normData(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return A.normData(null); }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(A.normData(d))); return true; }
    catch (e) { return false; }
  }
  function sliceGet() { return read(); }
  function sliceSet(d) {                        // R6: a pull never marks dirty
    if (!d || typeof d !== "object") return;
    var before = JSON.stringify(read());
    var next = A.normData(d);
    if (JSON.stringify(next) === before) return;
    write(next);
    changed("settings");
  }
  function setSetting(name, value, appId) {
    var cur = read();
    var next = A.setField(cur, name, value, Date.now(), appId);
    if (JSON.stringify(next) === JSON.stringify(cur)) return true;
    if (!write(next)) return false;
    var s = S();
    if (s && typeof s.markDirty === "function") s.markDirty();
    changed("settings");
    return true;
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    // No storage key: this module is always live in the shell (like
    // the inbox), a closed-app proxy is never needed.
    s.registerSlice("today", sliceGet, sliceSet, null, A.merge);
    if (typeof s.onAutoSync === "function") {
      s.onAutoSync(function (kind) {
        if (kind === "done") { sync.at = Date.now(); changed("sync"); }
        else if (kind === "fail") sync.failAt = Date.now();
      });
    }
  }

  function readLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LOCAL_KEY));
      if (o && typeof o === "object" && A.isYmd(o.last)) return { last: o.last, sent: o.sent === true };
    } catch (e) {}
    return { last: "", sent: false };
  }
  function writeLocal(o) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ last: o.last, sent: !!o.sent })); } catch (e) {}
  }

  function changed(why) {
    listeners.slice().forEach(function (fn) { try { fn(why); } catch (e) {} });
  }

  // ---------- Apps and providers ----------
  function allApps() {
    var e = env();
    try { return e ? e.apps() : []; } catch (x) { return []; }
  }
  function todayApps() {
    return allApps().filter(function (a) { return A.todayFiles(a).length > 0; });
  }
  var loading = {};
  function loadOne(src) {
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = s.onerror = function () { resolve(); };
      setTimeout(resolve, LOAD_MS);             // a missing file never holds the rest back
      document.head.appendChild(s);
    });
    return loading[src];
  }
  function loadApp(app, version) {
    var files = A.todayFiles(app), p = Promise.resolve();
    files.forEach(function (f) {
      var src = f + (version ? "?v=" + encodeURIComponent(version) : "");
      p = p.then(function () { return loadOne(src); });   // in the listed order
    });
    return p;
  }
  function provider(id) {
    var list = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function readRaw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function readJSON(key) {
    try { return JSON.parse(readRaw(key)); } catch (e) { return null; }
  }

  // ---------- Building ----------
  // → Promise<{ today, lang, groups, counts, apps: [{ id, name, sensitive, on }], at }>
  function build() {
    var e = env(), version = "";
    try { version = e ? e.version : ""; } catch (x) {}
    var data = read(), apps = todayApps(), now = Date.now(), today = A.ymdOf(new Date(now)), l = lang();
    var on = {};
    apps.forEach(function (a) { on[a.id] = A.appOn(data, a.id); });
    return Promise.all(apps.filter(function (a) { return on[a.id]; }).map(function (a) {
      return loadApp(a, version);
    })).then(function () {
      var ctx = { today: today, horizon: A.HORIZON, now: now, lang: l, readJSON: readJSON, readRaw: readRaw,
                  addDays: A.addDays, diff: A.diff };
      return A.run(root.orosTodayProviders, ctx, { enabled: function (id) { return !!on[id]; } });
    }).then(function (res) {
      var order = apps.map(function (a) { return a.id; });
      var g = A.trim(A.group(res.rows, today, A.HORIZON, order));
      return {
        today: today, lang: l, at: now,
        groups: g,
        counts: A.counts(g),
        apps: apps.map(function (a) {
          return { id: a.id, name: a.name, sensitive: a.searchOff === true, on: !!on[a.id] };
        })
      };
    });
  }

  function open(appId, target) {
    appId = String(appId || "");
    if (!A.ID_RE.test(appId)) return;
    var p = provider(appId);
    if (p && typeof p.open === "function") {
      try { p.open(target === undefined ? null : target, root); return; } catch (e) {}
    }
    if (typeof root.__orosOpenAt === "function") root.__orosOpenAt(appId, target === undefined ? null : target);
  }

  // ---------- The daily notice ----------
  function isSettled(now) {
    var s = S(), connected = false, unlocked = false;
    try { connected = !!(s && s.isConnected()); } catch (e) {}
    try { unlocked = !!(s && s.hasPassphrase()); } catch (e) {}
    return A.settled({
      connected: connected, unlocked: unlocked, online: navigator.onLine !== false,
      now: now, bootAt: bootAt, syncAt: sync.at, failAt: sync.failAt
    });
  }
  function registered() {
    var list = allApps();
    for (var i = 0; i < list.length; i++) if (list[i].id === "today") return true;
    return false;
  }
  function inboxHas(key) {
    var N = root.orosNotifs;
    try {
      var items = N.getSlice().items;
      for (var i = 0; i < items.length; i++) if (items[i].dedupKey === key) return true;
    } catch (e) {}
    return false;
  }
  function tick() {
    if (building || !registered()) return;
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var data = read(), local = readLocal(), now = Date.now();
    var step = A.decide({
      on: data.on.v, hour: data.hour.v, now: now, last: local.last,
      settled: isSettled(now), emptyAt: emptyAt, syncAt: sync.at
    });
    if (step !== "build") return;
    building = build().then(function (res) {
      building = null;
      if (res.today !== A.ymdOf(new Date())) return;      // midnight passed while building
      if (!A.worthNotice(res.counts)) { emptyAt = Date.now(); return; }
      var txt = A.noticeText(res.counts, res.lang);
      var id = N.emit({
        ns: "today",
        key: "day-" + res.today,
        type: "reminder",
        title: txt.title,
        body: txt.body,
        deepLink: "today:" + res.today
      });
      writeLocal({ last: res.today, sent: !!id || inboxHas("today:day-" + res.today) });
    }, function () { building = null; emptyAt = Date.now(); });
  }

  // The manual unlock pulls directly (no auto-sync event): the shell
  // calls this when that pull ends.
  function syncSettled(ok) {
    if (ok === false) sync.failAt = Date.now();
    else { sync.at = Date.now(); changed("sync"); }
  }

  // Should the shell's own morning reminder for `ns` stay quiet?
  // Only once today's summary notice is in the inbox, it is on, the
  // "quiet the morning reminders" setting is on and that app is in
  // the summary. Everything else (Today off, an empty day, a locked
  // device, notices switched off) leaves the old reminder as it was.
  function absorbs(ns) {
    ns = String(ns || "");
    if (!A.ID_RE.test(ns)) return false;
    var local = readLocal();
    if (!local.sent || local.last !== A.ymdOf(new Date())) return false;
    var data = read();
    if (!data.on.v || !data.absorb.v || !A.appOn(data, ns)) return false;
    var list = todayApps();
    for (var i = 0; i < list.length; i++) if (list[i].id === ns) return true;
    return false;
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  root.orosToday = {
    VERSION: "1.0.0",
    build: build,
    open: open,
    tick: tick,
    absorbs: absorbs,
    syncSettled: syncSettled,
    onChange: onChange,
    settings: function () { return read(); },
    setSetting: setSetting,
    askText: A.askText
  };
  registerSlice();
})(window);
