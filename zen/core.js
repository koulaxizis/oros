// ============================================================
// orOS Micro-Zen — shared core (no DOM)
// 1. My patterns: own breathing patterns with a name, synced in the
//    slice "zenpat" (oros-zen-patterns), next to the three ready ones.
// 2. The Habits feed: a read-only row "Micro-Zen" in Habits, done on
//    each day with a finished session (generic window.orosHabitFeeds
//    contract; habits/index.html loads this file before habits.js).
//
//   Data  { ver, pats: [pat], tombs: { id: ms }, hb: { on, m } }
//   pat   { id, m, n: name (1-30), p: [in, hold, out, hold] ms }
//         in and out 1-20 s, holds 0-20 s, steps of half a second.
//         LWW per pattern + tombstones (R17, R26); at most 12.
//   hb    "Show in Habits" (on by default), LWW by m.
//
// Used by zen/zen.js, habits/habits.js (through the feed) and the
// tests. UMD: module.exports in Node, window.ZenCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER  = 1;
  var PATS_KEY  = "oros-zen-patterns";
  var ZEN_KEY   = "oros-zen-data";
  var MAX_PATS  = 12;
  var NAME_LEN  = 30;
  var STEP      = 500;
  var MAX_MS    = 20000;
  var ID_RE     = /^[a-z0-9]{6,40}$/;
  var DAY_RE    = /^\d{4}-\d{2}-\d{2}$/;
  var KINDS     = ["in", "hold", "out", "hold"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function normName(s) { return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : ""; }
  // One phase length: rounded to half seconds, clamped (in / out ≥ 1 s).
  function normMs(v, i) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    var ms = Math.round(v / STEP) * STEP, lo = (i === 0 || i === 2) ? 1000 : 0;
    return Math.max(lo, Math.min(MAX_MS, ms));
  }
  function normPhases(p) {
    if (!Array.isArray(p) || p.length !== 4) return null;
    var out = [];
    for (var i = 0; i < 4; i++) { var ms = normMs(p[i], i); if (ms === null) return null; out.push(ms); }
    return out;
  }
  function normPat(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    var n = normName(x.n), p = normPhases(x.p);
    if (!n || !p) return null;
    return { id: x.id, m: x.m, n: n, p: p };
  }

  function mergePats(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.pats, b.pats].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normPat(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var pats = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      pats.push(best[id]);
    });
    // more than 12 (two devices adding at once): the oldest stay
    pats = pats.slice().sort(function (x, y) { return x.m - y.m || cmpStr(x.id, y.id); }).slice(0, MAX_PATS)
               .sort(function (x, y) { return cmpStr(x.id, y.id); });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    var hb = { on: 1, m: 0 };
    [a.hb, b.hb].forEach(function (h) {
      if (!h || typeof h !== "object" || (h.on !== 0 && h.on !== 1) || !isInt(h.m) || h.m < 0) return;
      if (h.m > hb.m || (h.m === hb.m && h.on < hb.on)) hb = { on: h.on, m: h.m };
    });
    return { ver: DATA_VER, pats: pats, tombs: sortedTombs, hb: hb };
  }

  // A pattern as the app's phases { k, ms }; zero holds drop out.
  function phasesOf(pat) {
    var out = [];
    pat.p.forEach(function (ms, i) { if (ms > 0) out.push({ k: KINDS[i], ms: ms }); });
    return out;
  }
  // "4-2-6", "5.5-5.5" (the non-zero phases, in seconds).
  function patLabel(pat) {
    return pat.p.filter(function (ms) { return ms > 0; })
      .map(function (ms) { return String(ms / 1000); }).join("-");
  }
  function cycleSec(pat) { return pat.p.reduce(function (s, ms) { return s + ms; }, 0) / 1000; }

  // Days with at least one finished session, all devices: the feed.
  function zenDays(zen, pats) {
    if (pats && pats.hb && pats.hb.on === 0) return null;
    if (!zen || typeof zen !== "object" || !zen.rows || typeof zen.rows !== "object") return null;
    var br = isInt(zen.br) ? zen.br : 0, days = {}, any = false;
    Object.keys(zen.rows).forEach(function (id) {
      var r = zen.rows[id];
      if (!r || typeof r !== "object" || !isInt(r.b) || r.b < br || !r.d || typeof r.d !== "object") return;
      Object.keys(r.d).forEach(function (k) {
        var c = r.d[k];
        if (DAY_RE.test(k) && Array.isArray(c) && isInt(c[0]) && c[0] > 0) { days[k] = true; any = true; }
      });
    });
    return any ? { days: days } : null;
  }

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8" opacity=".55"/></svg>';
  function readJSON(k) { try { return JSON.parse(root.localStorage.getItem(k)); } catch (e) { return null; } }
  // The Habits feed row: Habits reads name / hint as { en, el } (the
  // feed contract), so the row keeps its EN/EL names in every language.
  var FEED_T = {
    en: { "feed.name": "Micro-Zen", "feed.hint": "A finished breathing session in Micro-Zen" },
    el: { "feed.name": "Μίκρο-Ζεν", "feed.hint": "Μια ολοκληρωμένη συνεδρία αναπνοής στο Μίκρο-Ζεν" }
  };
  var FEED = {
    id: "zen",
    app: "zen",
    name: { en: FEED_T.en["feed.name"], el: FEED_T.el["feed.name"] },
    hint: { en: FEED_T.en["feed.hint"], el: FEED_T.el["feed.hint"] },
    color: "#7fb7a4",
    icon: ICON,
    keys: [ZEN_KEY, PATS_KEY],
    read: function () { return zenDays(readJSON(ZEN_KEY), readJSON(PATS_KEY)); }
  };

  var api = {
    VER: DATA_VER, PATS_KEY: PATS_KEY, ZEN_KEY: ZEN_KEY, MAX_PATS: MAX_PATS, NAME_LEN: NAME_LEN,
    STEP: STEP, MAX_MS: MAX_MS, ID_RE: ID_RE,
    normName: normName, normPhases: normPhases, normPat: normPat, mergePats: mergePats,
    phasesOf: phasesOf, patLabel: patLabel, cycleSec: cycleSec, zenDays: zenDays, FEED: FEED
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ZenCore = api;
    // Habits loads this file for its feed row (the Zen app needs none).
    if (root.document && /\/habits\//.test(String(root.location && root.location.pathname))) {
      var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
      for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) return;
      feeds.push(FEED);
    }
  }
})(typeof window !== "undefined" ? window : this);
