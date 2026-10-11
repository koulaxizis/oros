// ============================================================
// orOS Contacts — dates of the year (v1.0.0)
// Birthdays, anniversaries and custom dates of "oros-contacts-data",
// one copy for the Calendar's Contacts feed (calendar.js
// contactsFeedOn) and the Today summary (contacts/today.js). Pure:
// no DOM, no storage, never writes.
//   eventsOn(contacts, ymd) → [{ contact, ev, ix, years }] every date
//     of a contact that falls on that day. A 29 February date shows
//     on 28 February in years without one. years = how many years it
//     has been (when the date has a year and it is not in the future),
//     else null.
//   displayName(c) → given+middle+family → nickname → org → "?"
//     (the composition contacts.js shows)
// Contacts in the shared tombstone list are skipped.
// Exposes window.OrosContactDates and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function displayName(c) {
    var parts = [c.given, c.middle, c.family].filter(function (x) { return typeof x === "string" && x; });
    if (parts.length) return parts.join(" ");
    if (c.nickname) return c.nickname;
    if (c.org) return c.org;
    return "?";
  }

  function eventsOn(contacts, ymd, deleted) {
    var out = [];
    var m = YMD_RE.exec(ymd || "");
    if (!m || !Array.isArray(contacts)) return out;
    var y = +m[1], mmdd = m[2] + "-" + m[3];
    var feb28 = mmdd === "02-28" && !isLeap(y);
    var gone = {};
    (Array.isArray(deleted) ? deleted : []).forEach(function (t) { if (t && typeof t.id === "string") gone[t.id] = true; });
    contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || gone[c.id]) return;
      (Array.isArray(c.events) ? c.events : []).forEach(function (ev, ix) {
        if (!ev || typeof ev !== "object" || typeof ev.day !== "string") return;
        if (ev.day !== mmdd && !(feb28 && ev.day === "02-29")) return;
        var years = (typeof ev.year === "number" && ev.year > 0 && ev.year <= y) ? y - ev.year : null;
        out.push({ contact: c, ev: ev, ix: ix, years: years });
      });
    });
    return out;
  }

  var api = { eventsOn: eventsOn, displayName: displayName, isLeap: isLeap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosContactDates = api;
})(typeof window !== "undefined" ? window : globalThis);
