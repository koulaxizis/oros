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
//   app → page: {t:"state", v, contacts, calendar, app}
//               {t:"changes", what, items}   (v2: edits made on the phone)
//               {t:"done", what, seq, added, updated, removed}
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
                   reminders: "intent://reminders#Intent;scheme=oros-permission;package=online.useoros.twa;end" };
  var MAX_PHOTO = 70000;          // base64 characters

  /* ---------- pure helpers ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function str(v, max) { return (typeof v === "string" ? v : "").slice(0, max); }
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
    var rows = [];
    (Array.isArray(blob && blob.contacts) ? blob.contacts : []).forEach(function (c) {
      if (!c || typeof c.id !== "string" || !c.id || !alive(c, dead)) return;
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
        note: str(c.note, 500),
        starred: c.starred === true,
        photo: null
      };
      var m = typeof c.photo === "string" && c.photo.match(/^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+\/=]+)$/);
      if (m && m[1].length <= MAX_PHOTO) row.photo = m[1];
      if (!(row.given || row.family || row.nickname || row.org || row.phones.length || row.emails.length)) return;
      rows.push(withHash(row));
    });
    rows.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return rows;
  }

  // Calendar → Android CalendarContract fields. Times are computed in
  // the page's local zone, which is the phone's zone (same device).
  var FREQ = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
  var REMIND = [5, 15, 30, 60, 1440, 4320, 7200];
  function parts(ymd) { var p = ymd.split("-"); return [+p[0], +p[1] - 1, +p[2]]; }
  function hm(s) { var p = (s || "00:00").split(":"); return [+p[0], +p[1]]; }
  function localMs(ymd, time) {
    var d = parts(ymd), t = hm(time);
    return new Date(d[0], d[1], d[2], t[0], t[1]).getTime();
  }
  function utcMidnight(ymd, addDays) {
    var d = parts(ymd);
    return Date.UTC(d[0], d[1], d[2] + (addDays || 0));
  }
  function utcStamp(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }
  // The Calendar's monthly / yearly rule clamps to the month's last
  // day (Jan 31 → Feb 28 → Mar 31). RFC 5545 skips such months
  // instead, so days 29-31 become "the last of 28…day" (BYSETPOS=-1).
  function rrule(e) {
    var r = e.recur;
    if (!r || !FREQ[r.freq]) return null;
    var s = "FREQ=" + FREQ[r.freq];
    if (r.freq === "W" && r.interval === 2) s += ";INTERVAL=2";
    var p = parts(e.date), day = p[2];
    if (r.freq === "M" && day > 28) {
      var ds = [];
      for (var d = 28; d <= day; d++) ds.push(d);
      s += ";BYMONTHDAY=" + ds.join(",") + ";BYSETPOS=-1";
    } else if (r.freq === "Y" && p[1] === 1 && day === 29) {
      s += ";BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1";
    }
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
      var rule = rrule(e);
      var row = {
        id: e.id.slice(0, 64),
        title: str(e.title, 80), desc: str(e.note, 500), loc: str(e.location, 150),
        allDay: !timed,
        dtstart: timed ? localMs(e.date, e.start) : utcMidnight(e.date),
        dtend: null, duration: null,
        tz: timed ? (tz || "UTC") : "UTC",
        rrule: rule, exdate: null,
        remind: typeof e.remindMin === "number" && REMIND.indexOf(e.remindMin) !== -1 ? e.remindMin : null,
        color: colors[e.labelId] || null
      };
      if (rule) {
        // Series: Android wants DURATION, never DTEND.
        var mins = 0;
        if (timed && end && end > e.start) {
          var a = hm(e.start), b = hm(end);
          mins = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
        }
        row.duration = timed ? "P" + (mins * 60) + "S" : "P1D";
        var ex = (e.recur.exdates || []).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
        if (ex.length) {
          row.exdate = ex.map(function (d) {
            return utcStamp(timed ? localMs(d, e.start) : utcMidnight(d));
          }).join(",");
        }
      } else if (timed) {
        var endDay = dateEnd || e.date;
        var endMs = localMs(endDay, end || (dateEnd ? "00:00" : e.start));
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
  function ymdLocal(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymdUtc(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function hmLocal(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function isoSecs(s) {          // "P3600S", "PT1H30M", "P1D", "P1W" → seconds
    var m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || "").replace(/^\+/, ""));
    if (!m) { var n = /^P(\d+)S$/.exec(String(s || "")); return n ? +n[1] : 0; }
    return (+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0);
  }
  var FREQ_IN = { DAILY: "D", WEEKLY: "W", MONTHLY: "M", YEARLY: "Y" };
  function stampDay(s, allDay) {  // "20261014" / "20261014T183000Z" → local YMD
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(String(s || "").trim());
    if (!m) return null;
    if (!m[4] || allDay) return m[1] + "-" + m[2] + "-" + m[3];
    var ms = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
                  : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return ymdLocal(ms);
  }
  // Android RRULE → the Calendar's recur (FREQ, INTERVAL 2 only weekly,
  // UNTIL). What orOS cannot express (BYDAY lists, COUNT) is dropped.
  function recurIn(rule, exdate, allDay) {
    if (!rule) return null;
    var p = {};
    String(rule).split(";").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
    var f = FREQ_IN[p.FREQ];
    if (!f) return null;
    var r = { freq: f, interval: f === "W" && p.INTERVAL === "2" ? 2 : 1, until: p.UNTIL ? stampDay(p.UNTIL, allDay) : null, exdates: [] };
    String(exdate || "").split(/[,\n]/).forEach(function (x) {
      var d = stampDay(x.replace(/^.*:/, ""), allDay);
      if (d && r.exdates.indexOf(d) === -1) r.exdates.push(d);
    });
    r.exdates.sort();
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
  function eventIn(c) {
    var allDay = !!c.allDay, start = +c.dtstart;
    if (!isFinite(start)) return null;
    var endMs = isFinite(+c.dtend) && +c.dtend > 0 ? +c.dtend : start + isoSecs(c.duration) * 1000;
    var e = { title: str(c.title, 80), note: str(c.desc, 500), location: str(c.loc, 150),
              date: allDay ? ymdUtc(start) : ymdLocal(start), dateEnd: null, start: null, end: null,
              recur: recurIn(c.rrule, c.exdate, allDay), remindMin: remindIn(c.remind) };
    if (allDay) {
      var last = endMs > start ? ymdUtc(endMs - 86400000) : e.date;
      if (!e.recur && last > e.date) e.dateEnd = last;
    } else {
      e.start = hmLocal(start);
      if (endMs > start) {
        var endDay = ymdLocal(endMs);
        if (endDay === e.date) e.end = hmLocal(endMs);
        else if (!e.recur) { e.dateEnd = endDay; e.end = hmLocal(endMs); }
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
          var s = b.events[si], day = s.start ? ymdLocal(+orig.at) : ymdUtc(+orig.at);
          var ex = (s.recur.exdates || []).slice();
          if (ex.indexOf(day) === -1) ex.push(day);
          ex.sort();
          s.recur = Object.assign({}, s.recur, { exdates: ex });
          s.mtime = now;
          if (c.op !== "delete" && !c.cancelled) {
            var one = eventIn(c);
            if (one) {
              one.recur = null;
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
      var e = eventIn(c);
      if (!e) { refs.push(c.ref); return; }
      if (i !== -1) b.events[i] = Object.assign({}, b.events[i], e, { mtime: now });
      else b.events.push(Object.assign(e, { id: newEventId(now), labelId: null, mtime: now }));
      refs.push(c.ref);
    });
    return { blob: b, refs: refs };
  }

  // Phone → orOS Contacts. Rows come in contactRows' shape (t for
  // type); fields only orOS has (labels, relations, IM, website
  // types) are kept from the stored contact. A phone photo is taken
  // only when orOS has none: the phone stores a re-encoded copy.
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
      note: str(c.note, 500),
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
      // Contacts keeps photos up to 50000 characters as a data URL.
      var m = typeof c.photo === "string" && /^[A-Za-z0-9+\/=]+$/.test(c.photo) && c.photo.length <= 49900
        ? "data:image/" + (c.photo.slice(0, 5) === "iVBOR" ? "png" : "jpeg") + ";base64," + c.photo : null;
      if (old) {
        b.contacts[i] = Object.assign({}, old, n, { mtime: now });
        if (!old.photo && m) b.contacts[i].photo = m;
      } else {
        var id = newEventId(now);
        b.contacts.push(Object.assign({ id: id }, n, {
          im: [], relations: [], labelIds: [],
          photo: m, mtime: now
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
  //   lang: "en" | "el"; alarmTitle / todoTitle: the shell's words
  var REM_HOURS = 48, TODO_HOUR = 9;
  function reminderRows(src, now) {
    src = src || {};
    var el = src.lang === "el", end = now + REM_HOURS * 3600000, rows = [];
    function dayAt(ms, add, h) { var d = new Date(ms); d.setHours(h || 0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); }
    var alarmTitle = str(src.alarmTitle, 60) || (el ? "Ξυπνητήρι" : "Alarm");
    (Array.isArray(src.alarms) ? src.alarms : []).forEach(function (a) {
      if (!a || a.state !== "pending" || typeof a.at !== "number" || !isFinite(a.at) || typeof a.id !== "string") return;
      var t = a.at, guard = 0;
      if (a.repeat === "daily") {
        while (t <= now && guard++ < 4000) { var d = new Date(t); d.setDate(d.getDate() + 1); t = d.getTime(); }
      }
      for (var n = 0; n < 3 && t <= end; n++) {
        if (t > now) rows.push({ id: "time:alarm-" + a.id + "-" + ymdLocal(t), at: t, kind: "alarm", ns: "time",
                                 title: alarmTitle, body: str(a.label, 60) || alarmTitle, link: "time:alarms" });
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
      for (var dd = 0; dd < 3; dd++) {
        var at = dayAt(now, dd, TODO_HOUR);
        if (at <= now || at > end) continue;
        var ymd = ymdLocal(at), sum = T.core.dueSummary(T.data, ymd);
        if (!sum || !sum.count) continue;
        rows.push({ id: "todo:due-" + ymd + "-" + sum.count, at: at, kind: "note", ns: "todo",
                    title: str(src.todoTitle, 60) || "To-Do",
                    body: el ? sum.count + (sum.count === 1 ? " εργασία λήγει ή έχει λήξει" : " εργασίες λήγουν ή έχουν λήξει")
                             : sum.count + (sum.count === 1 ? " task is due or overdue" : " tasks are due or overdue"),
                    link: sum.earliestList ? "todo:" + sum.earliestList : "" });
      }
    }
    rows.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
    return rows.slice(0, 100);
  }

  var api = { contactRows: contactRows, eventRows: eventRows, feedRows: feedRows, rrule: rrule, hash: fnv,
              applyCalendarChanges: applyCalendarChanges, eventIn: eventIn,
              applyContactChanges: applyContactChanges, splitTaken: splitTaken, takenKey: takenKey,
              reminderRows: reminderRows };
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
  var phoneAdd = null, phoneOpen = null;
  try {
    var qs = new URLSearchParams(root.location.search);
    if (qs.has("phone-add") || qs.has("phone-open")) {
      try { if (qs.has("phone-add")) phoneAdd = JSON.parse(qs.get("phone-add")); } catch (e) {}
      if (qs.has("phone-open")) phoneOpen = str(qs.get("phone-open"), 200);
      qs.delete("phone-add");
      qs.delete("phone-open");
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
  function pushAll(force) { push("contacts", force); push("calendar", force); pushReminders(force); }

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
    function tr(k, d) { var v = typeof T === "function" ? T(k) : ""; return v && v !== k ? v : d; }
    var lang = (document.documentElement.lang || "en").slice(0, 2);
    return { alarms: alarms, water: water, todo: todo, lang: lang,
             alarmTitle: tr("alarm.title", ""), todoTitle: tr("app.todo", "To-Do") };
  }
  function pushReminders(force) {
    var p = prefs();
    if (!port || !appState || !p.reminders || appState.reminders !== "granted") return;
    var now = Date.now(), raw = "";
    try {
      raw = [localStorage.getItem("oros-alarms"), localStorage.getItem("oros-water-data"),
             localStorage.getItem("oros-todo-data"), localStorage.getItem("oros-notifs")].join("\n");
    } catch (e) { return; }
    // Water rows depend on the hour too: recheck every 5 minutes.
    var key = fnv(raw) + ":" + raw.length + ":" + Math.floor(now / 300000) + ":" + zone();
    if (!force && lastSent.reminders === key) return;
    var shown = {};
    try {
      var N = root.orosNotifs, sl = N && N.getSlice && N.getSlice();
      (sl && Array.isArray(sl.items) ? sl.items : []).forEach(function (it) { if (it && it.dedupKey) shown[it.dedupKey] = 1; });
    } catch (e) {}
    var items = reminderRows(reminderSource(), now).filter(function (r) { return !shown[r.id]; });
    if (!send({ t: "reminders", seq: ++seq, items: items })) return;
    lastSent.reminders = key;
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
        app: typeof m.app === "string" ? m.app.slice(0, 20) : ""
      };
      emit();
      pushAll(true);
    } else if (m.t === "changes" && (m.what === "calendar" || m.what === "contacts") && Array.isArray(m.items)) {
      takeChanges(m.what, m.items);
    } else if ((m.t === "done" || m.t === "error") && (m.what === "contacts" || m.what === "calendar" || m.what === "reminders")) {
      var p = prefs();
      p[m.what + "At"] = Date.now();
      p[m.what + "Err"] = m.t === "error" ? String(m.msg || "error").slice(0, 120) : "";
      if (m.t === "done") p[m.what + "N"] = (m.added | 0) + (m.updated | 0) + (m.kept | 0);
      savePrefs(p);
      if (m.t === "error") lastSent[m.what] = null;
      emit();
    }
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
      });
    }
  });

  root.orosPhone = {
    ready: function () {
      var a = phoneAdd; phoneAdd = null; deliverAdd(a);
      var o = phoneOpen; phoneOpen = null;
      if (o && root.orosNotifs && typeof root.orosNotifs.openLink === "function") root.orosNotifs.openLink(o);
    },
    // True when the app was given this reminder (shell dedupKey): the
    // shell then shows it in orOS only, never as a second OS one.
    handles: function (dedupKey) { return !!prefs().reminders && typeof dedupKey === "string" && dedupKey in handled(); },
    available: function () { return !!port; },
    state: function () { return appState; },
    enabled: function (kind) { return !!prefs()[kind]; },
    lastSync: function (kind) {
      var p = prefs();
      return { at: p[kind + "At"] || 0, n: p[kind + "N"] || 0, err: p[kind + "Err"] || "" };
    },
    setEnabled: function (kind, on) {
      if (!KEYS[kind] && kind !== "reminders") return;
      var p = prefs();
      p[kind] = !!on;
      savePrefs(p);
      lastSent[kind] = null;
      if (kind === "reminders" && !on) { try { localStorage.removeItem(HANDLED_KEY); } catch (e) {} }
      if (on) { if (kind === "reminders") pushReminders(true); else push(kind, true); }
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
    // Returns an "off" function: an app frame calls it when it closes.
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
})(typeof window !== "undefined" ? window : null);
