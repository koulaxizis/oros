// ============================================================
// orOS Travel — core.js (shared read-only logic, v1.0.0)
// What the shell and the Calendar need from Travel data, in one
// file so the two can never disagree:
//   - the Calendar "Travel" feed (calendar/index.html loads it):
//     each trip on every one of its days, itinerary entries that
//     have a time on their day
//   - the shell's reminder engine (index.html → travelCheckTick,
//     works while the app is closed): the evening before departure
//     ("Rome tomorrow · 6 items to pack") and shortly before a
//     timed departure (flight 3 h, other transport 1 h)
// Pure functions, no DOM, no network, never writes. The data is
// read defensively: anything malformed is skipped, deleted trips
// (tombstones) stay out. Times are as entered in the app (the
// local time on the ticket); no time-zone conversion.
//
// API (window.OrosTravelCore):
//   ID_RE, KINDS, EVE_HOUR, LEAD_MIN
//   isYmd, ymdOf(date), addDays(ymd, n)
//   trips(raw) → [{ id, name, dest, start, end, pack: { left, before, n }, plan: [entry…] }]
//   label(trip) · kindName(kind, lang) · entryTitle(entry, lang)
//   feedRows(trips) → [{ key, day, start, end, trip, kind, title?, entry? }]
//   due(trips, nowMs, lang) → [{ key, trip, tab, title, body }]
//   pruneFired(fired, nowMs) → the device-local "already announced" map, trimmed
// ============================================================
(function (root) {
  "use strict";

  var ID_RE  = /^[a-z0-9][a-z0-9-]{3,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE  = /^([01]\d|2[0-3]):[0-5]\d$/;
  var KINDS  = ["flight", "train", "bus", "ferry", "car", "stay", "activity", "food", "other"];
  var MOVES  = { flight: 1, train: 1, bus: 1, ferry: 1, car: 1 };
  var LEAD_MIN = { flight: 180, train: 60, bus: 60, ferry: 60 };   // minutes before a timed departure
  var EVE_HOUR = 18;                     // the "tomorrow you leave" reminder, from this hour on
  var MAX_DAYS = 90;                     // same cap as the app
  var FIRED_DAYS = 3;                    // device-local dedup entries kept this long
  var DAY_MS = 86400000;

  var STR = {
    en: {
      flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry", car: "Car",
      stay: "Stay", activity: "Activity", food: "Food", other: "Other",
      trip: "Trip", tomorrow: "{trip} tomorrow", pack: "{n} items to pack", pack1: "1 item to pack",
      before: "{n} things to do before you leave", before1: "1 thing to do before you leave",
      packed: "everything is packed", at: "{what} at {time}", ref: "booking {ref}"
    },
    el: {
      flight: "Πτήση", train: "Τρένο", bus: "Λεωφορείο", ferry: "Πλοίο", car: "Αυτοκίνητο",
      stay: "Διαμονή", activity: "Δραστηριότητα", food: "Φαγητό", other: "Άλλο",
      trip: "Ταξίδι", tomorrow: "{trip} αύριο", pack: "{n} είδη για τη βαλίτσα", pack1: "1 είδος για τη βαλίτσα",
      before: "{n} πράγματα πριν φύγεις", before1: "1 πράγμα πριν φύγεις",
      packed: "η βαλίτσα είναι έτοιμη", at: "{what} στις {time}", ref: "κράτηση {ref}"
    }
  };
  function s(lang, key, params) {
    var v = (STR[lang === "el" ? "el" : "en"])[key];
    if (params) Object.keys(params).forEach(function (k) { v = v.split("{" + k + "}").join(String(params[k])); });
    return v;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isYmd(v) {
    var m = typeof v === "string" && YMD_RE.exec(v);
    if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(ymd, n) {
    var m = YMD_RE.exec(ymd), d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    d.setDate(d.getDate() + n);
    return ymdOf(d);
  }
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : ""; }
  function hm(v) { return typeof v === "string" && HM_RE.test(v) ? v : ""; }

  // Live trips, read defensively. Trips are sorted by start, then id.
  function trips(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.trips)) return [];
    var tombs = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};
    var dead = function (id) { return Object.prototype.hasOwnProperty.call(tombs, id); };
    var out = [];
    raw.trips.forEach(function (x) {
      if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || dead(x.id)) return;
      var t = {
        id: x.id, name: str(x.name, 80), dest: str(x.dest, 100),
        start: isYmd(x.start) ? x.start : "", end: isYmd(x.end) ? x.end : "",
        pack: { left: 0, before: 0, n: 0 }, plan: []
      };
      (Array.isArray(x.pack) ? x.pack : []).forEach(function (p) {
        if (!p || typeof p !== "object" || typeof p.id !== "string" || dead(p.id)) return;
        t.pack.n++;
        if (p.done === true) return;
        if (p.grp === "@before") t.pack.before++; else t.pack.left++;
      });
      (Array.isArray(x.plan) ? x.plan : []).forEach(function (p) {
        if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID_RE.test(p.id) || dead(p.id)) return;
        t.plan.push({
          id: p.id, kind: KINDS.indexOf(p.kind) >= 0 ? p.kind : "other",
          title: str(p.title, 100), from: str(p.from, 60), to: str(p.to, 60), ref: str(p.ref, 60),
          day: isYmd(p.day) ? p.day : "", t1: hm(p.t1), day2: isYmd(p.day2) ? p.day2 : "", t2: hm(p.t2)
        });
      });
      t.plan.sort(function (a, b) {
        var ka = a.day + a.t1 + a.id, kb = b.day + b.t1 + b.id;
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
      out.push(t);
    });
    out.sort(function (a, b) {
      var ka = (a.start || "9999") + a.id, kb = (b.start || "9999") + b.id;
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    return out;
  }

  function label(trip) { return trip.name || trip.dest; }
  function kindName(kind, lang) { return s(lang, KINDS.indexOf(kind) >= 0 ? kind : "other"); }
  // Same wording as the app's itinerary: the title, else "Flight ATH → FCO", else the kind.
  function entryTitle(p, lang) {
    if (p.title) return p.title;
    if (MOVES[p.kind] && (p.from || p.to)) return kindName(p.kind, lang) + " " + (p.from || "…") + " → " + (p.to || "…");
    return kindName(p.kind, lang);
  }
  function datesKnown(t) {
    return t.start && t.end && t.end >= t.start &&
      Math.round((new Date(t.end + "T12:00:00") - new Date(t.start + "T12:00:00")) / DAY_MS) < MAX_DAYS;
  }

  // Calendar rows: one all-day row per trip day ({ n, of } = "day n of N"),
  // one timed row per itinerary entry that has a day and a time. The end
  // time is kept only when the entry ends the same day, after it starts.
  function feedRows(list) {
    var rows = [];
    list.forEach(function (t) {
      if (datesKnown(t) && label(t)) {
        var of = 0, d;
        for (d = t.start; d <= t.end; d = addDays(d, 1)) of++;
        var n = 0;
        for (d = t.start; d <= t.end; d = addDays(d, 1)) {
          n++;
          rows.push({ key: "t" + t.id + "-" + n, day: d, start: null, end: null, trip: t.id,
                      kind: "trip", name: label(t), n: n, of: of });
        }
      }
      t.plan.forEach(function (p) {
        if (!p.day || !p.t1) return;
        var end = p.t2 && (!p.day2 || p.day2 === p.day) && p.t2 > p.t1 ? p.t2 : null;
        rows.push({ key: "e" + p.id, day: p.day, start: p.t1, end: end, trip: t.id, kind: p.kind, entry: p });
      });
    });
    return rows;
  }

  function parseLocal(ymd, hhmm) {
    var m = YMD_RE.exec(ymd), h = HM_RE.exec(hhmm);
    return new Date(+m[1], +m[2] - 1, +m[3], +hhmm.slice(0, 2), +hhmm.slice(3, 5), 0, 0).getTime() + (h ? 0 : NaN);
  }

  // What to announce now. Keys are stable, so the caller announces each
  // once (device-local map) and the inbox dedup catches the rest.
  function due(list, nowMs, lang) {
    var now = new Date(nowMs), today = ymdOf(now), tomorrow = addDays(today, 1), out = [];
    list.forEach(function (t) {
      var name = label(t) || s(lang, "trip");
      if (t.start === tomorrow && now.getHours() >= EVE_HOUR) {
        var parts = [];
        if (t.pack.left) parts.push(t.pack.left === 1 ? s(lang, "pack1") : s(lang, "pack", { n: t.pack.left }));
        if (t.pack.before) parts.push(t.pack.before === 1 ? s(lang, "before1") : s(lang, "before", { n: t.pack.before }));
        if (!parts.length && t.pack.n) parts.push(s(lang, "packed"));
        out.push({ key: "eve-" + t.id + "-" + t.start, trip: t.id, tab: "pack",
                   title: s(lang, "tomorrow", { trip: name }), body: parts.join(", ") });
      }
      t.plan.forEach(function (p) {
        if (!LEAD_MIN[p.kind] || !p.day || !p.t1) return;
        if (p.day < today || p.day > tomorrow) return;            // only today's and tonight's departures
        var at = parseLocal(p.day, p.t1);
        if (!(nowMs < at && nowMs >= at - LEAD_MIN[p.kind] * 60000)) return;
        var body = s(lang, "at", { what: entryTitle(p, lang), time: p.t1 });
        if (p.ref) body += " · " + s(lang, "ref", { ref: p.ref });
        out.push({ key: "dep-" + p.id + "-" + p.day + "-" + p.t1.replace(":", ""), trip: t.id, tab: "plan",
                   title: name, body: body });
      });
    });
    return out;
  }

  function pruneFired(fired, nowMs) {
    var out = {};
    if (!fired || typeof fired !== "object") return out;
    Object.keys(fired).forEach(function (k) {
      var v = fired[k];
      if (typeof v === "number" && isFinite(v) && v > nowMs - FIRED_DAYS * DAY_MS && v <= nowMs + DAY_MS) out[k] = v;
    });
    return out;
  }

  var api = {
    ID_RE: ID_RE, KINDS: KINDS, EVE_HOUR: EVE_HOUR, LEAD_MIN: LEAD_MIN,
    isYmd: isYmd, ymdOf: ymdOf, addDays: addDays,
    trips: trips, label: label, kindName: kindName, entryTitle: entryTitle,
    feedRows: feedRows, due: due, pruneFired: pruneFired
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosTravelCore = api;
})(typeof window !== "undefined" ? window : this);
