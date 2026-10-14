// ============================================================
// orOS Calendar — free times ("Share free times", the booking link)
// Pure: no DOM, no storage. Reads the Calendar's own events through
// calendar/occur.js (instances in this device's zone).
//
//   busy(events, from, to, Occ)  → { "YYYY-MM-DD": [[startMin, endMin], …] }
//        Timed events only (all-day ones such as birthdays or a
//        holiday do not block time). An event without an end blocks
//        an hour; one that runs over midnight blocks both days.
//   slots(events, opts, Occ)     → [{ d: "YYYY-MM-DD", m: [startMin, …] }]
//        opts: { from: "YYYY-MM-DD" (first day), days: 1…60,
//                len: minutes 5…480, step?: minutes (default
//                min(len, 30)), dayStart: "HH:MM", dayEnd: "HH:MM",
//                wdays: [0…6] (0 = Sunday; default Mon–Fri),
//                nowMin?: minutes after midnight on `from` (slots
//                that start before it are left out), gap?: minutes
//                kept free around every event (default 0),
//                max?: slots in all (default 400) }
//        A slot is free when [start, start + len) touches no busy
//        time. Days with no free slot are left out.
// Exposes window.OrosCalFree and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function wdOf(s) { return ((dayNum(s) % 7) + 7 + 4) % 7; }
  function minOf(hm) { var p = String(hm).split(":"); return (+p[0]) * 60 + (+p[1]); }

  function busy(events, from, to, Occ) {
    var out = {};
    function add(day, a, b) {
      if (day < from || day > to || b <= a) return;
      (out[day] || (out[day] = [])).push([Math.max(0, a), Math.min(1440, b)]);
    }
    (events || []).forEach(function (e) {
      if (!e || !e.start) return;
      // Start a day early: a late event of the day before may run over.
      Occ.instancesBetween(e, addDays(from, -1), to, function (inst) {
        if (!inst.start) return;
        var s = minOf(inst.start);
        var lastDay = inst.dateEnd && inst.dateEnd > inst.date ? inst.dateEnd : inst.date;
        var eMin = inst.end ? minOf(inst.end) : null;
        if (lastDay === inst.date) {
          var end = eMin !== null && eMin > s ? eMin : s + 60;
          add(inst.date, s, Math.min(end, 1440));
          if (end > 1440) add(addDays(inst.date, 1), 0, end - 1440);
          return;
        }
        add(inst.date, s, 1440);
        var n = dayNum(inst.date) + 1, last = dayNum(lastDay);
        for (; n < last && n - dayNum(inst.date) < 400; n++) add(fromDayNum(n), 0, 1440);
        add(lastDay, 0, eMin !== null ? eMin : 1440);
      });
    });
    Object.keys(out).forEach(function (d) {
      out[d].sort(function (a, b) { return a[0] - b[0]; });
    });
    return out;
  }

  function slots(events, opts, Occ) {
    opts = opts || {};
    var days = Math.max(1, Math.min(60, opts.days | 0 || 7));
    var len = Math.max(5, Math.min(480, opts.len | 0 || 30));
    var step = Math.max(5, Math.min(240, opts.step | 0 || Math.min(len, 30)));
    var gap = Math.max(0, Math.min(120, opts.gap | 0));
    var max = Math.max(1, Math.min(2000, opts.max | 0 || 400));
    var ds = minOf(opts.dayStart || "09:00"), de = minOf(opts.dayEnd || "17:00");
    var wdays = Array.isArray(opts.wdays) ? opts.wdays : [1, 2, 3, 4, 5];
    var from = opts.from, to = addDays(from, days - 1);
    var b = busy(events, from, to, Occ);
    var out = [], count = 0;
    for (var i = 0; i < days && count < max; i++) {
      var day = addDays(from, i);
      if (wdays.indexOf(wdOf(day)) === -1) continue;
      var list = b[day] || [], m = [];
      var t0 = ds;
      if (i === 0 && typeof opts.nowMin === "number") {
        // the first slot after "now", on the step grid of the day
        while (t0 < opts.nowMin) t0 += step;
      }
      for (var t = t0; t + len <= de && count < max; t += step) {
        var a = t - gap, z = t + len + gap, clash = false;
        for (var k = 0; k < list.length; k++) {
          if (list[k][0] < z && list[k][1] > a) { clash = true; break; }
        }
        if (!clash) { m.push(t); count++; }
      }
      if (m.length) out.push({ d: day, m: m });
    }
    return out;
  }

  var api = { busy: busy, slots: slots };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalFree = api;
})(typeof window !== "undefined" ? window : null);
