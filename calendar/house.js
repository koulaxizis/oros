// ============================================================
// orOS Calendar — calendars shared with a household (pure; BR-HH)
// A shared calendar is a household document of kind "cal"
// (household/engine.js). calendar.js shows it as a label with the id
// "hh-<document id>" and its events as ordinary events of that label,
// in memory only: they never go into "oros-calendar-data" nor into the
// person's own cloud copy. Every edit leaves as the fields that changed.
// Personal parts stay out of the household: reminders (each person
// picks their own, kept per device in REM_KEY) and the label's own
// bookkeeping.
//   project(label, events) → { m: { t, c }, items: { id: fields } }
//   build(view, docId, rem) → { label, events } (rem: { event id: minutes })
//   loose(events, labels) → own events with no label of theirs
//   copyOf(view, docId, now) → { label, events }: an own calendar
//                          "lbc-<document id>" with the same event ids
//   collect(H, rem, labels) → every shared event this device can see
//                          (labels, when given, gets the calendars too)
//   mirror(H)            → writes MIRROR_KEY (device-local, plain JSON
//                          { ver: 1, labels, events }) when it changed; readers
//                          that only see localStorage use it
// Fields of an event: date, dateEnd, start, end, title, note, location,
// recur, tz. Absent values are null, so an event built from a document
// projects back to exactly that document (no endless uploads).
// Exposes window.OrosCalHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var PREFIX = "hh-", COPY = "lbc-";
  var REM_KEY = "oros-calendar-hhrem", MIRROR_KEY = "oros-calendar-hh";
  var FIELDS = ["date", "dateEnd", "start", "end", "title", "note", "location", "recur", "tz"];
  var YMD = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{2}:\d{2}$/, COLOR = /^#[0-9a-f]{6}$/;
  var ID_RE = /^[A-Za-z0-9_:-]{1,72}$/;
  var REMIND = [5, 15, 30, 60, 1440, 4320, 7200];
  // calendar.js VALID_COLORS: a label of another colour would not load
  var COLORS = ["#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a", "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6", "#c8a96e"];

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function occ() { return root && root.OrosCalOccur ? root.OrosCalOccur : null; }
  function cleanRecur(r, date) {
    if (!r || typeof r !== "object") return null;
    var O = occ();
    if (O && typeof O.normRecur === "function") return O.normRecur(r, date) || null;
    return JSON.parse(JSON.stringify(r));
  }
  function fieldsOf(e) {
    var date = typeof e.date === "string" && YMD.test(e.date) ? e.date : null;
    var start = typeof e.start === "string" && HM.test(e.start) ? e.start : null;
    var dateEnd = typeof e.dateEnd === "string" && YMD.test(e.dateEnd) && date && e.dateEnd >= date ? e.dateEnd : null;
    var end = typeof e.end === "string" && HM.test(e.end) ? e.end : null;
    if (start && end && end < start && !(dateEnd && dateEnd > date)) end = null;
    return {
      date: date, dateEnd: dateEnd, start: start, end: end,
      title: str(e.title, 80), note: str(e.note, 500) || null, location: str(e.location, 150) || null,
      recur: date ? cleanRecur(e.recur, date) : null,
      tz: start && typeof e.tz === "string" && /^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(e.tz) ? e.tz : null
    };
  }

  function project(label, events) {
    var items = {};
    (events || []).forEach(function (e) {
      if (!e || typeof e.id !== "string" || !ID_RE.test(e.id)) return;
      var f = fieldsOf(e);
      if (f.date) items[e.id] = f;
    });
    return { m: { t: str(label && label.name, 40), c: label && COLOR.test(label.color) ? label.color : null }, items: items };
  }

  function eventOf(v, labelId, rem) {
    var f = fieldsOf(v);
    if (!f.date) return null;
    var e = { id: v.id, date: f.date, dateEnd: f.dateEnd, start: f.start, end: f.end, title: f.title,
              note: f.note || "", location: f.location || "", labelId: labelId, recur: f.recur,
              remindMin: rem && REMIND.indexOf(rem[v.id]) >= 0 ? rem[v.id] : null, mtime: v._t || 0 };
    if (f.tz) e.tz = f.tz;
    return e;
  }
  function labelOf(view, id) {
    var m = view.m || {};
    return { id: id, name: str(m.t, 40) || "?", color: COLORS.indexOf(m.c) >= 0 ? m.c : "#7aa2f7", mtime: 0 };
  }
  function build(view, docId, rem) {
    var lid = PREFIX + docId, events = [];
    (view.items || []).forEach(function (v) {
      var e = eventOf(v, lid, rem);
      if (!e) return;
      e.hhBy = typeof v._by === "string" ? v._by : "";
      events.push(e);
    });
    return { label: labelOf(view, lid), events: events };
  }
  function copyOf(view, docId, now) {
    var lid = COPY + docId, events = [];
    (view.items || []).forEach(function (v) {
      var e = eventOf(v, lid, null);
      if (!e) return;
      e.mtime = now;
      events.push(e);
    });
    var label = labelOf(view, lid);
    label.mtime = now;
    return { label: label, events: events };
  }
  function isShared(id) { return typeof id === "string" && id.indexOf(PREFIX) === 0; }
  function docOf(id) { return isShared(id) ? id.slice(PREFIX.length) : ""; }
  // The person's own events with no label, or with a label that is not
  // among theirs (the "No label" chip): what "share the events with no
  // label" takes. Shared events never count.
  function loose(events, labels) {
    var own = {};
    (labels || []).forEach(function (l) { if (l && l.id) own[l.id] = 1; });
    return (events || []).filter(function (e) { return e && !isShared(e.labelId) && !own[e.labelId]; });
  }

  function readRem(ls) {
    try {
      var r = JSON.parse((ls || root.localStorage).getItem(REM_KEY) || "null");
      return r && typeof r === "object" ? r : {};
    } catch (e) { return {}; }
  }
  function collect(H, rem, labels) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("cal").forEach(function (d) {
      if (!d.ready) return;
      var v = H.view(d.box, d.id, ["o"]);
      if (!v) return;
      var b = build(v, d.id, rem);
      out = out.concat(b.events);
      if (labels) labels.push(b.label);
    });
    return out;
  }
  var lastMirror = null;
  function mirror(H, ls) {
    ls = ls || root.localStorage;
    var labels = [];
    var evs = collect(H, readRem(ls), labels).map(function (e) { var c = JSON.parse(JSON.stringify(e)); delete c.hhBy; return c; });
    evs.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    labels.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    var text = labels.length ? JSON.stringify({ ver: 1, labels: labels, events: evs }) : "";
    if (text === lastMirror) return false;
    lastMirror = text;
    try { if (text) ls.setItem(MIRROR_KEY, text); else ls.removeItem(MIRROR_KEY); } catch (e) {}
    return true;
  }
  // The shell keeps the mirror fresh while it runs (Today, reminders).
  function bootShell() {
    var H = root.orosHousehold;
    if (!H || typeof H.on !== "function") return;
    var queued = false;
    function later() {
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; mirror(H); }, 50);
    }
    H.on(function (e) { if (e && (e.type === "doc" || e.type === "list" || e.type === "roster")) later(); });
    root.addEventListener("storage", function (e) { if (e.key === REM_KEY) later(); });
    Promise.resolve(H.ready()).then(later, function () {});
  }

  var api = { PREFIX: PREFIX, COPY: COPY, REM_KEY: REM_KEY, MIRROR_KEY: MIRROR_KEY, FIELDS: FIELDS, ID_RE: ID_RE,
              project: project, build: build, copyOf: copyOf, isShared: isShared, docOf: docOf, loose: loose,
              readRem: readRem, collect: collect, mirror: mirror, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosCalHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
