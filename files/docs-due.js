// ============================================================
// orOS Files — docs-due.js (v1.0.0): Documents' dates, pure.
// ------------------------------------------------------------
// DOCS-1 wave 3. One reading of the Documents slice (oros-files-docs,
// files/docs-core.js) for everything that tells the person about a
// date: the shell reminder (shell.js docsCheckTick), the Today row
// (files/today.js), the Calendar feed (calendar.js docsFeedOn) and the
// Documents view itself. Small on purpose: the shell loads it at boot,
// docs-core.js only loads with the Documents place.
//
//   alerts(raw, today)   expiry dates 30 / 7 / 0 days ahead (and up to
//                        7 days late, so a closed orOS catches up) and
//                        keep-until dates that passed in the last 7 days.
//                        [{ key, id, kind "ex"|"kp", date, left, step }]
//   toNotify(all, done)  the alerts not announced yet at their step;
//                        done = device-local { key: lowest step told }.
//   alertLine(a, raw, lang)  one line for a notice or a Today row. A
//                        private document (medical, ID, linked to
//                        Health, Cycle or Baby) shows its type only,
//                        never its title (lock screens, Today shares).
//   feedRows(raw)        Calendar: one all-day row per expiry date and
//                        per keep-until date.
//   readPrefs(o)         device-local oros-files-docs-prefs:
//                        { remind: hour 0-23, -1 = off; default 9 }.
// Reads only; never writes the slice. Nothing here deletes a file:
// a passed keep-until date is a note, the person decides (W1).
// Exposes window.OrosDocsDue (browser) or module.exports (tests).
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-docs";
  var PREFS_KEY = "oros-files-docs-prefs";
  var NOTIFIED_KEY = "oros-files-docs-notified";
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY = 86400000;
  var STEPS = [30, 7, 0];
  var LATE = 7;                    // days a missed notice is still given
  var PRIVATE_TYPES = { "ty-medical": true, "ty-id": true };
  var PRIVATE_APPS = { health: true, cycle: true, baby: true };

  var S = {
    en: {
      exIn: "{t} expires in {n} days", ex1: "{t} expires tomorrow",
      ex0: "{t} expires today", exPast: "{t} expired {n} days ago", exPast1: "{t} expired yesterday",
      kp: "{t}: kept long enough (until {d})",
      feedEx: "{t} expires", feedKp: "{t}: keep until",
      doc: "A document", "ty-medical": "A medical document", "ty-id": "An ID or passport", pv: "A private document"
    },
    el: {
      exIn: "{t}: λήγει σε {n} μέρες", ex1: "{t}: λήγει αύριο",
      ex0: "{t}: λήγει σήμερα", exPast: "{t}: έληξε πριν από {n} μέρες", exPast1: "{t}: έληξε χθες",
      kp: "{t}: φυλάχτηκε αρκετά (έως {d})",
      feedEx: "{t}: λήξη", feedKp: "{t}: κράτα έως",
      doc: "Ένα έγγραφο", "ty-medical": "Ένα ιατρικό έγγραφο",
      "ty-id": "Μια ταυτότητα ή διαβατήριο", pv: "Ένα ιδιωτικό έγγραφο"
    },
    de: {
      exIn: "{t} läuft in {n} Tagen ab", ex1: "{t} läuft morgen ab",
      ex0: "{t} läuft heute ab", exPast: "{t} ist vor {n} Tagen abgelaufen", exPast1: "{t} ist gestern abgelaufen",
      kp: "{t}: lange genug aufbewahrt (bis {d})",
      feedEx: "{t} läuft ab", feedKp: "{t}: aufbewahren bis",
      doc: "Ein Dokument", "ty-medical": "Ein medizinisches Dokument", "ty-id": "Ein Ausweis oder Pass", pv: "Ein privates Dokument"
    }
  };

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function okDate(s) { return typeof s === "string" && DATE_RE.test(s); }
  function utc(s) { var m = DATE_RE.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function dayDiff(a, b) { return okDate(a) && okDate(b) ? Math.round((utc(b) - utc(a)) / DAY) : null; }
  function fill(s, o) { return s.replace(/\{(\w+)\}/g, function (all, k) { return o[k] != null ? String(o[k]) : all; }); }
  function table(lang) { return S[lang] || S.en; }

  // The live documents of a raw slice: tombstones hide (a tomb at or
  // after the row's m), the same rule as docs-core merge.
  function docs(raw) {
    if (!isObj(raw) || !Array.isArray(raw.docs)) return [];
    var tombs = isObj(raw.tombs) ? raw.tombs : {};
    return raw.docs.filter(function (d) {
      if (!isObj(d) || typeof d.id !== "string" || d.id.indexOf("d-") !== 0) return false;
      var tomb = Number(tombs[d.id]);
      return !(isFinite(tomb) && tomb >= Number(d.m));
    });
  }
  function find(raw, id) {
    var all = docs(raw);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function ownType(raw, id) {
    var list = isObj(raw) && Array.isArray(raw.types) ? raw.types : [];
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return list[i];
    return null;
  }
  function isPrivate(raw, d) {
    var own = ownType(raw, d.ty);
    if (own ? !!own.pv : PRIVATE_TYPES[d.ty]) return true;
    return (Array.isArray(d.ln) ? d.ln : []).some(function (l) { return isObj(l) && PRIVATE_APPS[l.a]; });
  }
  // What a line calls the document: its title, or for a private one
  // its type only.
  function nameOf(raw, d, lang) {
    var T = table(lang);
    if (isPrivate(raw, d)) return PRIVATE_TYPES[d.ty] && !ownType(raw, d.ty) ? T[d.ty] : T.pv;
    var t = typeof d.t === "string" ? d.t.trim() : "";
    if (t) return t.length > 80 ? t.slice(0, 79) + "…" : t;
    var p = typeof d.p === "string" ? d.p : "";
    return p.slice(p.lastIndexOf("/") + 1) || T.doc;
  }

  function stepFor(left) {
    for (var i = STEPS.length - 1; i >= 0; i--) if (left <= STEPS[i]) return STEPS[i];
    return null;
  }

  function alerts(raw, today) {
    if (!okDate(today)) return [];
    var out = [];
    docs(raw).forEach(function (d) {
      if (okDate(d.ex)) {
        var left = dayDiff(today, d.ex);
        if (left <= STEPS[0] && left >= -LATE) {
          out.push({ key: "ex:" + d.id + ":" + d.ex, id: d.id, kind: "ex", date: d.ex, left: left, step: stepFor(left) });
        }
      }
      if (okDate(d.kp)) {
        var past = dayDiff(d.kp, today);
        if (past > 0 && past <= LATE) {
          out.push({ key: "kp:" + d.id + ":" + d.kp, id: d.id, kind: "kp", date: d.kp, left: -past, step: 0 });
        }
      }
    });
    return out.sort(function (a, b) { return a.left - b.left || (a.key < b.key ? -1 : 1); });
  }

  function toNotify(all, done) {
    done = isObj(done) ? done : {};
    return (all || []).filter(function (a) {
      var had = Object.prototype.hasOwnProperty.call(done, a.key) ? Number(done[a.key]) : null;
      return had === null || !isFinite(had) || a.step < had;
    });
  }
  // The notified map for the next tick: only keys that still exist.
  function nextNotified(all, fresh, done) {
    done = isObj(done) ? done : {};
    var next = {};
    (all || []).forEach(function (a) { if (Object.prototype.hasOwnProperty.call(done, a.key)) next[a.key] = done[a.key]; });
    (fresh || []).forEach(function (a) { next[a.key] = a.step; });
    return next;
  }

  function alertLine(a, raw, lang) {
    var T = table(lang), d = find(raw, a.id);
    var t = d ? nameOf(raw, d, lang) : T.doc;
    if (a.kind === "kp") return fill(T.kp, { t: t, d: a.date });
    if (a.left > 1) return fill(T.exIn, { t: t, n: a.left });
    if (a.left === 1) return fill(T.ex1, { t: t });
    if (a.left === 0) return fill(T.ex0, { t: t });
    if (a.left === -1) return fill(T.exPast1, { t: t });
    return fill(T.exPast, { t: t, n: -a.left });
  }

  function feedRows(raw, lang) {
    var T = table(lang), out = [];
    docs(raw).forEach(function (d) {
      var t = nameOf(raw, d, lang);
      if (okDate(d.ex)) out.push({ day: d.ex, id: d.id, key: "ex" + d.id, title: fill(T.feedEx, { t: t }) });
      if (okDate(d.kp)) out.push({ day: d.kp, id: d.id, key: "kp" + d.id, title: fill(T.feedKp, { t: t }) });
    });
    return out;
  }

  function readPrefs(o) {
    var r = isObj(o) ? Number(o.remind) : 9;
    if (!isFinite(r) || Math.floor(r) !== r || r < -1 || r > 23) r = 9;
    return { remind: r };
  }

  var API = {
    VERSION: "1.0.0",
    KEY: KEY, PREFS_KEY: PREFS_KEY, NOTIFIED_KEY: NOTIFIED_KEY, STEPS: STEPS.slice(),
    docs: docs, isPrivate: isPrivate, nameOf: nameOf,
    alerts: alerts, toNotify: toNotify, nextNotified: nextNotified, alertLine: alertLine,
    feedRows: feedRows, readPrefs: readPrefs, dayDiff: dayDiff
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosDocsDue = API;
})(typeof window !== "undefined" ? window : globalThis);
