// ============================================================
// orOS Minimalism — core.js (shared daily-ritual rule, v1.0.0)
// One copy of "did the user engage with today's proposal", read by:
//   - the shell (index.html → minimalismCheckTick, the daily nudge)
//   - the Today summary (minimalism/today.js, apps.json "today")
//   - the tests (tests/today-wave4.test.js, through module.exports)
// Pure functions, no DOM, no storage. Read-only. The proposals
// themselves stay in content.js (the app only): Today only says that
// one waits.
// API (window.OrosMinimalismCore):
//   hasAny(raw)            at least one day record (SH-B7: never used
//                          → no daily nudge)
//   engagedOn(raw, ymd)    a record of that day on either level, done
//                          or skipped (a skip is deliberate engagement)
//   remindHour(raw)        prefs.remindHour 0-23, default 10
// raw = oros-minimalism-data { prefs: { remindHour }, days: [{ date,
//       level, status: "done"|"skip" }] }
// ============================================================
(function (root) {
  "use strict";
  function days(raw) { return raw && Array.isArray(raw.days) ? raw.days : []; }
  function hasAny(raw) { return days(raw).length > 0; }
  function engagedOn(raw, ymd) {
    var list = days(raw);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.date === ymd && (e.status === "done" || e.status === "skip")) return true;
    }
    return false;
  }
  function remindHour(raw) {
    var h = raw && raw.prefs ? raw.prefs.remindHour : null;
    return typeof h === "number" && h >= 0 && h <= 23 ? h : 10;
  }
  var API = { hasAny: hasAny, engagedOn: engagedOn, remindHour: remindHour };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosMinimalismCore = API;
})(typeof window !== "undefined" ? window : globalThis);
