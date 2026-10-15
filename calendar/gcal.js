// orOS Calendar — one-time import from Google Calendar (calendar/gcal.js).
//
// The sign-in, the token and its revoke are /google-import.js's
// (window.OrosGoogleImport); this file reads and maps. Google's events
// are written out as iCalendar text and go through calendar/ics.js,
// the same parser as an .ics file: the same mapping (all-day, time
// zones, RRULE → the Calendar's repeat, EXDATE, moved occurrences,
// reminders) and the same ids, "ics-" + a hash of the event's iCalUID,
// so an event that came in from a Google .ics export earlier, or from
// an earlier Google import, is found again instead of doubled.
//
// What is read (GET only, scope calendar.readonly):
//   calendarList → the person's calendars (free/busy-only ones left out)
//   events?singleEvents=false per calendar → each series once, with
//   its RRULE; a moved or edited occurrence comes as its own event
//   (RECURRENCE-ID), a cancelled one as an EXDATE on its series.
// Pure (also used by tests/google-import.test.js):
//   calItem(c) → { id, name, color, on, remind }
//   toIcs(cal, events) → iCalendar text
//   build(list [{ cal, events }], ics) → [{ id, name, color, on, events, found, skipped, simplified, more }]
// Browser: read(api, progress) → [{ cal, events }] (api from OrosGoogleImport.run)
(function (root) {
  "use strict";

  var API = "https://www.googleapis.com/calendar/v3/";
  var MAX_EVENTS = 5000;                 // read in all, over every calendar
  var MAX_CALS = 50;
  var PAGE = 2500;

  function str(v, n) { return (typeof v === "string" ? v : "").slice(0, n); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---- one calendar of the list ----
  function calItem(c) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id || c.id.length > 300) return null;
    if (c.accessRole === "freeBusyReader" || c.deleted === true) return null;
    var name = str(c.summaryOverride || c.summary, 40).replace(/\s+/g, " ").trim() || str(c.id, 40);
    var remind = [];
    (Array.isArray(c.defaultReminders) ? c.defaultReminders : []).forEach(function (r) {
      if (r && r.method === "popup" && typeof r.minutes === "number") remind.push(r.minutes);
    });
    return {
      id: c.id, name: name,
      color: typeof c.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor) ? c.backgroundColor.toLowerCase() : "",
      // the person's own calendars ticked; holidays, birthdays and other
      // people's calendars offered unticked
      on: c.primary === true || c.accessRole === "owner" || c.accessRole === "writer",
      remind: remind
    };
  }

  // ---- iCalendar writing ----
  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  }
  // Google keeps a little HTML in descriptions (<br>, <a>, <b>…): text only.
  function plain(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function validTz(tz) {
    if (typeof tz !== "string" || !/^[A-Za-z][A-Za-z0-9_+\/-]{1,60}$/.test(tz)) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  // The wall-clock time of instant ms in zone tz, as 20261020T100000.
  function wallIn(ms, tz) {
    var p = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + p.month + p.day + "T" + p.hour + p.minute + p.second;
  }
  function utc(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  // Google's { date } / { dateTime, timeZone } → "NAME;PARAMS:VALUE";
  // calTz: the calendar's zone, for a time without its own.
  function dtLine(name, t, calTz) {
    if (!t || typeof t !== "object") return "";
    if (typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) return name + ";VALUE=DATE:" + t.date.replace(/-/g, "");
    if (typeof t.dateTime !== "string") return "";
    var ms = Date.parse(t.dateTime);
    if (!isFinite(ms)) return "";
    var tz = validTz(t.timeZone) ? t.timeZone : (validTz(calTz) ? calTz : "");
    if (tz && !/^(UTC|Etc\/UTC|GMT)$/i.test(tz)) return name + ";TZID=" + tz + ":" + wallIn(ms, tz);
    return name + ":" + utc(ms);
  }
  // Only the repeat lines ics.js reads, one line each.
  function recurLines(rec) {
    return (Array.isArray(rec) ? rec : []).filter(function (l) {
      return typeof l === "string" && l.length < 2000 && /^(RRULE|EXDATE|RDATE)[;:]/i.test(l) && !/[\r\n]/.test(l);
    });
  }
  function alarm(min) {
    return ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT" + Math.max(0, Math.floor(min)) + "M", "END:VALARM"];
  }
  function uidOf(e) {
    return str(e.iCalUID, 500) || (str(e.id, 300) ? e.id + "@google.com" : "");
  }

  function toIcs(cal, events) {
    cal = cal || {};
    var calTz = cal.timeZone || "";
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Calendar Google import//EN"];
    var list = Array.isArray(events) ? events : [];
    // a cancelled occurrence → EXDATE on its series
    var exBy = {};
    list.forEach(function (e) {
      if (e && e.status === "cancelled" && typeof e.recurringEventId === "string" && e.originalStartTime) {
        var x = dtLine("EXDATE", e.originalStartTime, calTz);
        if (x) (exBy[e.recurringEventId] = exBy[e.recurringEventId] || []).push(x);
      }
    });
    var uidById = {};
    list.forEach(function (e) { if (e && typeof e.id === "string") uidById[e.id] = uidOf(e); });
    list.forEach(function (e) {
      if (!e || typeof e !== "object" || e.status === "cancelled") return;
      var start = dtLine("DTSTART", e.start, calTz);
      var uid = uidOf(e);
      if (!start || !uid) return;
      L.push("BEGIN:VEVENT");
      // a moved occurrence names its series by the series' UID
      if (typeof e.recurringEventId === "string" && e.originalStartTime) {
        var rid = dtLine("RECURRENCE-ID", e.originalStartTime, calTz);
        L.push("UID:" + esc(uidById[e.recurringEventId] || uid));
        if (rid) L.push(rid);
      } else {
        L.push("UID:" + esc(uid));
      }
      L.push(start);
      var end = dtLine("DTEND", e.end, calTz);
      if (end) L.push(end);
      L.push("SUMMARY:" + esc(str(e.summary, 300)));
      var note = plain(str(e.description, 8000));
      if (note) L.push("DESCRIPTION:" + esc(note.slice(0, 1000)));
      if (e.location) L.push("LOCATION:" + esc(str(e.location, 300)));
      if (!e.recurringEventId) {
        recurLines(e.recurrence).forEach(function (l) { L.push(l); });
        (exBy[e.id] || []).forEach(function (l) { L.push(l); });
      }
      var r = e.reminders, mins = [];
      if (r && r.useDefault === false) {
        (Array.isArray(r.overrides) ? r.overrides : []).forEach(function (o) {
          if (o && o.method === "popup" && typeof o.minutes === "number") mins.push(o.minutes);
        });
      } else if (r && r.useDefault === true) {
        mins = (cal.remind || []).slice();
      }
      // ics.js keeps the first alarm that matches a Calendar preset
      mins.sort(function (a, b) { return a - b; }).forEach(function (m) { L = L.concat(alarm(m)); });
      L.push("END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n");
  }

  // list: [{ cal: calItem + timeZone, events: [Google events] }]
  // ics: OrosIcs (calendar/ics.js)
  function build(list, ics) {
    return (Array.isArray(list) ? list : []).map(function (x) {
      var res = ics.parse(toIcs(x.cal, x.events));
      return {
        id: x.cal.id, name: x.cal.name, color: x.cal.color || "", on: !!x.cal.on,
        events: res.events, found: res.found, skipped: res.skipped, simplified: res.simplified, more: !!x.more || res.more
      };
    });
  }

  // ---- reading (browser) ----
  function read(api, progress) {
    var cals = [], n = 0;
    return api.pages(function (cur) {
      return API + "users/me/calendarList?maxResults=250" + (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
    }, function (d) {
      (d && Array.isArray(d.items) ? d.items : []).forEach(function (c) {
        var it = calItem(c);
        if (it && cals.length < MAX_CALS) { it.timeZone = validTz(c.timeZone) ? c.timeZone : ""; cals.push(it); }
      });
      return api.nextToken(d);
    }, 10).then(function () {
      var out = [];
      return cals.reduce(function (p, cal) {
        return p.then(function () {
          var evs = [], more = false;
          out.push({ cal: cal, events: evs });
          if (n >= MAX_EVENTS) { out[out.length - 1].more = true; return; }
          return api.pages(function (cur) {
            return API + "calendars/" + encodeURIComponent(cal.id) + "/events?singleEvents=false&showDeleted=false&maxResults=" + PAGE +
              (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
          }, function (d) {
            (d && Array.isArray(d.items) ? d.items : []).forEach(function (e) {
              if (n < MAX_EVENTS) { evs.push(e); n++; } else more = true;
            });
            if (progress) progress(n);
            return more ? "" : api.nextToken(d);
          }, 40).then(function () { if (more) out[out.length - 1].more = true; });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  var api = { calItem: calItem, toIcs: toIcs, build: build, read: read, plain: plain, MAX_EVENTS: MAX_EVENTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosGcal = api;
})(typeof window !== "undefined" ? window : null);
