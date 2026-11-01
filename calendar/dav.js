// orOS Calendar — CalDAV mapper (calendar/dav.js), CalDAV wave 3.
//
// Turns one calendar object resource (the .ics text of one item on
// the person's CalDAV server) into the Calendar's own event shape and
// back, for the sync engine (../davsync.js). Pure: no DOM, no
// storage, no network; nothing from the server is executed or shown
// as HTML. Browser: window.OrosCalDav. Node: module.exports
// (tests/calendar-dav.test.js).
//
//   mapper(colUrl, { zone, mark }) → the engine's `map`:
//     read(text, href) → null (no VEVENT: a task, not ours)
//                      | { gone: true } (cancelled)
//                      | { uid, main, extras, ro, mtime }
//     write(event, raw) → text | null (null: cannot be written exactly)
//     hash(event), idFor(uid, key), file(id), copy(event), mtime(event)
//
// DAV-4 (lossless): a write patches the server's own text. Only the
// properties orOS owns are replaced in the one VEVENT (DTSTART, DTEND
// / DURATION, SUMMARY, DESCRIPTION, LOCATION, RRULE, EXDATE, plus
// DTSTAMP, LAST-MODIFIED, SEQUENCE) and only the alarm orOS reads
// (the first that equals a reminder preset) when the reminder
// changed. ATTENDEE, ORGANIZER, CATEGORIES, X-*, other alarms,
// VTIMEZONE and every other line stay as the server sent them.
//
// Read-only (ro: the server always wins here, "edit it on the
// server"): what orOS cannot show exactly — a repeat rule ics.js
// simplifies, RDATE / EXRULE, edited single occurrences
// (RECURRENCE-ID; those come as `extras`, read-only events of their
// own), more than one event in the item, a title / note / place
// longer than the Calendar keeps or changed by how it keeps it.
//
// Every write is read back before it goes out: when the text does not
// read as exactly the event (same hash), write gives null and nothing
// is sent (DAV-6: no endless uploads).
(function (root) {
  "use strict";

  var ICS = (root && root.OrosIcs) || (typeof require === "function" ? require("./ics.js") : null);
  var OCC = (root && root.OrosCalOccur) || (typeof require === "function" ? require("./occur.js") : null);
  var REMIND = [5, 15, 30, 60, 1440, 4320, 7200];
  var OWNED = { DTSTART: 1, DTEND: 1, DURATION: 1, SUMMARY: 1, DESCRIPTION: 1, LOCATION: 1, RRULE: 1, EXDATE: 1,
                DTSTAMP: 1, "LAST-MODIFIED": 1, SEQUENCE: 1 };
  var WRITE = { DTSTART: 1, DTEND: 1, SUMMARY: 1, DESCRIPTION: 1, LOCATION: 1, RRULE: 1, EXDATE: 1 };
  var HM = /^\d{2}:\d{2}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;

  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hash16(s) { s = String(s); return fnv(s, 2166136261) + fnv(s, 0x9747b28c); }

  function nameOf(line) {
    var m = /^([A-Za-z0-9-]+)[;:]/.exec(line);
    return m ? m[1].toUpperCase() : "";
  }

  // The VEVENT blocks of a text: { start, end (line indexes of BEGIN /
  // END), props: [line], alarms: [{ start, end, lines }] }, nested
  // components other than VALARM skipped.
  function blocks(lines) {
    var out = [], cur = null, stack = [];
    for (var i = 0; i < lines.length; i++) {
      var u = lines[i].toUpperCase();
      if (u.indexOf("BEGIN:") === 0) {
        var comp = u.slice(6).trim();
        stack.push(comp);
        if (comp === "VEVENT" && stack.length === 2) cur = { start: i, end: -1, props: [], alarms: [] };
        else if (cur && comp === "VALARM" && stack.length === 3) cur.alarms.push({ start: i, end: -1, lines: [] });
        continue;
      }
      if (u.indexOf("END:") === 0) {
        var c2 = stack.pop();
        if (cur && c2 === "VEVENT" && stack.length === 1) { cur.end = i; out.push(cur); cur = null; }
        else if (cur && c2 === "VALARM" && stack.length === 2) cur.alarms[cur.alarms.length - 1].end = i;
        continue;
      }
      if (!cur) continue;
      if (stack.length === 2) cur.props.push(lines[i]);
      else if (stack.length === 3 && stack[2] === "VALARM") cur.alarms[cur.alarms.length - 1].lines.push(lines[i]);
    }
    return out;
  }
  function first(b, name) {
    for (var i = 0; i < b.props.length; i++) if (nameOf(b.props[i]) === name) return ICS.prop(b.props[i]);
    return null;
  }
  function has(b, name) { return !!first(b, name); }

  // The fields the sync compares, in the Calendar's canonical form
  // (as sanitizeEvent keeps them). zone: this device's zone, which a
  // stored event does not carry.
  function proj(e, zone) {
    var start = typeof e.start === "string" && HM.test(e.start) ? e.start : null;
    var end = typeof e.end === "string" && HM.test(e.end) ? e.end : null;
    var dateEnd = typeof e.dateEnd === "string" && YMD.test(e.dateEnd) && e.dateEnd >= e.date ? e.dateEnd : null;
    if (start && end && end < start && !(dateEnd && dateEnd > e.date)) end = null;
    var tz = start && typeof e.tz === "string" && e.tz && e.tz !== zone ? e.tz : null;
    return {
      date: e.date, dateEnd: dateEnd, start: start, end: end,
      title: String(e.title || "").slice(0, 80), note: String(e.note || "").slice(0, 500),
      location: String(e.location || "").slice(0, 150),
      recur: (OCC.normRecur(e.recur, e.date) || null),
      remindMin: REMIND.indexOf(e.remindMin) !== -1 ? e.remindMin : null,
      tz: tz
    };
  }

  // Lines longer than 75 octets are folded (RFC 5545 3.1).
  function fold(line) {
    var out = [], cur = "", n = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i), code = line.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) ch += line.charAt(++i);
      var len = code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : 3;
      if (n + len > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += len;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function utcStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); }

  function mapper(colUrl, opts) {
    opts = opts || {};
    var zone = opts.zone != null ? opts.zone : (OCC.deviceZone() || "");
    if (zone && !OCC.tzValid(zone)) zone = "";
    var mark = opts.mark || " (conflict)";
    var now = opts.now || function () { return Date.now(); };

    function hash(e) { return hash16(JSON.stringify(proj(e, zone))); }

    function read(text) {
      var lines = ICS.unfold(text);
      var bs = blocks(lines);
      if (!bs.length) return null;
      var masters = bs.filter(function (b) { return !has(b, "RECURRENCE-ID"); });
      var m = masters[0] || bs[0];
      var uidP = first(m, "UID");
      var uid = uidP ? uidP.value.trim() : "";
      var st = first(m, "STATUS");
      if (masters.length && st && /^CANCELLED$/i.test(st.value.trim())) return { gone: true };
      var res = ICS.parse(text);
      var own = uid.match(/^(.+)@oros\.calendar$/);
      var mid = own && /^[A-Za-z0-9_-]{1,64}$/.test(own[1]) ? own[1] : ICS.hashId(uid || "");
      var main = null, extras = [];
      res.events.forEach(function (e) {
        var ev = { id: e.id, date: e.date, dateEnd: e.dateEnd, start: e.start, end: e.end, title: e.title,
                   note: e.note, location: e.location, recur: e.recur, remindMin: e.remindMin };
        if (e.tz) ev.tz = e.tz;
        if (!main && masters.length && e.id === mid) main = ev;
        else extras.push(ev);
      });
      if (!main) {
        if (!extras.length) return { gone: true };          // nothing orOS can show
        main = extras.shift();
      }
      var ro = masters.length !== 1 || bs.length !== 1 || res.simplified > 0 || res.skipped > 0 ||
               has(m, "RDATE") || has(m, "EXRULE");
      if (!ro) {
        // Kept exactly? (title on one line, at most 80 / 500 / 150)
        var sum = first(m, "SUMMARY"), des = first(m, "DESCRIPTION"), lo = first(m, "LOCATION");
        if (sum && ICS.unesc(sum.value).trim() !== main.title) ro = true;
        if (des && ICS.unesc(des.value).trim() !== main.note) ro = true;
        if (lo && ICS.unesc(lo.value).trim() !== main.location) ro = true;
      }
      var lm = first(m, "LAST-MODIFIED") || first(m, "DTSTAMP");
      var lmDt = lm ? ICS.parseDt(lm.value, lm.params) : null;
      return { uid: uid, main: main, extras: extras, ro: ro, mtime: lmDt && lmDt.ms ? lmDt.ms : 0 };
    }

    function ownLines(e) {
      var L = ICS.lines(e, { zone: zone, untitled: "" }), out = [];
      for (var i = 1; i < L.length; i++) {
        if (L[i] === "BEGIN:VALARM" || L[i] === "END:VEVENT") break;
        if (WRITE[nameOf(L[i])]) out.push(L[i]);
      }
      return out;
    }
    function alarmLines(min, e) {
      return ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT" + min + "M", "DESCRIPTION:" + ICS.esc(e.title || ""), "END:VALARM"];
    }

    function build(e) {
      var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Calendar//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
               "UID:" + ICS.esc(e.id) + "@oros.calendar", "DTSTAMP:" + utcStamp(now()),
               "LAST-MODIFIED:" + utcStamp(now())];
      L = L.concat(ownLines(e));
      if (REMIND.indexOf(e.remindMin) !== -1) L = L.concat(alarmLines(e.remindMin, e));
      L.push("END:VEVENT", "END:VCALENDAR");
      return L.map(fold).join("\r\n") + "\r\n";
    }

    function patch(raw, e) {
      var lines = ICS.unfold(raw);
      var bs = blocks(lines);
      if (bs.length !== 1) return null;
      var b = bs[0];
      var old = read(raw);
      if (!old || old.gone || old.ro) return null;
      var seqP = first(b, "SEQUENCE");
      var seq = seqP && /^\d+$/.test(seqP.value.trim()) ? +seqP.value.trim() + 1 : 1;
      var newRem = REMIND.indexOf(e.remindMin) !== -1 ? e.remindMin : null;
      var dropAlarm = -1;
      if (newRem !== old.main.remindMin && old.main.remindMin !== null) {
        for (var a = 0; a < b.alarms.length; a++) {
          if (ICS.alarmMinutes(b.alarms[a].lines) !== null) { dropAlarm = a; break; }
        }
      }
      var out = [], depth = 0, alarmIx = -1, skipping = false;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (i < b.start || i > b.end) { out.push(ln); continue; }
        if (i === b.start) { out.push(ln); continue; }
        if (i === b.end) {
          out.push("DTSTAMP:" + utcStamp(now()), "LAST-MODIFIED:" + utcStamp(now()), "SEQUENCE:" + seq);
          out = out.concat(ownLines(e));
          if (newRem !== old.main.remindMin && newRem !== null) out = out.concat(alarmLines(newRem, e));
          out.push(ln);
          continue;
        }
        var u = ln.toUpperCase();
        if (u.indexOf("BEGIN:") === 0) {
          depth++;
          if (depth === 1 && u === "BEGIN:VALARM") { alarmIx++; skipping = alarmIx === dropAlarm; }
          if (!skipping) out.push(ln);
          continue;
        }
        if (u.indexOf("END:") === 0) {
          if (!skipping) out.push(ln);
          depth--;
          if (depth === 0) skipping = false;
          continue;
        }
        if (skipping) continue;
        if (depth === 0 && OWNED[nameOf(ln)]) continue;
        out.push(ln);
      }
      return out.map(fold).join("\r\n") + "\r\n";
    }

    function write(e, raw) {
      var text = raw ? patch(raw, e) : build(e);
      if (text === null) return null;
      var back = read(text);
      if (!back || back.gone || back.ro || hash(back.main) !== hash(e)) return null;
      return text;
    }

    function idFor(uid, key) {
      var own = String(uid || "").match(/^(.+)@oros\.calendar$/);
      return {
        own: own && /^[A-Za-z0-9_-]{1,64}$/.test(own[1]) ? own[1] : null,
        bind: uid ? ICS.hashId(uid) : null,
        dav: "dav-" + hash16(colUrl + "\n" + (uid || key))
      };
    }

    function copy(e) {
      var c = JSON.parse(JSON.stringify(e));
      c.id = "c" + now().toString(36) + Math.random().toString(36).slice(2, 7);
      var t = String(e.title || "");
      c.title = t.slice(0, Math.max(0, 80 - mark.length)) + mark;
      return c;
    }

    return {
      kind: "cal", type: "text/calendar",
      read: read, write: write, hash: hash, idFor: idFor, copy: copy,
      file: function (id) { return id + ".ics"; },
      mtime: function (e) { return e && typeof e.mtime === "number" ? e.mtime : 0; },
      patch: patch, build: build
    };
  }

  var api = { mapper: mapper, proj: proj, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalDav = api;
})(typeof window !== "undefined" ? window : null);
