// ============================================================
// orOS Calendar — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-calendar-data, never writes.
// One hit per event (title; time, location, note and the event's
// label as text, so a label's name finds its events). Feed rows
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
  var HH_KEY = "oros-calendar-hh";        // calendars shared with a household (calendar/house.js)
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
    // The shell loads calendar/occur.js (every rule of wave 5);
    // the walk below is the fallback for the simple rules.
    var OCC = root && root.OrosCalOccur;
    if (OCC && typeof OCC.eachOccurrence === "function") {
      var hit = null, lastOcc = e.date;
      OCC.eachOccurrence(e, function (o) {
        if (o >= today) { hit = o; return false; }
        lastOcc = o;
      });
      return hit || lastOcc;
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

  // The user's own labels (calendar.js state.labels). Untouched seeds
  // (mtime 0) are stored in English and shown translated.
  // Same keys and texts as calendar.js.
  var L = {
    en: { "lbl.personal": "Personal", "lbl.work": "Work", "lbl.family": "Family", "srch.label": "Label: " },
    el: { "lbl.personal": "Προσωπικό", "lbl.work": "Εργασία", "lbl.family": "Οικογένεια", "srch.label": "Ετικέτα: " }
  };
  var SEEDS = { "lbl-personal": "lbl.personal", "lbl-work": "lbl.work", "lbl-family": "lbl.family" };
  function labelNames(d, w) {
    var out = {};
    (Array.isArray(d.labels) ? d.labels : []).forEach(function (l) {
      if (!l || typeof l.id !== "string" || typeof l.name !== "string") return;
      out[l.id] = l.mtime === 0 && SEEDS[l.id] ? w[SEEDS[l.id]] : str(l.name);
    });
    return out;
  }

  var PROVIDER = {
    id: "calendar",
    keys: [KEY, HH_KEY],
    pickDate: pickDate,
    search: function (ctx) {
      var d = ctx.readJSON(KEY), hh = ctx.readJSON(HH_KEY), out = [];
      if (hh && Array.isArray(hh.events) && hh.events.length) {
        d = { labels: (d && Array.isArray(d.labels) ? d.labels : []).concat(Array.isArray(hh.labels) ? hh.labels : []),
              events: (d && Array.isArray(d.events) ? d.events : []).concat(hh.events) };
      }
      if (!d || !Array.isArray(d.events)) return out;
      var now = new Date(), today = ymd(now.getFullYear(), now.getMonth(), now.getDate());
      var w = L[ctx.lang] || L.en, lbl = labelNames(d, w);
      d.events.forEach(function (e) {
        if (!e || typeof e.id !== "string" || typeof e.date !== "string" || !YMD.test(e.date)) return;
        var day = pickDate(e, today);
        var p = day.split("-");
        var hm = typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start) ? e.start.split(":") : [12, 0];
        out.push({
          id: e.id,
          title: str(e.title),
          text: [str(e.start) && str(e.start) + (str(e.end) ? "–" + str(e.end) : ""),
                 typeof e.labelId === "string" && lbl[e.labelId] ? w["srch.label"] + lbl[e.labelId] : "",
                 str(e.location), str(e.note)].filter(Boolean).join(" · "),
          when: new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1]).getTime(),
          target: { id: e.id, date: day },
          labels: typeof e.labelId === "string" && lbl[e.labelId] ? [lbl[e.labelId]] : []
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
