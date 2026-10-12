// ============================================================
// orOS Cycle — core.js (shared prediction, v1.0.0)
// One copy of the next-period estimate, read by every page that
// needs it:
//   - the Cycle app (cycle/index.html loads it before cycle.js)
//   - the shell (index.html → cycleCheckTick while the app is closed)
//   - the Today summary (cycle/today.js, through apps.json "today")
//   - the tests (tests/today-wave4.test.js, through module.exports)
// Pure functions, no DOM, no storage, no language. Read-only.
// An ESTIMATE from the user's own history: next start = last start +
// average cycle length (mean gap between consecutive starts, needs at
// least 2 starts); window = average period length (ended periods
// only, inclusive days, 5 when none has ended yet).
//
// API (window.OrosCycleCore):
//   DAY_MS
//   snap(ts)                 local midnight of ts, or null
//   avgCycleLen(periods)     days, or null with fewer than 2 starts
//   avgPeriodLen(periods)    days, or null with no ended period
//   nextPrediction(periods)  { start, end, avg } (ms) or null
//   dueIn(periods, todayMs)  { ymd, daysLeft } of the predicted start
//                            when it is at most 2 days away or past;
//                            else null (the reminder rule)
//   ymdOf(ts)                "YYYY-MM-DD" in local time
// periods = [{ start: ms, end: ms | null, … }] (oros-cycle-data)
// ============================================================
(function (root) {
  "use strict";
  var DAY_MS = 24 * 60 * 60 * 1000;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function snap(ts) {
    if (typeof ts !== "number" || !isFinite(ts)) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  // valid starts, snapped to local midnight, oldest first
  function starts(periods) {
    var out = [];
    (Array.isArray(periods) ? periods : []).forEach(function (p) {
      if (!p) return;
      var s = snap(p.start);
      if (s !== null) out.push(s);
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function avgCycleLen(periods) {
    var st = starts(periods);
    if (st.length < 2) return null;                     // honesty over guessing
    var sum = 0;
    for (var i = 1; i < st.length; i++) sum += Math.round((st[i] - st[i - 1]) / DAY_MS);
    return Math.round(sum / (st.length - 1));
  }
  function avgPeriodLen(periods) {
    var sum = 0, n = 0;
    (Array.isArray(periods) ? periods : []).forEach(function (p) {
      if (p && typeof p.end === "number" && isFinite(p.end) &&
          typeof p.start === "number" && p.end >= p.start) {
        sum += Math.round((p.end - p.start) / DAY_MS) + 1;   // inclusive
        n++;
      }
    });
    return n ? Math.round(sum / n) : null;
  }
  function nextPrediction(periods) {
    var avg = avgCycleLen(periods);
    if (avg === null) return null;
    var st = starts(periods), last = st[st.length - 1];
    var len = avgPeriodLen(periods);
    if (len === null) len = 5;                          // no ended period yet
    var start = last + avg * DAY_MS;
    return { start: start, end: start + (len - 1) * DAY_MS, avg: avg };
  }
  function dueIn(periods, todayMs) {
    var pr = nextPrediction(periods);
    if (!pr) return null;
    var daysLeft = Math.ceil((pr.start - todayMs) / DAY_MS);
    if (daysLeft > 2) return null;
    return { ymd: ymdOf(pr.start), daysLeft: daysLeft };
  }

  var API = { DAY_MS: DAY_MS, snap: snap, avgCycleLen: avgCycleLen, avgPeriodLen: avgPeriodLen,
              nextPrediction: nextPrediction, dueIn: dueIn, ymdOf: ymdOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCycleCore = API;
})(typeof window !== "undefined" ? window : globalThis);
