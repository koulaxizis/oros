// ============================================================
// orOS — phone bridge (BR-PHONE v1): orOS Contacts and Calendar
// inside the phone's own Contacts, dialer and Calendar apps.
//
// Only inside the orOS Android app (android/, a Trusted Web
// Activity). The app opens a postMessage channel to this page (Chrome
// 115+, origin checked by Chrome against .well-known/assetlinks.json
// "use_as_origin"); the first message carries a MessagePort. In every
// other browser nothing here runs: no port ever arrives.
//
// Direction: orOS → phone as an "orOS" account, and since v2 back:
// edits made on the phone come in as {t:"changes"} (own Calendar
// events and Contacts; feeds stay read-only). Decryption stays in the page:
// the app only ever receives the rows below, never keys or blobs.
// Opt-in per device and per kind (localStorage "oros-phone", never
// synced). Each send is a full snapshot; the app diffs by id + hash.
//
// Pure part (Node-tested in tests/phone.test.js):
//   contactRows(blob) → [{ id, h, given, middle, family, nickname,
//     org, title, phones[{v,t}], emails[{v,t}], addresses[{street,
//     city, region, zip, country, t}], websites[], events[{t, d,
//     label}], note, starred, photo }]
//   eventRows(blob, tz) → [{ id, h, title, desc, loc, allDay,
//     dtstart, dtend, duration, tz, rrule, exdate, remind, color }]
//     color = the event's label colour "#rrggbb" (null: the calendar's)
//   feedRows(store, tz) → the same rows for the Calendar's app feeds
//     and holidays (To-Do, birthdays, Budget, …). Those exist only as
//     Calendar renders them, so the Calendar app (calendar.js
//     phonePublish) writes the days it shows to localStorage
//     "oros-phone-cal-feeds" on this device (never synced):
//     { at, items: [{ k, date, start, end, title, note, color }] }.
// Messages (JSON strings on the port):
//   page → app: {t:"state"} · {t:"contacts"|"calendar", seq, items}
//               {t:"clear", what}
//               {t:"applied", what, refs[, ids]}   (v2: phone changes
//                 taken; ids: orOS id of each new contact by ref)
//               {t:"reminders", seq, items}   (v3: see reminderRows)
//               {t:"seen", v}                  (v3: orOS on screen)
//               {t:"today", seq, data}         (v4: home-screen widget,
//                 see widgetData; only while the phone has a widget)
//               {t:"agenda", seq, cal, todo}   (v7: Calendar and To-Do
//                 widgets, see agendaData; only while the phone has one)
//               {t:"applied", what:"ticks", refs} (v7: widget ticks taken)
//               {t:"health", seq, since, water, workouts}  (v5: Health
//                 Connect, see healthOut)
//               {t:"af-keys"}                  (v8, PW-AF2: Passwords asks
//                 for the two Keystore public keys)
//               {t:"af-index", seq, idx, names, at}  (v8: the sealed fill
//                 lists, passwords/afindex.js; never plain values)
//               {t:"clear", what:"af"}         (v8: copies and keys removed)
//               {t:"applied", what:"af-save", refs}  (v8, PW-AF3: logins
//                 to save handed to Passwords)
//   app → page: {t:"state", v, contacts, calendar, reminders, exact,
//                widgets, wcal, wtodo, health, drive, app}  (drive: the
//                orOS Drive app is installed, DRIVE-APP; widgets, wcal,
//                wtodo: Today, Calendar and To-Do widgets placed)
//               {t:"health-in", steps, water, workouts}  (v5: what other
//                 apps put in Health Connect, see healthIn)
//               {t:"changes", what, items}   (v2: edits made on the phone)
//               {t:"ticks", items:[{ref, l, i, at}]}  (v7: tasks ticked
//                 on the To-Do widget, sent until answered; see tickTask)
//               {t:"af-keys", idx, names, af}  (v8: base64 SPKI public keys)
//               {t:"af-save", items:[{ref, url|app, user, pw, title}]}
//                 (v8, PW-AF3: logins the person chose to save in
//                 another app; sent until answered; see takeSaves)
//               {t:"done", what, seq, added, updated, removed}  (what
//                 "af-index" carries af: {svc, keys, stored, at})
//               {t:"error", what, seq, msg}
// Exposes window.orosPhone and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-phone";
  var KEYS = { contacts: "oros-contacts-data", calendar: "oros-calendar-data" };
  var FEEDS_KEY = "oros-phone-cal-feeds";
  var HANDLED_KEY = "oros-phone-rem";    // {dedupKey: at}, reminders given to the app
  var TAKEN_KEY = "oros-phone-taken";    // [[kind:hash, id, at]], phone changes applied lately
  var MAX_TAKEN = 500;
  var MAX_FEED_ROWS = 5000;
  var PERM_URL = { contacts: "intent://contacts#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   calendar: "intent://calendar#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   reminders: "intent://reminders#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   health: "intent://health#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   // DRIVE-APP: opens the orOS Drive app, or its download.
                   drive: "intent://drive#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   // PW-AF2: Android's "use orOS as the autofill service" screen.
                   autofill: "intent://autofill#Intent;scheme=oros-permission;package=online.useoros.twa;end" };
  var HEALTH_KEYS = { water: "oros-water-data", fitness: "oros-fitness-data", health: "oros-health-data" };

  /* ---------- pure helpers ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function str(v, max) { return (typeof v === "string" ? v : "").slice(0, max); }
  // Words of reminders and workout kinds: the shell's table
  // (translations.js "rem.*" / "ph.*", German from the shell pack);
  // the English given here where it is missing (node tests).
  function tx(key, fb, vars) {
    var f = root && root.t, v = typeof f === "function" ? f(key) : key;
    if (v === key || typeof v !== "string") v = fb;
    if (vars) Object.keys(vars).forEach(function (k) { v = v.split("{" + k + "}").join(String(vars[k])); });
    return v;
  }
  function fnv(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function withHash(row) {
    row.h = fnv(JSON.stringify(row));
    return row;
  }
  function tombIds(blob) {
    var dead = {};
    (Array.isArray(blob && blob.deleted) ? blob.deleted : []).forEach(function (d) {
      if (d && typeof d.id === "string") dead[d.id] = d.mtime || 0;
    });
    return dead;
  }
  function alive(e, dead) {
    return !(e.id in dead) || (typeof e.mtime === "number" && e.mtime > dead[e.id]);
  }

  var PHONE_T = { mobile: 1, home: 1, work: 1, main: 1, other: 1 };
  var EMAIL_T = { home: 1, work: 1, other: 1 };
  function typed(list, max, T) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      var v = r && typeof r.v === "string" ? r.v.trim().slice(0, max) : "";
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1;
      out.push({ v: v, t: T && T[r.type] ? r.type : "other" });
    });
    return out;
  }

  function contactRows(blob) {
    var dead = tombIds(blob);
    var rows = [], seen = {};
    (Array.isArray(blob && blob.contacts) ? blob.contacts : []).forEach(function (c) {
      if (!c || typeof c.id !== "string" || !c.id || !alive(c, dead)) return;
      // One phone contact per orOS id, even if the store holds a repeat.
      if (seen[c.id.slice(0, 64)]) return;
      seen[c.id.slice(0, 64)] = 1;
      var row = {
        id: c.id.slice(0, 64),
        given: str(c.given, 60), middle: str(c.middle, 60), family: str(c.family, 60),
        nickname: str(c.nickname, 60), org: str(c.org, 80), title: str(c.jobTitle, 80),
        phones: typed(c.phones, 40, PHONE_T),
        emails: typed(c.emails, 120, EMAIL_T),
        addresses: (Array.isArray(c.addresses) ? c.addresses : []).map(function (a) {
          return a && typeof a === "object" ? {
            street: str(a.street, 120), city: str(a.city, 60), region: str(a.region, 60),
            zip: str(a.zip, 20), country: str(a.country, 60),
            t: a.type === "home" || a.type === "work" ? a.type : "other"
          } : null;
        }).filter(function (a) { return a && (a.street || a.city || a.region || a.zip || a.country); }),
        websites: typed(c.websites, 300, null).map(function (w) { return w.v; }),
        events: (Array.isArray(c.events) ? c.events : []).map(function (ev) {
          if (!ev || typeof ev.day !== "string" || !/^\d{2}-\d{2}$/.test(ev.day)) return null;
          var y = typeof ev.year === "number" && ev.year >= 1000 && ev.year <= 9999 ? ev.year : null;
          return {
            t: ev.type === "birthday" || ev.type === "anniversary" ? ev.type : "other",
            d: (y ? y + "-" : "--") + ev.day,
            label: str(ev.label, 40)
          };
        }).filter(Boolean),
        note: str(c.note, 2000),
        starred: c.starred === true,
        photo: null   // CT-NP: Contacts keeps no photos
      };
      if (!(row.given || row.family || row.nickname || row.org || row.phones.length || row.emails.length)) return;
      rows.push(withHash(row));
    });
    rows.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return rows;
  }

  // Calendar → Android CalendarContract fields. Times are computed in
  // the page's local zone, which is the phone's zone (same device),
  // or in the event's own zone when it carries one (`tz`, Calendar
  // wave 5): then EVENT_TIMEZONE is that zone, so Android repeats it
  // at that zone's wall time. Rules come from calendar/occur.js.
  // Looked up on each use: calendar/occur.js is in the late bundle
  // (BOOT-L1, loaded after this file).
  var occNode = null;
  function OCC() {
    if (root && root.OrosCalOccur) return root.OrosCalOccur;
    if (occNode === null) occNode = typeof module !== "undefined" && typeof require === "function" ? require("./calendar/occur.js") : false;
    return occNode || null;
  }
  var FREQ = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
  function parts(ymd) { var p = ymd.split("-"); return [+p[0], +p[1] - 1, +p[2]]; }
  function hm(s) { var p = (s || "00:00").split(":"); return [+p[0], +p[1]]; }
  function localMs(ymd, time) {
    var d = parts(ymd), t = hm(time);
    return new Date(d[0], d[1], d[2], t[0], t[1]).getTime();
  }
  // Wall time in zone z (null: the page's own zone) → ms.
  function zonedMs(ymd, time, z) { return z && OCC() ? OCC().wallToMs(ymd, time, z) : localMs(ymd, time); }
  function utcMidnight(ymd, addDays) {
    var d = parts(ymd);
    return Date.UTC(d[0], d[1], d[2] + (addDays || 0));
  }
  function utcStamp(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }
  function eventZone(e) {
    var timed = typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start);
    return timed && e.tz && OCC() && OCC().tzValid(e.tz) ? e.tz : null;
  }
  // The Calendar's monthly / yearly rule clamps to the month's last
  // day (Jan 31 → Feb 28 → Mar 31). RFC 5545 skips such months
  // instead, so days 29-31 become "the last of 28…day" (BYSETPOS=-1).
  // Every N, weekdays, Nth / last weekday and COUNT pass as RFC 5545.
  function rrule(e) {
    var r = e.recur;
    if (!r || !FREQ[r.freq]) return null;
    var z = eventZone(e);
    if (OCC()) {
      return OCC().toRrule(e, {
        until: function (u) {
          return e.start ? utcStamp(zonedMs(u, "23:59", z) + 59000) : utcStamp(utcMidnight(u));
        }
      });
    }
    var s = "FREQ=" + FREQ[r.freq];
    if (r.freq === "W" && r.interval === 2) s += ";INTERVAL=2";
    if (typeof r.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) {
      s += ";UNTIL=" + (e.start ? utcStamp(localMs(r.until, "23:59") + 59000)
                                : utcStamp(utcMidnight(r.until)));
    }
    return s;
  }

  function hex(c) { return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null; }
  function eventRows(blob, tz) {
    var dead = tombIds(blob);
    var rows = [], colors = {};
    (Array.isArray(blob && blob.labels) ? blob.labels : []).forEach(function (l) {
      if (l && typeof l.id === "string") colors[l.id] = hex(l.color);
    });
    (Array.isArray(blob && blob.events) ? blob.events : []).forEach(function (e) {
      if (!e || typeof e.id !== "string" || !e.id || !alive(e, dead)) return;
      if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return;
      var timed = typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start);
      var end = timed && typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end) ? e.end : null;
      var dateEnd = typeof e.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateEnd) && e.dateEnd >= e.date ? e.dateEnd : null;
      var z = eventZone(e);
      var rule = rrule(e);
      var row = {
        id: e.id.slice(0, 64),
        title: str(e.title, 80), desc: str(e.note, 500), loc: str(e.location, 150),
        allDay: !timed,
        dtstart: timed ? zonedMs(e.date, e.start, z) : utcMidnight(e.date),
        dtend: null, duration: null,
        tz: timed ? (z || tz || "UTC") : "UTC",
        rrule: rule, exdate: null,
        // No Android reminder on the copy: orOS rings Calendar reminders
        // itself (calendarReminders), as some phone Calendar apps never
        // ring events of another account. A reminder added on the phone
        // still comes back (remindIn) and orOS rings it from then on.
        remind: null,
        color: colors[e.labelId] || null
      };
      if (rule) {
        // Series: Android wants DURATION, never DTEND. A series may
        // span days (Calendar wave 5): the duration covers them.
        var span = dateEnd && dateEnd > e.date && OCC() ? OCC().dayNum(dateEnd) - OCC().dayNum(e.date) : 0;
        var mins = 0;
        if (timed) {
          var a = hm(e.start), b = hm(end || e.start);
          mins = span * 1440 + (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
          if (!span && !(end && end > e.start)) mins = 0;
          if (mins < 0) mins = 0;
        }
        row.duration = timed ? "P" + (mins * 60) + "S" : "P" + (span + 1) + "D";
        var ex = (e.recur.exdates || []).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
        if (ex.length) {
          row.exdate = ex.map(function (d) {
            return utcStamp(timed ? zonedMs(d, e.start, z) : utcMidnight(d));
          }).join(",");
        }
      } else if (timed) {
        var endDay = dateEnd || e.date;
        var endMs = zonedMs(endDay, end || (dateEnd ? "00:00" : e.start), z);
        row.dtend = Math.max(endMs, row.dtstart);
      } else {
        row.dtend = utcMidnight(dateEnd || e.date, 1);
      }
      rows.push(withHash(row));
    });
    rows.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return rows;
  }

  // Feed rows have no id of their own (calendar.js makes them per
  // render), so the id is a hash of the row's key and day: stable while
  // the source item stays, new when it moves.
  function feedRows(store, tz) {
    var rows = [], seen = {};
    (Array.isArray(store && store.items) ? store.items : []).forEach(function (x) {
      if (rows.length >= MAX_FEED_ROWS || !x || typeof x.k !== "string" || !x.k) return;
      if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return;
      var id = "f" + fnv(x.k + "|" + x.date) + fnv(x.date + "|" + x.k);
      if (seen[id]) return;
      seen[id] = 1;
      var timed = typeof x.start === "string" && /^\d{2}:\d{2}$/.test(x.start);
      var end = timed && typeof x.end === "string" && /^\d{2}:\d{2}$/.test(x.end) && x.end > x.start ? x.end : null;
      var start = timed ? localMs(x.date, x.start) : utcMidnight(x.date);
      rows.push(withHash({
        id: id,
        title: str(x.title, 80), desc: str(x.note, 500), loc: "",
        allDay: !timed,
        dtstart: start,
        dtend: timed ? (end ? localMs(x.date, end) : start) : utcMidnight(x.date, 1),
        duration: null,
        tz: timed ? (tz || "UTC") : "UTC",
        rrule: null, exdate: null, remind: null,
        color: hex(x.color)
      }));
    });
    rows.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return rows;
  }

  /* ---------- phone → orOS (BR-PHONE v2) ---------- */
  // The app sends what was changed in the phone's "orOS" calendar:
  // { ref, op: "upsert"|"delete", id (orOS id or null for a new row),
  //   title, desc, loc, allDay, dtstart, dtend, duration, rrule, exdate,
  //   remind, orig: { id, at } (an edited / cancelled occurrence of a
  //   series), cancelled }. Times are ms; all-day rows are UTC midnights.
  // A timed event orOS keeps in its own zone (`tz`) comes back as wall
  // times in that zone (z below); everything else in the page's zone.
  function ymdLocal(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymdUtc(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function hmLocal(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function wallIn(ms, z) {
    if (z && OCC()) return OCC().msToWall(ms, z);
    return { date: ymdLocal(ms), time: hmLocal(ms) };
  }
  function isoSecs(s) {          // "P3600S", "PT1H30M", "P1D", "P1W" → seconds
    var m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || "").replace(/^\+/, ""));
    if (!m) { var n = /^P(\d+)S$/.exec(String(s || "")); return n ? +n[1] : 0; }
    return (+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0);
  }
  var FREQ_IN = { DAILY: "D", WEEKLY: "W", MONTHLY: "M", YEARLY: "Y" };
  function stampDay(s, allDay, z) {  // "20261014" / "20261014T183000Z" → local (or zone z) YMD
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(String(s || "").trim());
    if (!m) return null;
    if (!m[4] || allDay) return m[1] + "-" + m[2] + "-" + m[3];
    var ms = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
                  : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return wallIn(ms, z).date;
  }
  // Android RRULE → the Calendar's recur through occur.js fromRrule
  // (every N, weekdays, Nth / last weekday, COUNT, UNTIL). A rule orOS
  // cannot hold keeps its FREQ (and weekly INTERVAL 2) only.
  function recurIn(rule, exdate, allDay, start, z) {
    if (!rule) return null;
    var r = null;
    if (OCC() && typeof start === "string") {
      var got = OCC().fromRrule(rule, start, { until: function (v) { return stampDay(v, allDay, z); } });
      if (got.single) return null;
      if (got.recur) r = got.recur;
    }
    if (!r) {
      var p = {};
      String(rule).split(";").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
      var f = FREQ_IN[p.FREQ];
      if (!f) return null;
      r = { freq: f, interval: f === "W" && p.INTERVAL === "2" ? 2 : 1, until: p.UNTIL ? stampDay(p.UNTIL, allDay, z) : null, exdates: [] };
    }
    var ex = [];
    String(exdate || "").split(/[,\n]/).forEach(function (x) {
      var d = stampDay(x.replace(/^.*:/, ""), allDay, z);
      if (d && ex.indexOf(d) === -1) ex.push(d);
    });
    r.exdates = ex.sort();
    return r;
  }
  var REMIND_IN = [5, 15, 30, 60, 1440, 4320, 7200];
  function remindIn(m) {
    if (typeof m !== "number" || m < 0) return null;
    var best = REMIND_IN[0];
    REMIND_IN.forEach(function (x) { if (Math.abs(x - m) < Math.abs(best - m)) best = x; });
    return best;
  }
  // One phone row → the Calendar's event fields (no id, label, mtime).
  // z: the zone the stored event keeps (its times come back in it).
  function eventIn(c, z) {
    var allDay = !!c.allDay, start = +c.dtstart;
    if (!isFinite(start)) return null;
    var endMs = isFinite(+c.dtend) && +c.dtend > 0 ? +c.dtend : start + isoSecs(c.duration) * 1000;
    var zz = allDay ? null : (z || null);
    var s = wallIn(start, zz);
    var date = allDay ? ymdUtc(start) : s.date;
    var e = { title: str(c.title, 80), note: str(c.desc, 500), location: str(c.loc, 150),
              date: date, dateEnd: null, start: null, end: null,
              recur: recurIn(c.rrule, c.exdate, allDay, date, zz), remindMin: remindIn(c.remind) };
    if (allDay) {
      var last = endMs > start ? ymdUtc(endMs - 86400000) : e.date;
      if (last > e.date) e.dateEnd = last;
    } else {
      e.start = s.time;
      if (endMs > start) {
        var en = wallIn(endMs, zz);
        if (en.date === e.date) e.end = en.time;
        else { e.dateEnd = en.date; e.end = en.time; }
      }
    }
    return e;
  }
  function newEventId(now) { return now.toString(36) + Math.random().toString(36).slice(2, 7); }
  // Applies phone changes to a Calendar blob. Returns { blob, refs }:
  // the refs the app may now clear. Feed rows ("f…") never come back:
  // their calendar is read-only on the phone.
  function applyCalendarChanges(blob, items, now) {
    var b = blob && typeof blob === "object" ? JSON.parse(JSON.stringify(blob)) : {};
    if (!Array.isArray(b.events)) b.events = [];
    if (!Array.isArray(b.deleted)) b.deleted = [];
    if (b.ver == null) b.ver = 1;
    now = now || Date.now();
    var refs = [];
    function find(id) { for (var i = 0; i < b.events.length; i++) if (b.events[i].id === id) return i; return -1; }
    function tomb(id) {
      b.deleted = b.deleted.filter(function (d) { return d && d.id !== id; });
      b.deleted.push({ id: id, mtime: now });
    }
    (Array.isArray(items) ? items : []).forEach(function (c) {
      if (!c || typeof c.ref !== "string") return;
      if (typeof c.id === "string" && c.id.charAt(0) === "f" && /^f[0-9a-f]{16}$/.test(c.id)) { refs.push(c.ref); return; }
      var orig = c.orig && typeof c.orig.id === "string" ? c.orig : null;
      if (orig) {
        // One occurrence of a series changed or cancelled on the phone:
        // the series skips that day; a changed one becomes its own event.
        var si = find(orig.id);
        if (si !== -1 && b.events[si].recur) {
          var s = b.events[si], sz = eventZone(s);
          var day = s.start ? wallIn(+orig.at, sz).date : ymdUtc(+orig.at);
          var ex = (s.recur.exdates || []).slice();
          if (ex.indexOf(day) === -1) ex.push(day);
          ex.sort();
          s.recur = Object.assign({}, s.recur, { exdates: ex });
          s.mtime = now;
          if (c.op !== "delete" && !c.cancelled) {
            var one = eventIn(c, sz);
            if (one) {
              one.recur = null;
              if (one.remindMin == null) one.remindMin = s.remindMin == null ? null : s.remindMin;
              if (sz && one.start) one.tz = sz;
              b.events.push(Object.assign(one, { id: newEventId(now), labelId: s.labelId || null, mtime: now }));
            }
          }
        }
        refs.push(c.ref);
        return;
      }
      var i = typeof c.id === "string" && c.id ? find(c.id) : -1;
      if (c.op === "delete") {
        if (i !== -1) { b.events.splice(i, 1); tomb(c.id); }
        refs.push(c.ref);
        return;
      }
      var z = i !== -1 ? eventZone(b.events[i]) : null;
      var e = eventIn(c, z);
      if (!e) { refs.push(c.ref); return; }
      if (i !== -1) {
        // The copy carries no reminder, so "none" from the phone keeps orOS's own.
        if (e.remindMin == null) delete e.remindMin;
        var merged = Object.assign({}, b.events[i], e, { mtime: now });
        if (!merged.start || !z) delete merged.tz;
        b.events[i] = merged;
      } else b.events.push(Object.assign(e, { id: newEventId(now), labelId: null, mtime: now }));
      refs.push(c.ref);
    });
    return { blob: b, refs: refs };
  }

  // Phone → orOS Contacts. Rows come in contactRows' shape (t for
  // type); fields only orOS has (labels, relations, IM, website
  // types) are kept from the stored contact. Photos never come in
  // (CT-NP, 2026-10-15).
  // Returns { blob, refs, ids }: ids gives a new contact's orOS id
  // by ref, which the app stores as the row's SOURCE_ID.
  var WEB_T = { home: 1, work: 1, blog: 1, other: 1 };
  function contactIn(c, old) {
    function list(a, max, T) {
      var out = [], seen = {};
      (Array.isArray(a) ? a : []).forEach(function (r) {
        var v = r && typeof r.v === "string" ? r.v.trim().slice(0, max) : "";
        if (!v || seen[v.toLowerCase()]) return;
        seen[v.toLowerCase()] = 1;
        out.push({ v: v, type: T[r.t] ? r.t : "other" });
      });
      return out;
    }
    var oldWeb = {};
    ((old && old.websites) || []).forEach(function (w) { if (w && w.v) oldWeb[w.v] = w.type; });
    var n = {
      given: str(c.given, 60).trim(), middle: str(c.middle, 60).trim(), family: str(c.family, 60).trim(),
      nickname: str(c.nickname, 60).trim(), org: str(c.org, 80).trim(), jobTitle: str(c.title, 80).trim(),
      phones: list(c.phones, 40, PHONE_T),
      emails: list(c.emails, 120, EMAIL_T),
      addresses: (Array.isArray(c.addresses) ? c.addresses : []).map(function (a) {
        if (!a || typeof a !== "object") return null;
        var r = { street: str(a.street, 120).trim(), city: str(a.city, 60).trim(), zip: str(a.zip, 20).trim(),
                  region: str(a.region, 60).trim(), country: str(a.country, 60).trim(),
                  type: a.t === "home" || a.t === "work" ? a.t : "other" };
        return r.street || r.city || r.zip || r.region || r.country ? r : null;
      }).filter(Boolean),
      websites: (Array.isArray(c.websites) ? c.websites : []).map(function (u) {
        u = typeof u === "string" ? u.trim().slice(0, 300) : "";
        return u ? { v: u, type: WEB_T[oldWeb[u]] ? oldWeb[u] : "other" } : null;
      }).filter(Boolean),
      events: (Array.isArray(c.events) ? c.events : []).map(function (ev) {
        // "1990-05-10", "--05-10", "19900510", "1990-05-10T00:00:00Z"
        var m = ev && typeof ev.d === "string" && ev.d.match(/^(\d{4}|-)-?(\d{2})-?(\d{2})/);
        if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
        var y = m[1] === "-" ? null : +m[1];
        return {
          day: m[2] + "-" + m[3],
          year: y && y >= 1850 && y <= 2200 ? y : null,
          type: ev.t === "birthday" || ev.t === "anniversary" ? ev.t : "custom",
          label: str(ev.label, 40).trim()
        };
      }).filter(Boolean),
      note: str(c.note, 2000),
      starred: c.starred === true
    };
    if (!(n.given || n.middle || n.family || n.nickname || n.org || n.phones.length || n.emails.length)) return null;
    return n;
  }
  function applyContactChanges(blob, items, now) {
    var b = blob && typeof blob === "object" ? JSON.parse(JSON.stringify(blob)) : {};
    if (!Array.isArray(b.contacts)) b.contacts = [];
    if (!Array.isArray(b.deleted)) b.deleted = [];
    if (b.ver == null) b.ver = 1;
    now = now || Date.now();
    var refs = [], ids = {};
    function find(id) { for (var i = 0; i < b.contacts.length; i++) if (b.contacts[i] && b.contacts[i].id === id) return i; return -1; }
    (Array.isArray(items) ? items : []).forEach(function (c) {
      if (!c || typeof c.ref !== "string") return;
      var i = typeof c.id === "string" && c.id ? find(c.id) : -1;
      refs.push(c.ref);
      if (c.op === "delete") {
        if (i !== -1) {
          b.contacts.splice(i, 1);
          b.deleted = b.deleted.filter(function (d) { return d && d.id !== c.id; });
          b.deleted.push({ id: c.id, mtime: now });
        }
        return;
      }
      var old = i !== -1 ? b.contacts[i] : null;
      var n = contactIn(c, old);
      if (!n) return;
      // CT-NP: a phone photo is never taken (Contacts keeps none)
      if (old) {
        b.contacts[i] = Object.assign({}, old, n, { mtime: now });
      } else {
        var id = newEventId(now);
        b.contacts.push(Object.assign({ id: id }, n, {
          im: [], relations: [], labelIds: [],
          avatar: null, mtime: now
        }));
        ids[c.ref] = id;
      }
    });
    return { blob: b, refs: refs, ids: ids };
  }

  // Repeats of a phone change already applied: same kind and same
  // content (ref included, so two new rows with equal fields differ).
  function takenKey(kind, c) { return kind + ":" + fnv(JSON.stringify(c)); }
  // taken: [[key, id, at]]; only the last TAKEN_MS count, so a later
  // edit back to an earlier state still applies.
  var TAKEN_MS = 10 * 60 * 1000;
  function splitTaken(kind, items, taken, now) {
    var seen = {};
    now = now || Date.now();
    (Array.isArray(taken) ? taken : []).forEach(function (x) {
      if (x && typeof x[0] === "string" && now - (+x[2] || 0) < TAKEN_MS) seen[x[0]] = x[1] || "";
    });
    var out = { fresh: [], refs: [], ids: {} };
    (Array.isArray(items) ? items : []).forEach(function (c) {
      if (!c || typeof c.ref !== "string") return;
      var k = takenKey(kind, c);
      if (k in seen) {
        out.refs.push(c.ref);
        if (seen[k]) out.ids[c.ref] = seen[k];
      } else {
        out.fresh.push(c);
      }
    });
    return out;
  }

  // Reminders for the next REM_HOURS, rung by the Android app even
  // when orOS is closed (BR-PHONE v3). Each row's id is the dedupKey
  // the shell's own engine would give the same reminder ("ns:key"),
  // so the page can leave those to the app. src:
  //   alarms: oros-alarms list ({id, at, label, repeat, state})
  //   water:  { data, core }  (water/core.js parse + reminderDue)
  //   todo:   { data, core }  (todo/core.js dueSummary)
  //   habits: { data, core }  (habits/core.js needsReminder: each
  //           habit's reminder time on the days it still needs)
  //   health: { data, core } (health/core.js alarmsBetween: medicine
  //           doses, doctor's appointments, vaccinations)
  //   lang: "en" | "el"; alarmTitle / todoTitle / habitsTitle /
  //   healthTitle: the shell's words
  //   hours / max (optional): horizon and row cap, REM_HOURS and 100
  //   unless given (Web Push asks for a week, webpush.js)
  var REM_HOURS = 48, TODO_HOUR = 9;
  function reminderRows(src, now) {
    src = src || {};
    var hours = src.hours > 0 && src.hours <= 192 ? src.hours : REM_HOURS;
    var el = src.lang === "el", end = now + hours * 3600000, rows = [], days = Math.ceil(hours / 24) + 1;
    function dayAt(ms, add, h) { var d = new Date(ms); d.setHours(h || 0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); }
    var alarmTitle = str(src.alarmTitle, 60) || tx("alarm.title", "Alarm");
    (Array.isArray(src.alarms) ? src.alarms : []).forEach(function (a) {
      if (!a || a.state !== "pending" || typeof a.at !== "number" || !isFinite(a.at) || typeof a.id !== "string") return;
      var t = a.at, guard = 0;
      if (a.repeat === "daily") {
        while (t <= now && guard++ < 4000) { var d = new Date(t); d.setDate(d.getDate() + 1); t = d.getTime(); }
      }
      for (var n = 0; n < days && t <= end; n++) {
        if (t > now) rows.push({ id: "time:alarm-" + a.id + "-" + ymdLocal(t), at: t, kind: "alarm", ns: "time",
                                 title: alarmTitle, body: str(a.label, 60) || alarmTitle,
                                 link: a.id.indexOf("tmr-") === 0 ? "time:timer" : "time:alarms" });   // Time wave 5: kitchen timers
        if (a.repeat !== "daily") break;
        var nx = new Date(t); nx.setDate(nx.getDate() + 1); t = nx.getTime();
      }
    });
    var W = src.water;
    if (W && W.core && W.data && typeof W.core.reminderDue === "function") {
      var seen = {}, step = 5 * 60000;
      for (var t = Math.ceil((now + 1) / step) * step; t <= now + 24 * 3600000; t += step) {
        var due = null;
        try { due = W.core.reminderDue(W.data, new Date(t)); } catch (e) { break; }
        if (!due || seen[due.key]) continue;
        seen[due.key] = 1;
        var txt = W.core.reminderText(due, W.data.prefs, el ? "el" : "en");
        rows.push({ id: "water:" + due.key, at: t, kind: "note", ns: "water",
                    title: str(txt.title, 80), body: str(txt.body, 200), link: "system:open:water" });
      }
    }
    var T = src.todo;
    if (T && T.core && T.data && typeof T.core.dueSummary === "function") {
      for (var dd = 0; dd < days; dd++) {
        var at = dayAt(now, dd, TODO_HOUR);
        if (at <= now || at > end) continue;
        var ymd = ymdLocal(at), sum = T.core.dueSummary(T.data, ymd);
        if (!sum || !sum.count) continue;
        rows.push({ id: "todo:due-" + ymd + "-" + sum.count, at: at, kind: "note", ns: "todo",
                    title: str(src.todoTitle, 60) || "To-Do",
                    body: sum.count === 1 ? tx("rem.todo.one", "{n} task is due or overdue", { n: 1 })
                                          : tx("rem.todo.other", "{n} tasks are due or overdue", { n: sum.count }),
                    link: sum.earliestList ? "todo:" + sum.earliestList : "" });
      }
    }
    var HB = src.habits;
    if (HB && HB.core && HB.data && typeof HB.core.needsReminder === "function") {
      var hix = null;
      try { hix = HB.core.index(HB.data); } catch (e) { hix = null; }
      (hix ? HB.core.living(HB.data) : []).forEach(function (h) {
        if (typeof h.rem !== "number") return;
        for (var hd = 0; hd < days; hd++) {
          var hDay = new Date(dayAt(now, hd, 0));
          hDay.setHours(Math.floor(h.rem / 60), h.rem % 60, 0, 0);
          var hAt = hDay.getTime();
          if (hAt <= now || hAt > end) continue;
          var hy = ymdLocal(hAt);
          if (!HB.core.needsReminder(hix, h, hy)) continue;
          rows.push({ id: "habits:" + HB.core.remKey(h.id, hy), at: hAt, kind: "note", ns: "habits",
                      title: str(src.habitsTitle, 60) || tx("app.habits", "Habits"),
                      body: tx("rem.habit", "Time for: {name}", { name: str(h.name, 120) }), link: "habits:0" });
        }
      });
    }
    // Health: medicine doses (a snoozed one at the end of its snooze),
    // doctor's appointments and vaccinations, from the same rules and
    // with the same keys as the shell engine (healthCheckTick), so the
    // inbox notice and the phone's alarm are one.
    var HL = src.health;
    if (HL && HL.core && HL.data && typeof HL.core.alarmsBetween === "function") {
      var hd = null;
      try { hd = HL.core.merge(HL.data, HL.data); } catch (e) { hd = null; }
      var hTitle = str(src.healthTitle, 60) || tx("app.health", "Health");
      var hm2 = function (ms) { var x = new Date(ms); return (x.getHours() < 10 ? "0" : "") + x.getHours() + ":" + (x.getMinutes() < 10 ? "0" : "") + x.getMinutes(); };
      var dm2 = function (ms) { var x = new Date(ms); return x.getDate() + "/" + (x.getMonth() + 1); };
      (hd ? HL.core.alarmsBetween(hd, now, end) : []).forEach(function (r) {
        var body = "", link = "health:meds";
        if (r.k === "dose") {
          var tm = (r.tm < 600 ? "0" : "") + Math.floor(r.tm / 60) + ":" + (r.tm % 60 < 10 ? "0" : "") + (r.tm % 60);
          body = tx("rem.med", "Time for your medicine: {name} ({time})", { name: r.med.n + (r.med.s ? " " + r.med.s : ""), time: tm });
        } else if (r.k === "appt") {
          var a = r.ap, who = a.dr && a.sp ? a.dr + " · " + a.sp : (a.dr || a.sp);
          body = tx("rem.appt", "Doctor's appointment: {who}, {when}", { who: who, when: dm2(a.at) + " " + hm2(a.at) });
          link = "health:appts";
        } else if (r.k === "vax") {
          var p = r.vx.nx.split("-");
          body = r.st === "w" ? tx("rem.vax.week", "Next vaccine dose in a week: {name} ({when})", { name: r.vx.n, when: (+p[2]) + "/" + (+p[1]) })
                              : tx("rem.vax.due", "Next vaccine dose due: {name} ({when})", { name: r.vx.n, when: (+p[2]) + "/" + (+p[1]) });
          link = "health:vax";
        } else return;
        rows.push({ id: "health:" + r.key, at: r.at, kind: "note", ns: "health",
                    title: hTitle, body: str(body, 200), link: link });
      });
    }
    rows.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
    return rows.slice(0, src.max > 0 ? src.max : 100);
  }

  // Home-screen widget (v4): the Today summary (today/host.js build)
  // in a small plain form. Each row keeps its own day ("" = every day,
  // a row with no date of its own), so on the days orOS stays closed
  // the app can still tell a late task from today's and drop the
  // events that are over.
  var WIDGET_ROWS = 30;
  function widgetData(sum) {
    var names = {}, rows = [], g = (sum && sum.groups) || {}, today = sum && sum.today;
    ((sum && sum.apps) || []).forEach(function (a) { if (a && typeof a.id === "string") names[a.id] = str(a.name, 40); });
    function add(r, day) {
      if (!r || rows.length >= WIDGET_ROWS || !str(r.title, 120)) return;
      rows.push({ d: day || "", tm: typeof r.time === "string" ? r.time : "", t: str(r.title, 120),
                  a: names[r.app] || "", k: r.kind === "event" ? "event" : "task" });
    }
    (g.overdue || []).forEach(function (r) { add(r, r.due); });
    (g.today || []).forEach(function (r) { add(r, r.due); });
    (g.soon || []).forEach(function (d) { (d && d.rows || []).forEach(function (r) { add(r, d.day); }); });
    var info = (g.info || [])[0];
    return { day: typeof today === "string" ? today : "", info: info ? str(info.title, 120) : "", rows: rows };
  }

  // Calendar and To-Do widgets (v7): the same provider rows Today and
  // the Assistant read (orosToday.agenda), in a small plain form.
  //   cal  [{d, tm, t, s, o}]  day, time ("" = all day), title, place,
  //        o = the event's deep link ("calendar:<id>:<day>"), "" for a
  //        holiday or name day (opens the Calendar)
  //   todo [{l, i, t, s, d, r}] list id, task id, text, list name, due,
  //        r = 1 when the task repeats: the widget's tick then opens
  //        To-Do, which works out the next date itself
  // Rows in day and time order (all day after the timed ones), late
  // tasks first; at most AGENDA_ROWS each. A null input stays null.
  var AGENDA_ROWS = 30, CAL_DAYS = 14, TODO_DAYS = 31, ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
  function agendaData(cal, todo, todoBlob) {
    function sorted(rows) {
      return (rows || []).filter(function (r) { return r && typeof r.due === "string" && str(r.title, 120); })
        .map(function (r, n) { return { r: r, n: n }; })
        .sort(function (a, b) {
          if (a.r.due !== b.r.due) return a.r.due < b.r.due ? -1 : 1;
          var x = a.r.time || "~", y = b.r.time || "~";
          return x !== y ? (x < y ? -1 : 1) : a.n - b.n;
        }).map(function (x) { return x.r; });
    }
    var out = { cal: null, todo: null };
    if (cal) {
      out.cal = sorted(cal).filter(function (r) { return r.kind === "event" || /^hol:/.test(r.id || ""); })
        .slice(0, AGENDA_ROWS).map(function (r) {
          var tg = r.target || {}, ev = typeof tg.ev === "string" && ID_RE.test(tg.ev) && /^\d{4}-\d{2}-\d{2}$/.test(tg.date || "");
          return { d: r.due, tm: r.time || "", t: str(r.title, 120), s: str(r.text, 80),
                   o: ev ? "calendar:" + tg.ev + ":" + tg.date : "" };
        });
    }
    if (todo) {
      var rec = {};
      ((todoBlob && Array.isArray(todoBlob.lists)) ? todoBlob.lists : []).forEach(function (l) {
        (l && Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (it && it.recurrence) rec[l.id + "/" + it.id] = 1; });
      });
      out.todo = [];
      sorted(todo).forEach(function (r) {
        var dn = r.done || {};
        if (out.todo.length >= AGENDA_ROWS || !ID_RE.test(dn.list || "") || !ID_RE.test(dn.item || "")) return;
        out.todo.push({ l: dn.list, i: dn.item, t: str(r.title, 120), s: str(r.text, 60), d: r.due,
                        r: rec[dn.list + "/" + dn.item] ? 1 : 0 });
      });
    }
    return out;
  }

  // A tick from the To-Do widget (v7), made at `at` while orOS may have
  // been closed. The tick follows To-Do's own stamps (todo.js setDone,
  // TD-3: the "done" field only, stamped never older than the task),
  // and never wins over a change made after it: a task changed in
  // To-Do since (its "done" stamp newer than the tick) is left alone.
  // A repeating task is left to To-Do (the widget opens it for those).
  // → { blob, res: "done"|"gone"|"already"|"newer"|"repeats" }
  var TODO_FIELDS = ["text", "done", "due", "notes", "labels", "info", "recurrence"], TODO_XF = ["prio", "subs", "so", "list"];
  function tickTask(blob, listId, itemId, at, now) {
    // In the list it was in, else wherever it moved since.
    var it = null, lists = (blob && Array.isArray(blob.lists)) ? blob.lists : [];
    [true, false].forEach(function (same) {
      lists.forEach(function (l) {
        if (it || !l || !Array.isArray(l.items) || (same && l.id !== listId)) return;
        l.items.forEach(function (x) { if (!it && x && x.id === itemId) it = x; });
      });
    });
    if (!it) return { blob: blob, res: "gone" };
    if (it.done) return { blob: blob, res: "already" };
    if (it.recurrence) return { blob: blob, res: "repeats" };
    var fm = it.fm && typeof it.fm === "object" ? it.fm : null, mx = 0;
    if (fm) {
      TODO_FIELDS.forEach(function (f) { if (typeof fm[f] === "number" && fm[f] > mx) mx = fm[f]; });
      TODO_XF.forEach(function (f) { var w = it.xf && it.xf[f]; if (typeof w === "number" && w > mx) mx = w; });
    }
    var oldCode = !fm || (it.mtime || 0) > mx;   // todo.js touchedByOldCode: mtime speaks for every field
    function stamp(f) { return oldCode ? (it.mtime || 0) : (typeof fm[f] === "number" ? fm[f] : 0); }
    if (stamp("done") > at) return { blob: blob, res: "newer" };
    var nf = {};
    TODO_FIELDS.forEach(function (f) { nf[f] = stamp(f); });
    var t = Math.max(now, (it.mtime || 0) + 1);
    nf.done = t;
    it.done = true;
    it.fm = nf;
    it.mtime = t;
    return { blob: blob, res: "done" };
  }

  // Health Connect (v5): orOS Water and Workouts go to the phone's
  // Health Connect, and steps, water and workouts that other apps put
  // there come back. HEALTH_DAYS back from now, both ways. Rows that
  // came from Health Connect (ids "hc…") are never sent back.
  var HEALTH_DAYS = 30, DAY_MS = 86400000;
  var HC_WATER_RE = /^hc[0-9a-f]{4,38}$/, HC_ID = /^hc-/;
  function hcHex(ref, n) { return String(ref || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, n); }
  function healthOut(water, fit, now) {
    var since = now - HEALTH_DAYS * DAY_MS, out = { since: since, water: [], workouts: [] };
    (water && Array.isArray(water.sips) ? water.sips : []).forEach(function (s) {
      if (!s || s.del || typeof s.id !== "string" || HC_WATER_RE.test(s.id)) return;
      if (typeof s.ts !== "number" || s.ts < since || s.ts > now + DAY_MS || !(s.ml > 0)) return;
      out.water.push({ id: s.id, at: s.ts, ml: Math.round(s.ml), v: s.m | 0 });
    });
    var tombs = (fit && fit.tombs) || {};
    (fit && Array.isArray(fit.wo) ? fit.wo : []).forEach(function (w) {
      if (!w || typeof w.id !== "string" || HC_ID.test(w.id)) return;
      if (typeof w.st !== "number" || typeof w.en !== "number" || w.en <= w.st || w.st < since) return;
      if ((tombs["wo:" + w.id] || 0) >= (w.m || 0)) return;
      out.workouts.push({ id: w.id, st: w.st, en: w.en, ti: str(w.ti, 80), v: w.m | 0 });
    });
    return out;
  }
  // What came from Health Connect, into the three data blobs. Returns
  // the blobs that changed (null = unchanged). A row the person deleted
  // in orOS (tombstone) is not brought back.
  // Names for a workout from another app that has no title of its
  // own, by the kind the app sends.
  // English here; the shell's words come from translations.js ("ph.hc.*").
  var HC_KINDS = { running: "Running", walking: "Walking", cycling: "Cycling", swimming: "Swimming", hiking: "Hiking",
                   yoga: "Yoga", strength: "Strength training", other: "Workout" };
  function hcKinds() {
    var out = {};
    Object.keys(HC_KINDS).forEach(function (k) { out[k] = tx("ph.hc." + k, HC_KINDS[k]); });
    return out;
  }
  // A reading from Health Connect in Health's storage units, or null:
  //   wt grams · hr bpm · sl minutes asleep (at = bedtime) · bp
  //   systolic, diastolic (a 1 left / 2 right arm, p 1 sitting /
  //   2 standing / 3 lying) · gl tenths of mg/dL (c 1 fasting / 2 before
  //   a meal / 3 after) · o2 %. The ranges are Health's (core SPEC).
  var HC_VITALS_MAX = 3000;
  var HC_RANGE = { wt: [[500, 500000]], hr: [[20, 250]], sl: [[1, 1440]], bp: [[50, 300], [20, 200]],
                   gl: [[100, 10000]], o2: [[50, 100]] };
  function vitalRow(x) {
    if (!x || typeof x !== "object" || !Object.prototype.hasOwnProperty.call(HC_RANGE, x.k)) return null;
    if (typeof x.at !== "number" || !isFinite(x.at) || x.at < 0 || x.at > 4102444800000 || !Array.isArray(x.v)) return null;
    var r = HC_RANGE[x.k], v = [];
    for (var i = 0; i < r.length; i++) {
      var n = Math.round(+x.v[i]);
      if (!(n >= r[i][0] && n <= r[i][1])) return null;
      v.push(n);
    }
    if (x.k === "bp") { if (v[1] >= v[0]) return null; v.push(0); }
    if (x.k === "sl") v.push(0);
    function pick(n, max) { return n === Math.round(n) && n >= 0 && n <= max ? n : 0; }
    return { v: v, c: x.k === "gl" ? pick(x.c, 3) : 0, a: x.k === "bp" ? pick(x.a, 2) : 0, p: x.k === "bp" ? pick(x.p, 3) : 0 };
  }
  function healthIn(blobs, inc, now, names) {
    var res = { water: null, fitness: null, health: null };
    inc = inc || {};
    names = names || {};
    var w = blobs.water && Array.isArray(blobs.water.sips) ? JSON.parse(JSON.stringify(blobs.water)) : null;
    if (w) {
      var have = {}, add = 0;
      w.sips.forEach(function (s) { if (s && s.id) have[s.id] = 1; });
      (Array.isArray(inc.water) ? inc.water : []).forEach(function (x) {
        var id = "hc" + hcHex(x && x.ref, 32), ml = Math.round(+(x && x.ml) || 0);
        if (id.length < 8 || have[id] || typeof x.at !== "number" || ml < 1 || ml > 5000) return;
        have[id] = 1;
        w.sips.push({ id: id, ts: x.at, ml: ml, m: now });
        add++;
      });
      if (add) { w.sips.sort(function (a, b) { return a.id < b.id ? -1 : 1; }); res.water = w; }
    }
    var f = blobs.fitness && typeof blobs.fitness === "object" ? JSON.parse(JSON.stringify(blobs.fitness)) : null;
    if (f || (Array.isArray(inc.workouts) && inc.workouts.length)) {
      f = f || { ver: 1, ex: [], pg: [], wo: [], bm: [], set: null, tombs: {} };
      if (!Array.isArray(f.wo)) f.wo = [];
      var tombs = f.tombs || {}, haveW = {}, addW = 0;
      f.wo.forEach(function (x) { if (x && x.id) haveW[x.id] = 1; });
      (Array.isArray(inc.workouts) ? inc.workouts : []).forEach(function (x) {
        var id = "hc-" + hcHex(x && x.ref, 36);
        if (id.length < 11 || haveW[id] || ("wo:" + id) in tombs) return;
        if (typeof x.st !== "number" || typeof x.en !== "number" || x.en <= x.st) return;
        haveW[id] = 1;
        f.wo.push({ id: id, m: now, d: ymdLocal(x.st), st: x.st, en: x.en,
                    ti: str(x.ti, 60) || str(Object.prototype.hasOwnProperty.call(names, x.kind) ? names[x.kind] : "", 60) || str(names.other, 60), p: "", pd: "", n: "", x: [] });
        addW++;
      });
      if (addW) { f.wo.sort(function (a, b) { return a.id < b.id ? -1 : 1; }); res.fitness = f; }
    }
    var steps = Array.isArray(inc.steps) ? inc.steps : [];
    var vitals = Array.isArray(inc.vitals) ? inc.vitals.slice(0, HC_VITALS_MAX) : [];
    if (steps.length || vitals.length) {
      var h = blobs.health && typeof blobs.health === "object" ? JSON.parse(JSON.stringify(blobs.health))
                                                              : { ver: 1, en: [], ty: [], set: null, tombs: {} };
      if (!Array.isArray(h.en)) h.en = [];
      var ht = h.tombs || {}, byId = {}, ch = 0, today = ymdLocal(now);
      h.en.forEach(function (e, i) { if (e && e.id) byId[e.id] = i; });
      steps.forEach(function (x) {
        if (!x || typeof x.d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.d)) return;
        var n = Math.round(+x.n || 0);
        if (n < 1 || n > 200000) return;
        var id = "hc-st-" + x.d.replace(/-/g, "");
        var i = byId[id], old = i === undefined ? null : h.en[i];
        if (old && old.v && old.v[0] === n) return;
        if ((ht["en:" + id] || 0) >= (old ? old.m : 0) && ("en:" + id) in ht) return;
        var row = { id: id, m: now, t: "st", at: x.d === today ? now : localMs(x.d, "23:59"), v: [n],
                    c: 0, a: 0, p: 0, n: "", g: [] };
        if (old) h.en[i] = row; else { byId[id] = h.en.length; h.en.push(row); }
        ch++;
      });
      // Readings other apps put in Health Connect (v6): one Health
      // reading each, id "hc-<kind>-<hex of its Health Connect id>",
      // added once (an edit in orOS stays), never over a deletion.
      vitals.forEach(function (x) {
        var v = vitalRow(x);
        if (!v) return;
        var id = "hc-" + x.k + "-" + hcHex(x.ref, 32);
        if (id.length < 3 + x.k.length + 1 + 16 || id in byId || ("en:" + id) in ht) return;
        byId[id] = h.en.length;
        h.en.push({ id: id, m: now, t: x.k, at: Math.round(x.at), v: v.v, c: v.c, a: v.a, p: v.p, n: "", g: [] });
        ch++;
      });
      if (ch) { h.en.sort(function (a, b) { return a.id < b.id ? -1 : 1; }); res.health = h; }
    }
    return res;
  }

  var api = { contactRows: contactRows, eventRows: eventRows, feedRows: feedRows, rrule: rrule, hash: fnv,
              applyCalendarChanges: applyCalendarChanges, eventIn: eventIn,
              applyContactChanges: applyContactChanges, splitTaken: splitTaken, takenKey: takenKey,
              reminderRows: reminderRows, widgetData: widgetData, agendaData: agendaData, tickTask: tickTask,
              healthOut: healthOut, healthIn: healthIn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document || !root.addEventListener) return;

  /* ---------- bridge (browser only) ---------- */
  // "Add to orOS" from other Android apps (BR-PHONE v2): the app opens
  // /?phone-add=<json> for a new event ({k:"event", date, start, end,
  // dateEnd, title, location, note}) or a .ics / .vcf ({k:"ics"|"vcf",
  // name, text}; a contact from a dialer or messenger comes as a vCard).
  // The parameter leaves the address bar at once; it is handed over
  // when the shell has loaded its apps (ready()).
  // A tap on a reminder the app rang opens /?phone-open=<deepLink>
  // (the shell's notification deep links, e.g. "todo:<list>").
  // The home-screen widget (v4) opens /?phone-quick=<word>: one of
  // QUICK below, nothing else. "cmd" (K3) opens the shell's command
  // bar (BR-CMD) instead of an app, "event" a new Calendar event today.
  // A tick on the To-Do widget of a repeating task opens
  // /?phone-done=<list>/<item>: To-Do ticks it with its own tick, as
  // Today's "Done" does (v7).
  var QUICK = {
    today: ["today", null],
    calendar: ["calendar", null],
    todo: ["todo", null],
    event: ["", "event"],
    cmd: ["", null],
    task: ["todo", { quickAdd: true }],
    water: ["water", { sip: "glass" }],
    note: ["notes", { newPage: true }]
  };
  var phoneAdd = null, phoneOpen = null, phoneQuick = null, phoneDone = null;
  try {
    var qs = new URLSearchParams(root.location.search);
    if (qs.has("phone-add") || qs.has("phone-open") || qs.has("phone-quick") || qs.has("phone-done")) {
      var pd = String(qs.get("phone-done") || "").split("/");
      if (pd.length === 2 && ID_RE.test(pd[0]) && ID_RE.test(pd[1])) phoneDone = { list: pd[0], item: pd[1] };
      try { if (qs.has("phone-add")) phoneAdd = JSON.parse(qs.get("phone-add")); } catch (e) {}
      if (qs.has("phone-open")) phoneOpen = str(qs.get("phone-open"), 200);
      if (Object.prototype.hasOwnProperty.call(QUICK, qs.get("phone-quick"))) phoneQuick = QUICK[qs.get("phone-quick")];
      qs.delete("phone-add");
      qs.delete("phone-open");
      qs.delete("phone-quick");
      qs.delete("phone-done");
      var rest = qs.toString();
      root.history.replaceState(null, "", root.location.pathname + (rest ? "?" + rest : "") + root.location.hash);
    }
  } catch (e) {}
  function deliverAdd(a) {
    if (!a || typeof a !== "object") return;
    var name = str(a.name, 120) || (a.k === "ics" ? "event.ics" : "contact.vcf");
    if (a.k === "event" && typeof root.__orosOpenCalendarNew === "function") {
      root.__orosOpenCalendarNew({ date: a.date, start: a.start || undefined, end: a.end || undefined,
        dateEnd: a.dateEnd || undefined, title: str(a.title, 80), location: str(a.location, 150), note: str(a.note, 500) });
    } else if ((a.k === "ics" || a.k === "vcf") && typeof a.text === "string" && a.text.length < 5000000 &&
               typeof root.__orosOpenAt === "function") {
      if (a.k === "ics") root.__orosOpenAt("calendar", { importIcs: { name: name, text: a.text } });
      else root.__orosOpenAt("contacts", { importVcf: { name: name, text: a.text } });
    }
  }

  var port = null, appState = null, seq = 0, lastSent = {}, listeners = [], timer = null;
  var afKeys = null;   // PW-AF2: {idx, names} public keys from the app, this page only

  function prefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      return p && typeof p === "object" ? p : {};
    } catch (e) { return {}; }
  }
  function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function send(obj) {
    if (!port) return false;
    try { port.postMessage(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function zone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  }
  function readBlob(kind) {
    try { return JSON.parse(localStorage.getItem(KEYS[kind]) || "null"); } catch (e) { return null; }
  }

  // Send a kind when it is on, allowed by Android, and changed since
  // the last send in this page (the app diffs again, row by row).
  function push(kind, force) {
    if (!lateOk()) return;                      // BOOT-L1: the cores are not in yet
    var p = prefs();
    if (!port || !appState || !p[kind] || appState[kind] !== "granted") return;
    var raw = "";
    try {
      raw = localStorage.getItem(KEYS[kind]) || "";
      if (kind === "calendar") raw += "\n" + (localStorage.getItem(FEEDS_KEY) || "");
    } catch (e) { return; }
    var key = fnv(raw) + ":" + raw.length + ":" + zone();
    if (!force && lastSent[kind] === key) return;
    var blob = readBlob(kind), items;
    if (kind === "contacts") items = contactRows(blob);
    else {
      var feeds = null;
      try { feeds = JSON.parse(localStorage.getItem(FEEDS_KEY) || "null"); } catch (e) {}
      items = eventRows(blob, zone()).concat(feedRows(feeds, zone()));
    }
    if (send({ t: kind, seq: ++seq, items: items })) lastSent[kind] = key;
  }
  // BOOT-L1: the reminder, Today and Health rows need app cores from the
  // shell's late bundle. Until it is in, nothing is handed to Android
  // (a list without them would cancel reminders there); then all at once.
  function lateOk() {
    var L = root && root.orosLate;
    if (L) return !!L.done;
    try { return !(root && root.document && root.document.querySelector("template[data-oros-late]")); } catch (e) { return true; }
  }
  if (root && typeof root.addEventListener === "function") root.addEventListener("oros:late-ready", function () { pushAll(false); });
  function pushAll(force) { push("contacts", force); push("calendar", force); pushReminders(force); pushToday(force); pushAgenda(force); pushHealth(force); }

  // Health Connect (v5): the last 30 days of Water and Workouts, sent
  // when they changed and every 15 minutes while orOS is on screen;
  // the app answers with what other apps put in Health Connect
  // ({t:"health-in"}), so steps follow the day.
  function healthOk() { return appState && (appState.health === "granted" || appState.health === "some"); }
  function pushHealth(force) {
    if (!lateOk()) return;                      // BOOT-L1: the cores are not in yet
    if (!port || !prefs().health || !healthOk()) return;
    var now = Date.now(), raw = "";
    try { raw = localStorage.getItem(HEALTH_KEYS.water) + "\n" + localStorage.getItem(HEALTH_KEYS.fitness); } catch (e) { return; }
    var key = fnv(raw) + ":" + raw.length + ":" + Math.floor(now / 900000);
    if (!force && lastSent.health === key) return;
    var water = null, fit = null;
    try {
      var W = root.orosWaterCore;
      water = W && W.parse ? W.parse(localStorage.getItem(HEALTH_KEYS.water)) : JSON.parse(localStorage.getItem(HEALTH_KEYS.water) || "null");
    } catch (e) {}
    try { fit = JSON.parse(localStorage.getItem(HEALTH_KEYS.fitness) || "null"); } catch (e) {}
    var o = healthOut(water, fit, now);
    if (send({ t: "health", seq: ++seq, since: o.since, water: o.water, workouts: o.workouts })) lastSent.health = key;
  }
  // An app that is open holds its data in memory and would write over
  // ours: what is for it waits until it closes (the next answer).
  function appOpen(id) {
    var open = false;
    Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
      if ((f.getAttribute("src") || "").indexOf("/" + id + "/") >= 0) open = true;
    });
    return open;
  }
  function takeHealth(m) {
    if (!prefs().health) return;
    var blobs = {}, now = Date.now(), W = root.orosWaterCore;
    Object.keys(HEALTH_KEYS).forEach(function (k) {
      if (appOpen(k)) return;
      try {
        var raw = localStorage.getItem(HEALTH_KEYS[k]);
        blobs[k] = k === "water" && W && W.parse ? W.parse(raw) : JSON.parse(raw || "null");
      } catch (e) { blobs[k] = null; }
    });
    var res = healthIn(blobs, {
      water: "water" in blobs ? m.water : [],
      workouts: "fitness" in blobs ? m.workouts : [],
      steps: "health" in blobs ? m.steps : [],
      vitals: "health" in blobs ? m.vitals : []
    }, now, hcKinds());
    var wrote = false;
    try {
      if (res.water) {
        var W = root.orosWaterCore, w = W && W.parse ? W.parse(JSON.stringify(res.water)) : res.water;
        localStorage.setItem(HEALTH_KEYS.water, JSON.stringify(w));
        wrote = true;
      }
      if (res.fitness) { localStorage.setItem(HEALTH_KEYS.fitness, JSON.stringify(res.fitness)); wrote = true; }
      if (res.health) {
        var H = root.OrosHealthCore, h = H && H.merge ? H.merge(H.emptyData(), res.health) : res.health;
        localStorage.setItem(HEALTH_KEYS.health, JSON.stringify(h));
        wrote = true;
      }
    } catch (e) { return; }
    if (wrote) { try { if (root.orosSync && root.orosSync.markDirty) root.orosSync.markDirty(); } catch (e) {} }
    var p = prefs();
    p.healthIn = { at: now, steps: (m.steps || []).length, water: (m.water || []).length, workouts: (m.workouts || []).length,
                   vitals: Array.isArray(m.vitals) ? m.vitals.length : 0 };
    savePrefs(p);
    emit();
  }

  // Home-screen widget (v4): only while the phone has one (the app's
  // state says how many), at most once a minute unless forced, and
  // only when the rows changed.
  var todayAt = 0, todayBusy = false;
  function pushToday(force) {
    if (!lateOk()) return;                      // BOOT-L1: the cores are not in yet
    var T = root.orosToday, now = Date.now();
    if (!port || !appState || !(appState.widgets > 0) || todayBusy) return;
    if (!T || typeof T.build !== "function") return;
    if (!force && now - todayAt < 60000) return;
    todayAt = now;
    todayBusy = true;
    T.build().then(function (sum) {
      todayBusy = false;
      var data = widgetData(sum), key = fnv(JSON.stringify(data));
      if (!force && lastSent.today === key) return;
      if (send({ t: "today", seq: ++seq, data: data })) lastSent.today = key;
    }, function () { todayBusy = false; });
  }

  // Calendar and To-Do widgets (v7): only while the phone has one,
  // like the Today widget (at most once a minute unless forced, only
  // when the rows changed). Each kind is read only when its widget is
  // placed; the other one goes as null and the app keeps what it had.
  var agendaAt = 0, agendaBusy = false;
  function pushAgenda(force) {
    if (!lateOk()) return;                      // BOOT-L1: the cores are not in yet
    var T = root.orosToday, now = Date.now();
    if (!port || !appState || !(appState.wcal > 0 || appState.wtodo > 0) || agendaBusy) return;
    if (!T || typeof T.agenda !== "function") return;
    if (!force && now - agendaAt < 60000) return;
    agendaAt = now;
    agendaBusy = true;
    var wantCal = appState.wcal > 0, wantTodo = appState.wtodo > 0;
    function rows(on, id, days) { return on ? T.agenda(id, days).then(null, function () { return []; }) : Promise.resolve(null); }
    Promise.all([rows(wantCal, "calendar", CAL_DAYS), rows(wantTodo, "todo", TODO_DAYS)]).then(function (r) {
      agendaBusy = false;
      var blob = null;
      try { if (wantTodo) blob = JSON.parse(localStorage.getItem("oros-todo-data") || "null"); } catch (e) {}
      var data = agendaData(r[0], r[1], blob), key = fnv(JSON.stringify(data));
      if (!force && lastSent.agenda === key) return;
      if (send({ t: "agenda", seq: ++seq, cal: data.cal, todo: data.todo })) lastSent.agenda = key;
    }, function () { agendaBusy = false; });
  }

  // Ticks from the To-Do widget (v7). The app sends them again on
  // every new channel until they are answered, so each is applied at
  // most once (tickTask leaves a done task alone). To-Do open in a
  // frame holds its data in memory: the tick then goes to it, through
  // the same { done } Today's "Done" uses; closed, the tick is written
  // to its stored copy, which sync pushes like any local change.
  function todoFrame() {
    var out = null;
    Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
      try {
        if (!out && f.contentWindow && /\/todo\//.test(f.contentWindow.location.pathname) &&
            typeof f.contentWindow.__orosOpenAt === "function") out = f.contentWindow;
      } catch (e) {}
    });
    return out;
  }
  function takeTicks(items) {
    var refs = [], blob = null, wrote = false, now = Date.now(), frame = todoFrame();
    try { blob = JSON.parse(localStorage.getItem("oros-todo-data") || "null"); } catch (e) { return; }
    items.slice(0, 200).forEach(function (x) {
      if (!x || typeof x.ref !== "string" || x.ref.length > 200) return;
      refs.push(x.ref);
      if (typeof x.l !== "string" || typeof x.i !== "string" || !ID_RE.test(x.l) || !ID_RE.test(x.i)) return;
      var at = typeof x.at === "number" && x.at > 0 ? Math.min(x.at, now) : now;
      if (frame) {
        try { frame.__orosOpenAt({ done: { list: x.l, item: x.i } }); } catch (e) {}
        return;
      }
      var r = tickTask(blob, x.l, x.i, at, now);
      if (r.res === "done") wrote = true;
    });
    if (wrote) {
      try { localStorage.setItem("oros-todo-data", JSON.stringify(blob)); } catch (e) { return; }
      try { if (root.orosSync && root.orosSync.markDirty) root.orosSync.markDirty(); } catch (e) {}
    }
    send({ t: "applied", what: "ticks", refs: refs });
    if (wrote || frame) { setTimeout(function () { pushAgenda(true); pushToday(true); pushReminders(false); }, frame ? 1500 : 0); }
  }

  // PW-AF3: logins the person asked Android to save in orOS. They go
  // to Passwords through the shell (memory only), which opens each one
  // in its editor; nothing is stored until Save is pressed there.
  function takeSaves(items) {
    var refs = [];
    items.slice(0, 10).forEach(function (x) {
      if (!x || typeof x.ref !== "string" || x.ref.length > 100) return;
      if (typeof root.__orosPwSave !== "function") return;   // the shell is not ready: the app sends it again
      try { root.__orosPwSave({ url: x.url, app: x.app, user: x.user, pw: x.pw, title: x.title }); } catch (e) {}
      refs.push(x.ref);
    });
    if (refs.length) send({ t: "applied", what: "af-save", refs: refs });
  }

  // Reminders (v3): the next 48 hours, worked out here from the
  // same data and rules as the shell's engines, rung by the app.
  // Reminders the shell already showed (in its inbox) are left out.
  // HANDLED_KEY (this device) lists what the app was given, so the
  // shell leaves those to it: no second OS notification, and no late
  // ring of a Clock alarm the phone already rang.
  function reminderSource() {
    var alarms = [], water = null, todo = null, T = root.t;
    try { alarms = JSON.parse(localStorage.getItem("oros-alarms") || "[]"); } catch (e) {}
    try {
      var W = root.orosWaterCore;
      if (W && W.parse) water = { core: W, data: W.parse(localStorage.getItem(W.STORAGE_KEY)) };
    } catch (e) {}
    try {
      if (root.OrosTodoCore) todo = { core: root.OrosTodoCore, data: JSON.parse(localStorage.getItem("oros-todo-data") || "null") };
    } catch (e) {}
    var habits = null;
    try {
      if (root.OrosHabitsCore) habits = { core: root.OrosHabitsCore, data: JSON.parse(localStorage.getItem("oros-habits-data") || "null") };
    } catch (e) {}
    var health = null;
    try {
      if (root.OrosHealthCore) health = { core: root.OrosHealthCore, data: JSON.parse(localStorage.getItem("oros-health-data") || "null") };
    } catch (e) {}
    function tr(k, d) { var v = typeof T === "function" ? T(k) : ""; return v && v !== k ? v : d; }
    var lang = (document.documentElement.lang || "en").slice(0, 2);
    return { alarms: alarms, water: water, todo: todo, habits: habits, health: health, lang: lang,
             alarmTitle: tr("alarm.title", ""), todoTitle: tr("app.todo", "To-Do"),
             habitsTitle: tr("app.habits", "Habits"),
             healthTitle: tr("app.health", "Health") };
  }
  // Calendar reminders ring here, whether or not the events are also
  // copied to the phone's Calendar (the copies carry no reminder).
  function calendarReminders(now) {
    var P = root.orosPush;
    if (!P || typeof P.calendarRows !== "function") return [];
    var data = null;
    try { data = JSON.parse(localStorage.getItem(KEYS.calendar) || "null"); } catch (e) {}
    try { return P.calendarRows(data, OCC(), now, now + REM_HOURS * 3600000, (document.documentElement.lang || "en").slice(0, 2)); }
    catch (e) { return []; }
  }
  function pushReminders(force) {
    if (!lateOk()) return;                      // BOOT-L1: the cores are not in yet
    var p = prefs();
    if (!port || !appState || !p.reminders || appState.reminders !== "granted") return;
    var now = Date.now(), raw = "";
    try {
      raw = [localStorage.getItem("oros-alarms"), localStorage.getItem("oros-water-data"),
             localStorage.getItem("oros-todo-data"), localStorage.getItem("oros-notifs"),
             localStorage.getItem("oros-habits-data"), localStorage.getItem("oros-calendar-data"),
             localStorage.getItem("oros-health-data")].join("\n");
    } catch (e) { return; }
    // Water rows depend on the hour too: recheck every 5 minutes.
    var key = fnv(raw) + ":" + raw.length + ":" + Math.floor(now / 300000) + ":" + zone();
    if (!force && lastSent.reminders === key) return;
    var shown = {};
    try {
      var N = root.orosNotifs, sl = N && N.getSlice && N.getSlice();
      (sl && Array.isArray(sl.items) ? sl.items : []).forEach(function (it) { if (it && it.dedupKey) shown[it.dedupKey] = 1; });
    } catch (e) {}
    var items = reminderRows(reminderSource(), now).concat(calendarReminders(now))
      .filter(function (r) { return !shown[r.id]; })
      .sort(function (a, b) { return a.at - b.at; }).slice(0, 100);
    if (!send({ t: "reminders", seq: ++seq, items: items })) return;
    lastSent.reminders = key;
    // Settings shows the next one, so a missing reminder can be told apart from a muted one.
    var q = prefs(), cal = items.filter(function (r) { return r.ns === "calendar"; });
    q.remNext = items.length ? { t: String(items[0].title || "").slice(0, 80), at: items[0].at } : null;
    q.remCal = cal.length;
    savePrefs(q);
    var h = handled(), keep = {};
    Object.keys(h).forEach(function (id) { if (h[id] > now - 2 * 86400000) keep[id] = h[id]; });
    items.forEach(function (r) { keep[r.id] = r.at; });
    try { localStorage.setItem(HANDLED_KEY, JSON.stringify(keep)); } catch (e) {}
  }
  function handled() {
    try {
      var h = JSON.parse(localStorage.getItem(HANDLED_KEY) || "{}");
      return h && typeof h === "object" ? h : {};
    } catch (e) { return {}; }
  }

  function onAppMessage(ev) {
    var m = null;
    try { m = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "state") {
      appState = {
        contacts: m.contacts === "granted" ? "granted" : (m.contacts === "denied" ? "denied" : "ask"),
        calendar: m.calendar === "granted" ? "granted" : (m.calendar === "denied" ? "denied" : "ask"),
        reminders: m.reminders === "granted" ? "granted" : (m.reminders === "denied" ? "denied" : (m.reminders === "ask" ? "ask" : "")),
        exact: m.exact === true,
        widgets: Math.max(0, Math.min(50, m.widgets | 0)),
        wcal: Math.max(0, Math.min(50, m.wcal | 0)),
        wtodo: Math.max(0, Math.min(50, m.wtodo | 0)),
        health: ["granted", "some", "ask", "denied", "update", "unavailable"].indexOf(m.health) >= 0 ? m.health : "",
        drive: m.drive === true,
        app: typeof m.app === "string" ? m.app.slice(0, 20) : "",
        af: afState(m.af)
      };
      emit();
      pushAll(true);
    } else if (m.t === "af-keys") {
      var k1 = typeof m.idx === "string" ? m.idx : "", k2 = typeof m.names === "string" ? m.names : "";
      var B64 = /^[A-Za-z0-9+/]+={0,2}$/;
      afKeys = B64.test(k1) && B64.test(k2) && k1.length < 1200 && k2.length < 1200 && k1 !== k2 ? { idx: k1, names: k2 } : null;
      if (appState) appState.af = afState(m.af);
      emit();
    } else if (m.t === "done" && m.what === "af-index") {
      if (appState) appState.af = afState(m.af);
      emit();
    } else if (m.t === "error" && m.what === "af-index") {
      if (appState && appState.af) appState.af.err = String(m.msg || "error").slice(0, 120);
      emit();
    } else if (m.t === "health-in") {
      takeHealth(m);
    } else if (m.t === "ticks" && Array.isArray(m.items)) {
      takeTicks(m.items);
    } else if (m.t === "af-save" && Array.isArray(m.items)) {
      takeSaves(m.items);
    } else if (m.t === "changes" && (m.what === "calendar" || m.what === "contacts") && Array.isArray(m.items)) {
      takeChanges(m.what, m.items);
    } else if ((m.t === "done" || m.t === "error") && (m.what === "contacts" || m.what === "calendar" || m.what === "reminders" || m.what === "health")) {
      var p = prefs();
      p[m.what + "At"] = Date.now();
      p[m.what + "Err"] = m.t === "error" ? String(m.msg || "error").slice(0, 120) : "";
      if (m.t === "done") p[m.what + "N"] = (m.added | 0) + (m.updated | 0) + (m.kept | 0);
      savePrefs(p);
      if (m.t === "error") lastSent[m.what] = null;
      emit();
    }
  }

  // PW-AF2: what the app says about Passwords autofill on this phone.
  function afState(a) {
    if (!a || typeof a !== "object") return null;
    return { svc: a.svc === true, keys: a.keys === true, stored: a.stored === true,
             at: typeof a.at === "number" && a.at > 0 ? a.at : 0, err: "" };
  }

  // Phone → orOS: Calendar / Contacts is the data's writer when it is
  // open, so an open app reloads after the write (frames expose
  // __orosPhoneReload); closed, the write plus markDirty is what its
  // sync slice (a localStorage proxy) pushes, like any local change.
  // The app sends the same dirty rows again until it has our answer
  // (after each snapshot and each state), so one change can arrive
  // two or three times. Each one is applied once: TAKEN_KEY (this
  // device only) remembers recent changes by kind + content hash, and
  // a repeat is only answered again, with the id it got the first time.
  function takeChanges(kind, items) {
    if (!prefs()[kind]) return;
    var taken = readTaken();
    var now = Date.now();
    taken = taken.filter(function (x) { return now - (+x[2] || 0) < TAKEN_MS; });
    var split = splitTaken(kind, items, taken, now);
    var res = { refs: [], ids: null };
    if (split.fresh.length) {
      try {
        res = kind === "contacts" ? applyContactChanges(readBlob(kind), split.fresh, now)
                                  : applyCalendarChanges(readBlob(kind), split.fresh, now);
        localStorage.setItem(KEYS[kind], JSON.stringify(res.blob));
      } catch (e) { return; }
      split.fresh.forEach(function (c) {
        taken.push([takenKey(kind, c), (res.ids && res.ids[c.ref]) || "", now]);
      });
      try { localStorage.setItem(TAKEN_KEY, JSON.stringify(taken.slice(-MAX_TAKEN))); } catch (e) {}
      try { if (root.orosSync && root.orosSync.markDirty) root.orosSync.markDirty(); } catch (e) {}
      Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
        try { if (f.contentWindow && typeof f.contentWindow.__orosPhoneReload === "function") f.contentWindow.__orosPhoneReload(kind); } catch (e) {}
      });
    }
    var refs = split.refs.concat(res.refs);
    var ids = Object.assign({}, split.ids, res.ids || {});
    send(kind === "contacts" ? { t: "applied", what: kind, refs: refs, ids: ids } : { t: "applied", what: kind, refs: refs });
    if (split.fresh.length) push(kind, true);
  }
  function readTaken() {
    try {
      var t = JSON.parse(localStorage.getItem(TAKEN_KEY) || "[]");
      return Array.isArray(t) ? t.filter(function (x) { return Array.isArray(x) && typeof x[0] === "string"; }) : [];
    } catch (e) { return []; }
  }

  // The app's first message carries the port. Chromium posts it to the
  // main frame from the browser itself, with no source window; what it
  // puts in ev.origin differs between browsers and versions (seen: the
  // relationship check passes, the port arrives, but not with this
  // origin), so a source-less port is accepted from any origin. Frames
  // and other windows always have a source, so they never pass; a port
  // posted by this window to itself must carry this origin.
  // A newer port replaces the older one: the app opens a new channel
  // when it is launched again while this page stays loaded.
  root.addEventListener("message", function (ev) {
    if (!ev.ports || !ev.ports[0]) return;
    var o = ev.origin;
    if (ev.source ? (ev.source !== root || o !== root.location.origin) : false) {
      console.warn("[phone] port from " + o + " ignored");
      return;
    }
    if (port) { try { port.onmessage = null; port.close(); } catch (e) {} }
    port = ev.ports[0];
    lastSent = {};
    port.onmessage = onAppMessage;
    // "o" is diagnostics only: what this browser reports as the origin.
    send({ t: "state", o: String(o).slice(0, 80) });
    send({ t: "seen", v: !document.hidden });
    emit();
    if (!timer) {
      // "seen" tells the app orOS is on screen: it then leaves the
      // reminders to the page, which shows its own.
      timer = setInterval(function () { if (!document.hidden) { pushAll(false); send({ t: "seen", v: true }); } }, 15000);
      // Back on screen: send what changed here, and ask the app for
      // what changed on the phone meanwhile (it answers state + changes).
      document.addEventListener("visibilitychange", function () {
        send({ t: "seen", v: !document.hidden });
        if (!document.hidden) { pushAll(false); send({ t: "state" }); }
        // leaving: the widget gets the latest, and so do the reminders
        // (a timer or alarm set in the last 15 s must reach the app)
        else { todayAt = 0; agendaAt = 0; pushToday(false); pushAgenda(false); pushReminders(false); }
      });
    }
  });

  root.orosPhone = {
    ready: function () {
      var a = phoneAdd; phoneAdd = null; deliverAdd(a);
      var o = phoneOpen; phoneOpen = null;
      if (o && root.orosNotifs && typeof root.orosNotifs.openLink === "function") root.orosNotifs.openLink(o);
      var q = phoneQuick; phoneQuick = null;
      if (q && !q[0] && q[1] === "event") {
        if (typeof root.__orosOpenCalendarNew === "function") root.__orosOpenCalendarNew({ date: ymdLocal(Date.now()) });
      } else if (q && !q[0]) { if (typeof root.__orosOpenCmdBar === "function") root.__orosOpenCmdBar(); }
      else if (q && typeof root.__orosOpenAt === "function") root.__orosOpenAt(q[0], q[1]);
      var dn = phoneDone; phoneDone = null;
      if (dn && typeof root.__orosOpenAt === "function") root.__orosOpenAt("todo", { done: dn });
    },
    // The same reminder rows, for Web Push (webpush.js): a longer
    // horizon, rung by the browser's push service instead of the app.
    reminderRows: function (now, hours, max) {
      var src = reminderSource();
      src.hours = hours; src.max = max;
      return reminderRows(src, now);
    },
    // True when the app was given this reminder (shell dedupKey): the
    // shell then shows it in orOS only, never as a second OS one.
    handles: function (dedupKey) { return !!prefs().reminders && typeof dedupKey === "string" && dedupKey in handled(); },
    available: function () { return !!port; },
    healthInfo: function () { return prefs().healthIn || null; },
    state: function () { return appState; },
    enabled: function (kind) { return !!prefs()[kind]; },
    lastSync: function (kind) {
      var p = prefs(), o = { at: p[kind + "At"] || 0, n: p[kind + "N"] || 0, err: p[kind + "Err"] || "" };
      if (kind === "reminders") { o.next = p.remNext || null; o.cal = p.remCal | 0; }
      return o;
    },
    setEnabled: function (kind, on) {
      if (!KEYS[kind] && kind !== "reminders" && kind !== "health") return;
      var p = prefs();
      p[kind] = !!on;
      savePrefs(p);
      lastSent[kind] = null;
      if (kind === "reminders" && !on) { try { localStorage.removeItem(HANDLED_KEY); } catch (e) {} }
      if (on) { if (kind === "reminders") pushReminders(true); else if (kind === "health") pushHealth(true); else push(kind, true); }
      else send({ t: "clear", what: kind });
      emit();
    },
    // Must run inside a click: Chrome opens the app's permission screen
    // for an intent: link only on a user gesture. The app answers with
    // a fresh {t:"state"} when the person comes back.
    askPermission: function (kind) {
      if (!port || !PERM_URL[kind]) return;
      root.location.href = PERM_URL[kind];
    },
    refresh: function () { send({ t: "state" }); },
    // Passwords autofill (PW-AF2). The Passwords app seals its lists
    // with the keys from afKeys() (passwords/afindex.js) and hands them
    // over; this file never sees a value.
    afInfo: function () { return appState && appState.af ? appState.af : null; },
    afKeys: function () { return afKeys; },
    afAskKeys: function () { return send({ t: "af-keys" }); },
    afSend: function (sealed) {
      if (!sealed || !sealed.idx || !sealed.names) return false;
      return send({ t: "af-index", seq: ++seq, idx: sealed.idx, names: sealed.names, at: Date.now() });
    },
    afClear: function () { afKeys = null; return send({ t: "clear", what: "af" }); },
    // Must run inside a click (an intent: link, like askPermission).
    afSettings: function () { if (port) root.location.href = PERM_URL.autofill; },
    // Returns an "off" function: an app frame calls it when it closes.
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
})(typeof window !== "undefined" ? window : null);
