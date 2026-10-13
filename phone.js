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
// Direction: orOS → phone, read-only on the phone (the phone shows an
// "orOS" account; edits stay in orOS). Decryption stays in the page:
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
//     dtstart, dtend, duration, tz, rrule, exdate, remind }]
// Messages (JSON strings on the port):
//   page → app: {t:"state"} · {t:"contacts"|"calendar", seq, items}
//               {t:"clear", what}
//   app → page: {t:"state", v, contacts, calendar, app}
//               {t:"done", what, seq, added, updated, removed}
//               {t:"error", what, seq, msg}
// Exposes window.orosPhone and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-phone";
  var KEYS = { contacts: "oros-contacts-data", calendar: "oros-calendar-data" };
  var PERM_URL = { contacts: "intent://contacts#Intent;scheme=oros-permission;package=online.useoros.twa;end",
                   calendar: "intent://calendar#Intent;scheme=oros-permission;package=online.useoros.twa;end" };
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

  function eventRows(blob, tz) {
    var dead = tombIds(blob);
    var rows = [];
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
        remind: typeof e.remindMin === "number" && REMIND.indexOf(e.remindMin) !== -1 ? e.remindMin : null
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

  var api = { contactRows: contactRows, eventRows: eventRows, rrule: rrule, hash: fnv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document || !root.addEventListener) return;

  /* ---------- bridge (browser only) ---------- */
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
    try { raw = localStorage.getItem(KEYS[kind]) || ""; } catch (e) { return; }
    var key = fnv(raw) + ":" + raw.length + ":" + zone();
    if (!force && lastSent[kind] === key) return;
    var blob = readBlob(kind);
    var items = kind === "contacts" ? contactRows(blob) : eventRows(blob, zone());
    if (send({ t: kind, seq: ++seq, items: items })) lastSent[kind] = key;
  }
  function pushAll(force) { push("contacts", force); push("calendar", force); }

  function onAppMessage(ev) {
    var m = null;
    try { m = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "state") {
      appState = {
        contacts: m.contacts === "granted" ? "granted" : (m.contacts === "denied" ? "denied" : "ask"),
        calendar: m.calendar === "granted" ? "granted" : (m.calendar === "denied" ? "denied" : "ask"),
        app: typeof m.app === "string" ? m.app.slice(0, 20) : ""
      };
      emit();
      pushAll(true);
    } else if ((m.t === "done" || m.t === "error") && (m.what === "contacts" || m.what === "calendar")) {
      var p = prefs();
      p[m.what + "At"] = Date.now();
      p[m.what + "Err"] = m.t === "error" ? String(m.msg || "error").slice(0, 120) : "";
      if (m.t === "done") p[m.what + "N"] = (m.added | 0) + (m.updated | 0) + (m.kept | 0);
      savePrefs(p);
      if (m.t === "error") lastSent[m.what] = null;
      emit();
    }
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
    emit();
    if (!timer) {
      timer = setInterval(function () { if (!document.hidden) pushAll(false); }, 15000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) pushAll(false); });
    }
  });

  root.orosPhone = {
    available: function () { return !!port; },
    state: function () { return appState; },
    enabled: function (kind) { return !!prefs()[kind]; },
    lastSync: function (kind) {
      var p = prefs();
      return { at: p[kind + "At"] || 0, n: p[kind + "N"] || 0, err: p[kind + "Err"] || "" };
    },
    setEnabled: function (kind, on) {
      if (!KEYS[kind]) return;
      var p = prefs();
      p[kind] = !!on;
      savePrefs(p);
      lastSent[kind] = null;
      if (on) push(kind, true); else send({ t: "clear", what: kind });
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
