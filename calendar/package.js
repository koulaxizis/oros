// ============================================================
// orOS Calendar — .oroscal file (calendar/package.js,
// window.OrosCalPackage). The descriptor of the Calendar for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every event and label in one orOS bundle; opening one ADDS
// what this device lacks, with its ids. Pure (no DOM, no storage), so
// the app and `node --test` run the same code. Needs occur.js and
// ics.js first (window.OrosCalOccur / OrosIcs, or require in Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; calendar.js then runs the
//                            result through its own sanitizers + save
//                            + sync)
//   DESC.norm(data)          a file's data → { ver, labels, events }
//                            with known fields only, typed and capped
//                            (the rules of calendar.js sanitizeEvent /
//                            sanitizeLabel)
//   DESC.strip(state)        the slice → { ver, labels, events }: no
//                            tombstones (deleted) and no subscriptions
//                            (subs: their addresses can carry private
//                            keys, e.g. a "secret address" .ics link)
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state, l)  calendar.ics (ics.js build, the same text
//                            as the Calendar's Export)
//   kindOf(id, state)        "event" | "label" | ""
// ============================================================
(function (root) {
  "use strict";

  var OCC = (root && root.OrosCalOccur) ||
    (typeof module === "object" && typeof require === "function" ? require("./occur.js") : null);
  var ICS = (root && root.OrosIcs) ||
    (typeof module === "object" && typeof require === "function" ? require("./ics.js") : null);

  var LIM = { events: 50000, labels: 500, id: 200, title: 80, note: 500, location: 150, label: 40 };
  // The same lists as calendar.js (REMIND_PRESETS, VALID_COLORS =
  // LABEL_PALETTE + the Contacts brown).
  var REMIND_PRESETS = [5, 15, 30, 60, 1440, 4320, 7200];
  var VALID_COLORS = ["#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
                      "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6", "#c8a96e"];
  // Untouched seed labels (mtime 0) are stored with one English name
  // (calendar.js SEED_NAMES); the preview names them in its language.
  var SEED_NAMES = {
    "lbl-personal": ["Personal", "lbl.personal"],
    "lbl-work": ["Work", "lbl.work"],
    "lbl-family": ["Family", "lbl.family"]
  };
  // The preview's texts (the same keys and English as calendar.js STR).
  var STR = {
    en: { "lbl.personal": "Personal", "lbl.work": "Work", "lbl.family": "Family", "ev.untitled": "(untitled)" },
    el: { "lbl.personal": "Προσωπικό", "lbl.work": "Εργασία", "lbl.family": "Οικογένεια", "ev.untitled": "(χωρίς τίτλο)" }
  };
  function str(lang, k) {
    var I = typeof window !== "undefined" && window.orosI18n;
    var tbl = STR[lang] || (I ? I.table(STR, "calendar", lang) : null) || STR.en;
    return tbl[k] !== undefined ? tbl[k] : STR.en[k];
  }
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var HM = /^([01]\d|2[0-3]):[0-5]\d$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  // Text without control characters; `multi` keeps line breaks.
  function text(v, max, multi) {
    if (typeof v !== "string") return "";
    var s = multi ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
                  : v.replace(/[\u0000-\u001f\u007f]/g, " ");
    return s.slice(0, max);
  }
  function okId(v) {
    return typeof v === "string" && v.length > 0 && v.length <= LIM.id &&
      v !== "__proto__" && !/[\u0000-\u001f\u007f]/.test(v);
  }
  function validTzName(tz) {
    return typeof tz === "string" && /^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(tz);
  }
  function okYmd(s) {
    if (typeof s !== "string" || !YMD.test(s)) return false;
    var m = +s.slice(5, 7), d = +s.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }

  function normEvent(e) {
    if (!isObj(e) || !okId(e.id) || !okYmd(e.date)) return null;
    var start = typeof e.start === "string" && HM.test(e.start) ? e.start : null;
    var end = typeof e.end === "string" && HM.test(e.end) ? e.end : null;
    var dateEnd = okYmd(e.dateEnd) && e.dateEnd >= e.date ? e.dateEnd : null;
    if (start && end && end < start && !(dateEnd && dateEnd > e.date)) end = null;
    var out = {
      id: e.id,
      date: e.date,
      dateEnd: dateEnd,
      start: start,
      end: end,
      title: text(e.title, LIM.title),
      note: text(e.note, LIM.note, true),
      location: text(e.location, LIM.location),
      labelId: okId(e.labelId) ? e.labelId : null,
      recur: OCC ? OCC.normRecur(e.recur, e.date) : null,
      remindMin: typeof e.remindMin === "number" && REMIND_PRESETS.indexOf(e.remindMin) !== -1 ? e.remindMin : null,
      mtime: num(e.mtime)
    };
    if (start && validTzName(e.tz)) out.tz = e.tz;     // last key, only when set (as calendar.js)
    return out;
  }
  function normLabel(l) {
    if (!isObj(l) || !okId(l.id) || VALID_COLORS.indexOf(l.color) === -1) return null;
    var out = { id: l.id, name: text(l.name, LIM.label), color: l.color, mtime: num(l.mtime) };
    if (out.mtime === 0 && SEED_NAMES[out.id]) out.name = SEED_NAMES[out.id][0];
    return out;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 1, labels: [], events: [] };
    if (Array.isArray(data.deleted)) out.deleted = data.deleted;   // strip and tombIds see it, then it goes
    var seen = {};
    (Array.isArray(data.labels) ? data.labels : []).slice(0, LIM.labels).forEach(function (l) {
      var c = normLabel(l);
      if (c && !seen["l" + c.id]) { seen["l" + c.id] = 1; out.labels.push(c); }
    });
    (Array.isArray(data.events) ? data.events : []).slice(0, LIM.events).forEach(function (e) {
      var c = normEvent(e);
      if (c && !seen["e" + c.id]) { seen["e" + c.id] = 1; out.events.push(c); }
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({ ver: 1, labels: Array.isArray(s.labels) ? s.labels : [],
                                       events: Array.isArray(s.events) ? s.events : [] }));
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && Array.isArray(state.deleted)) state.deleted.forEach(function (d) {
      if (isObj(d) && typeof d.id === "string") out.push(d.id);
    });
    return out;
  }

  function labelName(l, lang) {
    if (l && l.mtime === 0 && SEED_NAMES[l.id]) return str(lang, SEED_NAMES[l.id][1]);
    return l ? String(l.name || "") : "";
  }
  function previews(state, lang) {
    if (!ICS || typeof ICS.build !== "function") return {};
    var byId = {};
    (state.labels || []).forEach(function (l) { byId[l.id] = l; });
    return {
      "calendar.ics": ICS.build(state.events || [], {
        untitled: str(lang, "ev.untitled"),
        label: function (id) { return byId[id] ? labelName(byId[id], lang) : null; }
      }) + "\r\n"
    };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    if ((s.events || []).some(function (e) { return e && e.id === id; })) return "event";
    if ((s.labels || []).some(function (l) { return l && l.id === id; })) return "label";
    return "";
  }

  var DESC = {
    app: "calendar", title: "Calendar", slice: "calendar", ext: ".oroscal", mime: "application/x-oros-cal",
    colls: {
      labels: { shape: "array", id: "id", stamp: "mtime" },
      events: { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM, normEvent: normEvent, normLabel: normLabel };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCalPackage = api;
})(typeof window !== "undefined" ? window : this);
