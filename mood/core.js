// ============================================================
// orOS Mood — core.js (shared check-in rule, v1.0.0)
// One copy of "did the user log a mood today", read by:
//   - the shell (index.html → moodCheckInTick, the daily reminder)
//   - the Today summary (mood/today.js, through apps.json "today")
//   - the tests (tests/today-wave4.test.js, through module.exports)
// Pure functions, no DOM, no storage. Read-only.
// API (window.OrosMoodCore):
//   hasAny(raw)       the app has at least one entry (SH-B7: no entry
//                     ever → no daily nagging)
//   hasOn(raw, ymd)   an entry whose time (ts, ms) falls on that local
//                     day; an entry without a valid time never counts
// raw = oros-mood-data { entries: [{ id, ts, … }] }
// ============================================================
(function (root) {
  "use strict";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function entries(raw) { return raw && Array.isArray(raw.entries) ? raw.entries : []; }
  function hasAny(raw) { return entries(raw).length > 0; }
  function hasOn(raw, ymd) {
    var list = entries(raw);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.ts && ymdOf(e.ts) === ymd) return true;
    }
    return false;
  }
  var API = { hasAny: hasAny, hasOn: hasOn, ymdOf: ymdOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosMoodCore = API;
})(typeof window !== "undefined" ? window : globalThis);
