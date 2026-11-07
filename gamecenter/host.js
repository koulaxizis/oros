// ============================================================
// orOS Game Center — daily challenges, shell side (v1.0.0, CH-1)
// Runs in the SHELL window (index.html late bundle, after
// gamekit/daily.js, gamecenter/core.js and gamecenter/challenge.js).
//   - keeps the synced slice "gamechal" (oros-gamechal-data, see
//     challenge.js for the shape and the merge)
//   - makes the day's goals the first time they are asked for (the
//     Game Center page, or the clock tick once the first sync had its
//     chance), from the games' own synced data, read-only
//   - notes the goals done (d) the first time it sees them done
//   - once a day from NOTICE_HOUR (18:00), when at least one goal is
//     still open, posts ONE notice: ns "gamecenter", key
//     "chal-<YYYY-MM-DD>" (the synced inbox shows it once on every
//     device), deep link system:open:gamecenter
// Mute: the Game Center notification switch (Settings ›
// Notifications, the same synced toggle; "Mute" on the section flips
// it). Hide: the section, the notice and the goals go (synced, hide).
// Inert until apps.json lists "gamecenter". Device-local:
// oros-gamechal-local { last: <day> } (the day the notice was decided).
// Runs on the shell's clock tick (window.orosChallenges.tick,
// throttled by the shell): no timer of its own. orOS closed = no
// notice; the first open after the hour catches up.
// ============================================================
(function (root) {
  "use strict";
  var C = root.orosGameChal, CORE = root.orosGameCore, DK = root.orosDaily;
  if (!C || !CORE || !DK) return;              // stale bundle without the cores

  var KEY = "oros-gamechal-data";
  var LOCAL_KEY = "oros-gamechal-local";
  var NS = "gamecenter";
  var NOTICE_HOUR = 18;
  var SYNC_WAIT_MS = 90000;
  var bootAt = Date.now();
  var syncDoneAt = 0;
  var listeners = [];

  var NOTE = {
    en: {
      "n.title": "Today's challenges",
      "n.body": "{n} of {k} still open. Tap to play.",
      "n.body1": "One challenge still open. Tap to play."
    },
    el: {
      "n.title": "Οι σημερινές προκλήσεις",
      "n.body": "{n} από {k} ακόμα ανοιχτές. Πάτα για να παίξεις.",
      "n.body1": "Μία πρόκληση ακόμα ανοιχτή. Πάτα για να παίξεις."
    }
  };
  var packAsked = {};
  function words() {
    var I = root.orosI18n, code = "en";
    try { code = I ? I.lang() : (root.orosLang === "el" ? "el" : "en"); } catch (e) {}
    if (NOTE[code]) return NOTE[code];
    if (!I || (I.known && !I.known(code))) return NOTE.en;
    var tab = I.table(NOTE, "gamecenter", code);
    if (!packAsked[code] && typeof I.ensure === "function") {
      packAsked[code] = true;
      try { I.ensure(code, "gamecenter", function () { delete NOTE[code]; }); } catch (x) {}
    }
    return tab;
  }

  function S() { return root.orosSync || null; }
  function N() { return root.orosNotifs || null; }

  // ---------- Slice ----------
  function read() {
    try { return C.norm(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return C.norm(null); }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(C.norm(d))); return true; }
    catch (e) { return false; }
  }
  function save(d) {                            // the person's own change (or a new day)
    var before = JSON.stringify(read()), next = C.norm(d);
    if (JSON.stringify(next) === before) return true;
    if (!write(next)) return false;
    var s = S();
    if (s && typeof s.markDirty === "function") s.markDirty();
    changed();
    return true;
  }
  function sliceGet() { return read(); }
  function sliceSet(d) {                        // R6: a pull never marks dirty
    if (!d || typeof d !== "object") return;
    var before = JSON.stringify(read()), next = C.norm(d);
    if (JSON.stringify(next) === before) return;
    write(next);
    changed();
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    // No storage key: this module is always live in the shell.
    s.registerSlice("gamechal", sliceGet, sliceSet, null, C.merge);
    if (typeof s.onAutoSync === "function") {
      s.onAutoSync(function (kind) { if (kind === "done" || kind === "fail") syncDoneAt = Date.now(); });
    }
  }

  function changed() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  // ---------- Reading the games ----------
  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function summary(day) { return CORE.summarize(readJSON, day); }

  function registered() {
    var e = root.orosTodayEnv;
    try {
      var list = e ? e.apps() : [];
      for (var i = 0; i < list.length; i++) if (list[i].id === "gamecenter") return true;
    } catch (x) {}
    return false;
  }
  // The first sync of this start had its chance: no cloud, a round
  // ended, or SYNC_WAIT_MS passed. Before that a device that was off
  // for days would measure the goals from old numbers.
  function settled() {
    var s = S(), connected = false;
    try { connected = !!(s && s.isConnected()); } catch (e) {}
    return !connected || syncDoneAt > 0 || Date.now() - bootAt > SYNC_WAIT_MS;
  }

  // The day's record: made when missing (force = the person opened the
  // Game Center), the goals now done noted. → { data, rec, sum, day }
  function current(force) {
    var day = DK.today(), data = read(), sum = summary(day);
    if (data.hide[1] === 1) return { data: data, rec: null, sum: sum, day: day };
    var rec = data.days[String(day)] || null;
    if (!rec && (force || settled())) {
      rec = C.make(sum, CORE.GAMES, data, day, Date.now());
      if (rec) { data = C.withDay(data, day, rec); save(data); rec = read().days[String(day)] || rec; }
    }
    if (rec) {
      var upd = C.noteDone(rec, sum);
      if (upd) { data = C.withDay(read(), day, upd); save(data); rec = read().days[String(day)] || upd; }
    }
    return { data: read(), rec: rec, sum: sum, day: day };
  }

  function muted() {
    var n = N();
    try { return !!(n && typeof n.getAppToggle === "function" && !n.getAppToggle(NS)); } catch (e) { return false; }
  }

  // ---------- For the Game Center page ----------
  // → { hidden, muted, day, played, goals: [{ g, k, n, have, done }], open, streak, total, skipped }
  function state() {
    var cur = current(true), data = cur.data;
    var goals = C.progress(cur.rec, cur.sum), open = 0;
    goals.forEach(function (g) { if (!g.done) open++; });
    return {
      hidden: data.hide[1] === 1,
      muted: muted(),
      day: cur.day,
      played: C.eligible(cur.sum, CORE.GAMES, { skip: {} }).length,
      goals: goals,
      open: open,
      streak: C.streak(data, cur.day),
      total: C.doneCount(data),
      skipped: C.skipped(data)
    };
  }
  // "Not this game" (off = true) or back on. Today's goals stay as
  // they are; the game is left out from tomorrow.
  function skip(game, off) {
    if (CORE.GAMES.indexOf(game) < 0) return false;
    return save(C.setSkip(read(), game, !!off, Date.now()));
  }
  function hide(on) { return save(C.setHide(read(), !!on, Date.now())); }
  function mute(on) {
    var n = N();
    if (!n || typeof n.setAppToggle !== "function") return false;
    n.setAppToggle(NS, !on);
    changed();
    return true;
  }

  // ---------- The daily notice ----------
  function readLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LOCAL_KEY));
      if (o && typeof o.last === "number") return o;
    } catch (e) {}
    return { last: -1 };
  }
  function writeLocal(day) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ last: day })); } catch (e) {}
  }
  function tick() {
    if (!registered()) return;
    var n = N();
    if (!n || typeof n.emit !== "function") return;
    var day = DK.today();
    if (readLocal().last === day || new Date().getHours() < NOTICE_HOUR || !settled()) return;
    var cur = current(false);
    if (!cur.rec) return;                       // hidden, or no game played yet: try again later
    var goals = C.progress(cur.rec, cur.sum), open = 0;
    goals.forEach(function (g) { if (!g.done) open++; });
    if (open && !muted()) {
      var w = words(), k = goals.length;
      n.emit({
        ns: NS,
        key: "chal-" + DK.dateStr(day),
        type: "reminder",
        title: w["n.title"],
        body: open === 1 ? w["n.body1"] : w["n.body"].replace("{n}", open).replace("{k}", k),
        deepLink: "system:open:gamecenter"
      });
    }
    writeLocal(day);                            // decided for today (sent, all done, or muted)
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  root.orosChallenges = {
    VERSION: "1.0.0",
    state: state,
    skip: skip,
    hide: hide,
    mute: mute,
    tick: tick,
    onChange: onChange
  };
  registerSlice();
})(window);
