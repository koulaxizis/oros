// ============================================================
// orOS Calendar — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-calendar-data, never writes.
// One hit per event (title; note and location as text). Feed rows
// (birthdays, To-Do, Kanban…) are not stored here and are found in
// their own apps. Deleted events are not in events[].
// The date shown, and the day the Calendar opens on, is the next
// occurrence from today (repeating events), else the last one.
// The walk mirrors calendar.js eachOccurrence(). Opens through the
// existing Calendar bridge (__orosOpenCalendar(id, ymd)).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-calendar-data";
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function dim(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  // The occurrence to show: first one on/after today, else the last.
  function pickDate(e, today) {
    var r = e.recur;
    if (!r || typeof r !== "object" || ["D", "W", "M", "Y"].indexOf(r.freq) === -1) {
      return e.date;
    }
    var p = e.date.split("-"), y = +p[0], m = +p[1] - 1, origDay = +p[2], d = origDay;
    var interval = r.interval === 2 ? 2 : 1;
    var until = typeof r.until === "string" && YMD.test(r.until) ? r.until : null;
    var ex = {};
    (Array.isArray(r.exdates) ? r.exdates : []).slice(0, 100).forEach(function (x) { ex[x] = true; });
    var MAX = r.freq === "D" ? 40000 : r.freq === "W" ? 5200 : 600, last = e.date;
    for (var s = 0; s < MAX; s++) {
      var o = ymd(y, m, d);
      if (until && o > until) break;
      if (!ex[o]) { if (o >= today) return o; last = o; }
      if (r.freq === "D") d += interval;
      else if (r.freq === "W") d += 7 * interval;
      else if (r.freq === "M") {
        m += interval;
        while (m > 11) { m -= 12; y++; }
        d = Math.min(origDay, dim(y, m));
      } else {
        y += interval;
        d = Math.min(origDay, dim(y, m));
      }
      var n = dim(y, m);
      if (d > n) { d -= n; m++; if (m > 11) { m = 0; y++; } }
    }
    return last;
  }

  var PROVIDER = {
    id: "calendar",
    keys: [KEY],
    pickDate: pickDate,
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.events)) return out;
      var now = new Date(), today = ymd(now.getFullYear(), now.getMonth(), now.getDate());
      d.events.forEach(function (e) {
        if (!e || typeof e.id !== "string" || typeof e.date !== "string" || !YMD.test(e.date)) return;
        var day = pickDate(e, today);
        var p = day.split("-");
        var hm = typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start) ? e.start.split(":") : [12, 0];
        out.push({
          id: e.id,
          title: str(e.title),
          text: [str(e.start) && str(e.start) + (str(e.end) ? "–" + str(e.end) : ""),
                 str(e.location), str(e.note)].filter(Boolean).join(" · "),
          when: new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1]).getTime(),
          target: { id: e.id, date: day }
        });
      });
      return out;
    },
    open: function (target, win) {
      if (target && typeof target.id === "string" && typeof target.date === "string" &&
          win && typeof win.__orosOpenCalendar === "function") {
        win.__orosOpenCalendar(target.id, target.date);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("calendar", null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
