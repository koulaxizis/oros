// ============================================================
// orOS Contacts — "keep in touch" (contacts/keep.js,
// window.OrosContactsKeep)
// ============================================================
// Pure helpers, no DOM, no storage (loaded by the app, by the shell
// for the reminder engine, and by the node tests).
//
//   lastContact(c, today)  → "YYYY-MM-DD" | ""   the later of c.seen
//                            ("Contacted today") and the newest
//                            interaction dated today or earlier
//   status(c, today)       → null (no cadence) | { last, due, days,
//                            overdue } — days = today − due (≥ 0 when
//                            overdue)
//   reachOut(blob, today)  → overdue live contacts, most overdue
//                            first: [{ id, name, last, due, days }]
//   prefs(raw)             → { on, hour } (device-local, default off,
//                            10:00)
//   reminder(blob, prefs, now) → null | { key, ids, names, count }
//                            once the hour has come on a day with
//                            someone due; one per day, the key is
//                            the same on every device (inbox dedup)
//   reminderText(r, lang)  → { title, body }
//
// Cadence c.keep = { n: 1–99, u: "w" | "m" }. A contact with a
// cadence and no contact on record counts from the day the cadence
// was set (fm.keep), so setting it for many people at once does not
// flood the list.
// ============================================================
(function (root) {
  "use strict";

  var PREFS_KEY = "oros-contacts-keep";   // device-local, never synced

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function parse(ymd) { return [+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10)]; }
  function utc(ymd) { var p = parse(ymd); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function fromUtc(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function okYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }

  // ymd + cadence; months clamp to the month's last day (Jan 31 + 1
  // month = Feb 28/29).
  function addKeep(ymd, keep) {
    if (keep.u === "w") return fromUtc(utc(ymd) + keep.n * 7 * 86400000);
    var p = parse(ymd), m = p[1] - 1 + keep.n;
    var y = p[0] + Math.floor(m / 12);
    m = m % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + "-" + pad(m + 1) + "-" + pad(Math.min(p[2], last));
  }

  function validKeep(k) {
    return !!(k && typeof k === "object" && (k.u === "w" || k.u === "m") &&
      typeof k.n === "number" && k.n >= 1 && k.n <= 99);
  }

  function lastContact(c, today) {
    var best = okYmd(c && c.seen) && (!today || c.seen <= today) ? c.seen : "";
    (Array.isArray(c && c.log) ? c.log : []).forEach(function (it) {
      if (it && okYmd(it.d) && (!today || it.d <= today) && it.d > best) best = it.d;
    });
    return best;
  }

  function status(c, today) {
    if (!c || !validKeep(c.keep)) return null;
    var last = lastContact(c, today);
    var from = last;
    if (!from) {
      var st = c.fm && typeof c.fm.keep === "number" && c.fm.keep > 0 ? ymdOf(c.fm.keep) : "";
      from = st && st <= today ? st : today;
    }
    var due = addKeep(from, c.keep);
    var days = daysBetween(due, today);
    return { last: last, due: due, days: days, overdue: days >= 0 };
  }

  function displayName(c) {
    var n = [c.given, c.family].filter(function (x) { return typeof x === "string" && x.trim(); }).join(" ").trim();
    return n || (c.nickname || "").trim() || (c.org || "").trim() || "?";
  }

  function alive(blob) {
    var dead = {};
    (Array.isArray(blob && blob.deleted) ? blob.deleted : []).forEach(function (d) {
      if (d && typeof d.id === "string" && (!dead[d.id] || d.mtime > dead[d.id])) dead[d.id] = d.mtime || 0;
    });
    return (Array.isArray(blob && blob.contacts) ? blob.contacts : []).filter(function (c) {
      return c && typeof c.id === "string" && !(c.id in dead && !((c.mtime || 0) > dead[c.id]));
    });
  }

  function reachOut(blob, today) {
    var out = [];
    alive(blob).forEach(function (c) {
      var s = status(c, today);
      if (s && s.overdue) out.push({ id: c.id, name: displayName(c), last: s.last, due: s.due, days: s.days });
    });
    out.sort(function (a, b) {
      return a.due !== b.due ? (a.due < b.due ? -1 : 1) : (a.name < b.name ? -1 : (a.name > b.name ? 1 : (a.id < b.id ? -1 : 1)));
    });
    return out;
  }

  function prefs(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var h = Math.round(+o.hour);
    return { on: o.on === true, hour: isFinite(h) && h >= 0 && h <= 23 ? h : 10 };
  }

  function reminder(blob, pr, now) {
    var p = prefs(pr);
    if (!p.on) return null;
    var d = new Date(now);
    if (d.getHours() < p.hour) return null;
    var today = ymdOf(now);
    var list = reachOut(blob, today);
    if (!list.length) return null;
    var ids = list.map(function (x) { return x.id; });
    return {
      key: "keep-" + today,
      today: today,
      ids: ids,
      names: list.map(function (x) { return x.name; }),
      count: list.length
    };
  }

  var REM = {
    en: { "keep.rem.title": "Time to reach out", "keep.rem.body": "Get back in touch with: {names}",
          "keep.rem.more": "{names} and {n} more" },
    el: { "keep.rem.title": "Ώρα να τα πείτε", "keep.rem.body": "Μιλήστε ξανά με: {names}",
          "keep.rem.more": "{names} και {n} ακόμα" }
  };
  function reminderText(r, lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && !REM[lang]) I.table(REM, "contacts", lang);
    var w = REM[lang] || REM.en;
    var shown = r.names.slice(0, 3).join(", ");
    var more = String(r.count - 3);
    if (r.count > 3) shown = w["keep.rem.more"].replace("{n}", more).replace("{names}", function () { return shown; });
    return {
      title: w["keep.rem.title"],
      body: w["keep.rem.body"].replace("{names}", function () { return shown; })
    };
  }

  var api = {
    PREFS_KEY: PREFS_KEY, addKeep: addKeep, lastContact: lastContact, status: status,
    reachOut: reachOut, prefs: prefs, reminder: reminder, reminderText: reminderText,
    daysBetween: daysBetween, ymdOf: ymdOf, validKeep: validKeep
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsKeep = api;
})(typeof self !== "undefined" ? self : this);
