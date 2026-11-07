// ============================================================
// orOS Discover — weekly app suggestion core (v1.0.0, CH-2)
// Pure logic, no DOM, no storage. Used by the shell side
// (discover/host.js), the Today card and tests/discover.test.js.
//
// Once a week one app or game the person has never opened, on any
// of their devices, is suggested. The pick depends only on the week
// and on the apps not opened before that week began, so every device
// suggests the same one, and opening it during the week does not
// change the week's pick (the card then says it was opened).
//
// Synced slice "discover" (oros-discover-data), owned by host.js:
//   { v: 1, seen: { <appId>: <day first opened> }, no: { <appId>: [mtime, 1 | 0] } }
//   day = orosDaily day number (1 Jan 2026 = 0, local date);
//   no = "Not for me" (1) or taken back (0).
// merge (R5 symmetric, R26 canonical): seen = union, the earlier day;
// no = the newer mtime (tie → the greater JSON).
// Weeks start on Monday: week = floor((day + 3) / 7) (1 Jan 2026 was
// a Thursday, so Monday 29 Dec 2025 = day −3 starts week 0).
// ============================================================
(function (root) {
  "use strict";

  var DK = (typeof module !== "undefined" && module.exports) ? require("../gamekit/daily.js") : root.orosDaily;

  var ID_RE = /^[a-z0-9]{1,24}$/;
  var MAX_MT = 8640000000000000;
  var MAX_DAY = 100000;
  // Never suggested: the system apps (always at hand) and the apps
  // that are of no use without an account of the person's own (P3: an
  // app with an account linked already has its data, so it counts as
  // opened anyway).
  var NEVER = ["settings", "help", "today", "device", "automations", "assistant",
    "mail", "newsletter", "publish"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }

  function weekOf(day) { return Math.floor((day + 3) / 7); }
  function weekStart(week) { return week * 7 - 3; }

  // The apps the week can suggest, in a fixed order (by id).
  // ids: the installed internal apps; data: the slice.
  function candidates(ids, data, week) {
    var start = weekStart(week), out = [];
    (ids || []).forEach(function (id) {
      if (typeof id !== "string" || !ID_RE.test(id) || NEVER.indexOf(id) >= 0 || out.indexOf(id) >= 0) return;
      var s = data.seen[id];
      if (isInt(s) && s < start) return;          // opened before this week
      if (data.no[id] && data.no[id][1] === 1) return;
      out.push(id);
    });
    return out.sort();
  }
  // → the app id of the week, or "" when nothing is left to suggest.
  function pick(ids, data, week) {
    var list = candidates(ids, data, week);
    if (!list.length) return "";
    var r = DK.random("discover:" + week);
    return list[Math.floor(r() * list.length)];
  }

  // ---------- Normalizing (canonical, R26) ----------
  function norm(x) {
    x = obj(x) || {};
    var sin = obj(x.seen) || {}, seen = {};
    Object.keys(sin).sort().forEach(function (id) {
      var d = sin[id];
      if (ID_RE.test(id) && isInt(d) && d >= -7 && d <= MAX_DAY) seen[id] = d;
    });
    var nin = obj(x.no) || {}, no = {};
    Object.keys(nin).sort().forEach(function (id) {
      var f = nin[id];
      if (!ID_RE.test(id) || !Array.isArray(f) || f.length !== 2 || !isInt(f[0]) || f[0] < 0 || f[0] > MAX_MT) return;
      no[id] = [f[0], f[1] === 1 ? 1 : 0];
    });
    return { v: 1, seen: seen, no: no };
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function merge(a, b) {
    a = norm(a); b = norm(b);
    var seen = {}, no = {};
    Object.keys(a.seen).concat(Object.keys(b.seen)).forEach(function (id) {
      var x = a.seen[id], y = b.seen[id];
      seen[id] = x === undefined ? y : y === undefined ? x : Math.min(x, y);
    });
    Object.keys(a.no).concat(Object.keys(b.no)).forEach(function (id) {
      no[id] = newer(a.no[id] || null, b.no[id] || null);
    });
    return norm({ v: 1, seen: seen, no: no });
  }

  // ---------- Edits (return the new data, or null when nothing changes) ----------
  // ids: [{ id, day }] apps opened (or found with data of their own).
  function addSeen(data, list) {
    var x = norm(data), any = false;
    (list || []).forEach(function (s) {
      if (!s || !ID_RE.test(String(s.id)) || !isInt(s.day)) return;
      if (isInt(x.seen[s.id]) && x.seen[s.id] <= s.day) return;
      x.seen[s.id] = s.day;
      any = true;
    });
    return any ? norm(x) : null;
  }
  function setNo(data, id, on, now) {
    var x = norm(data);
    if (!ID_RE.test(String(id))) return x;
    var cur = x.no[id] || null;
    x.no[id] = [Math.max(isInt(now) && now > 0 ? now : 0, cur ? cur[0] + 1 : 0), on ? 1 : 0];
    return norm(x);
  }

  var API = {
    VERSION: "1.0.0", NEVER: NEVER,
    weekOf: weekOf, weekStart: weekStart, candidates: candidates, pick: pick,
    norm: norm, merge: merge, addSeen: addSeen, setNo: setNo
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.orosDiscoverCore = API;
})(typeof window !== "undefined" ? window : this);
