// ============================================================
// orOS Base — feed.js (Calendar feed, BASE-1 wave B4; window.OrosBaseFeed)
// The Calendar (calendar/index.html loads this file) shows, under the
// chip "Base", the records of every date field that has "Show in
// Calendar" on (field opt.cal === true; off by default, Chris
// 2026-11-13). Pure and read-only: it reads the stored slice
// (oros-base-data), never writes, and never loads base/core.js.
//   byDay(d) → { "YYYY-MM-DD": [{ rec, base, table, title, field, time }] }
//     title = the record's primary field text (a text-like field), else "";
//     time  = "HH:MM" when the field keeps a time, else null.
//     At most MAX rows in all (newest days first are not preferred:
//     the first MAX in table order).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-base-data";
  var MAX = 5000;
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var DAY_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;
  var TEXTY = { text: 1, long: 1, email: 1, url: 1, phone: 1 };

  function arr(a) { return Array.isArray(a) ? a : []; }
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function str(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : ""; }

  function byDay(d) {
    var out = {};
    if (!isObj(d)) return out;
    var tombs = isObj(d.tombs) ? d.tombs : {};
    function live(x) { return isObj(x) && typeof x.id === "string" && ID_RE.test(x.id) && !(tombs[x.id] >= (x.m || 0)); }
    var bases = {}, tables = {}, cal = {}, prim = {};
    arr(d.bases).forEach(function (b) { if (live(b)) bases[b.id] = b; });
    arr(d.tables).forEach(function (t) { if (live(t) && bases[t.base]) tables[t.id] = t; });
    arr(d.fields).forEach(function (f) {
      if (!live(f) || !tables[f.tb]) return;
      if (f.type === "date" && isObj(f.opt) && f.opt.cal === true) (cal[f.tb] = cal[f.tb] || []).push(f);
      if (tables[f.tb].pf === f.id && TEXTY[f.type]) prim[f.tb] = f.id;
    });
    var n = 0;
    arr(d.recs).some(function (r) {
      if (n >= MAX) return true;
      if (!live(r) || !cal[r.t] || !isObj(r.v)) return false;
      var tb = tables[r.t], title = prim[r.t] ? str(r.v[prim[r.t]], 200) : "";
      cal[r.t].forEach(function (f) {
        var m = typeof r.v[f.id] === "string" ? DAY_RE.exec(r.v[f.id]) : null;
        if (!m || n >= MAX) return;
        n++;
        (out[m[1]] = out[m[1]] || []).push({ rec: r.id, base: tb.base, table: tb.id, title: title, field: str(f.name, 80), tname: str(tb.name, 80), time: f.opt.time && m[2] ? m[2] : null });
      });
      return false;
    });
    return out;
  }

  var API = { KEY: KEY, MAX: MAX, byDay: byDay };
  if (typeof module === "object" && module.exports) module.exports = API;
  else root.OrosBaseFeed = API;
})(typeof window !== "undefined" ? window : globalThis);
