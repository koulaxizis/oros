// ============================================================
// orOS Calendar — occurrences of the Calendar's own events (v1.0.0)
// ONE truth for "which days does this event fall on", shared by the
// Calendar (calendar.js month/day views), the shell's reminder engine
// (shell.js calRemEachOccurrence) and the Today summary
// (calendar/today.js). Pure: no DOM, no storage.
//   validRecur(r)            → bool
//   eachOccurrence(e, cb)    walks a series in ascending date order;
//                            cb(ymd) — return false to stop. Sticky
//                            clamp (Jan 31 → Feb 28 → Mar 31), D/W step
//                            days, interval 2 = bi-weekly, exdates
//                            skipped, "until" stops the walk.
//   occursOn(e, ymd)         series: computed occurrences; plain: the
//                            anchor day or the whole date → dateEnd span
//   eventsOn(data, ymd)      the stored events (oros-calendar-data) on
//                            that day, tombstoned ids left out, sorted:
//                            timed first by start, then all day
// Exposes window.OrosCalOccur and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function dimOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  function validRecur(r) {
    return !!(r && typeof r === "object" && /^[DWMY]$/.test(r.freq || ""));
  }

  function eachOccurrence(e, cb) {
    if (!e || typeof e.date !== "string" || !YMD_RE.test(e.date) || !validRecur(e.recur)) return;
    var p = e.date.split("-");
    var y = +p[0], m = +p[1] - 1;
    var origDay = +p[2];
    var d = origDay;
    var r = e.recur;
    var interval = (r.interval === 2) ? 2 : 1;
    var until = (typeof r.until === "string" && YMD_RE.test(r.until)) ? r.until : null;
    var exSet = {};
    if (Array.isArray(r.exdates)) {
      for (var x = 0; x < r.exdates.length && x < 100; x++) {
        if (YMD_RE.test(r.exdates[x])) exSet[r.exdates[x]] = true;
      }
    }
    // Step budget must outlive any realistic series age: D ≈ 110
    // years, W (incl. ×2) ≈ 200 years, M/Y ≈ 50+ years.
    var MAX_STEPS = (r.freq === "D") ? 40000 : (r.freq === "W") ? 5200 : 600;
    for (var step = 0; step < MAX_STEPS; step++) {
      var occYmd = ymd(y, m, d);
      if (until && occYmd > until) return;
      if (!exSet[occYmd]) {
        if (cb(occYmd) === false) return;
      }
      if (r.freq === "D") {
        d += interval;
      } else if (r.freq === "W") {
        d += 7 * interval;
      } else if (r.freq === "M") {
        m += interval;
        while (m > 11) { m -= 12; y++; }
        d = Math.min(origDay, dimOfMonth(y, m));   // sticky clamp
      } else if (r.freq === "Y") {
        y += interval;
        d = Math.min(origDay, dimOfMonth(y, m));   // Feb 29 → Feb 28
      } else {
        return;
      }
      // normalize day overflow from D/W stepping (max +14 days)
      var dim = dimOfMonth(y, m);
      if (d > dim) { d -= dim; m++; if (m > 11) { m = 0; y++; } }
    }
  }

  function occursOn(e, dateStr) {
    if (!e || typeof e.date !== "string") return false;
    if (validRecur(e.recur)) {
      if (e.recur.until && dateStr > e.recur.until) return false;
      var found = false;
      eachOccurrence(e, function (occYmd) {
        if (occYmd >= dateStr) {          // ascending walk: past the
          found = (occYmd === dateStr);   // target → answer is final
          return false;
        }
      });
      return found;
    }
    if (e.date > dateStr) return false;
    return dateStr <= (e.dateEnd || e.date);
  }

  function eventsOn(data, dateStr) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events) || !YMD_RE.test(dateStr)) return [];
    var gone = {};
    (Array.isArray(data.deleted) ? data.deleted : []).forEach(function (t) {
      if (t && typeof t.id === "string") gone[t.id] = true;
    });
    return data.events.filter(function (e) {
      return e && typeof e === "object" && typeof e.id === "string" && !gone[e.id] &&
             typeof e.date === "string" && YMD_RE.test(e.date) && occursOn(e, dateStr);
    }).sort(function (a, b) {
      var sa = typeof a.start === "string" ? a.start : null, sb = typeof b.start === "string" ? b.start : null;
      if (sa === sb) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa < sb ? -1 : 1;
    });
  }

  var api = { validRecur: validRecur, eachOccurrence: eachOccurrence, occursOn: occursOn, eventsOn: eventsOn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosCalOccur = api;
})(typeof window !== "undefined" ? window : globalThis);
