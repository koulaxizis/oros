// orOS Calendar — iCalendar (.ics) import parser and export builder,
// RFC 5545 subset.
//
// Pure: text in, plain event objects out (the Calendar's own event
// shape, see sanitizeEvent in calendar.js). No DOM, no storage, no
// network, nothing from the file is ever executed or rendered as
// HTML. Loaded by calendar/index.html (window.OrosIcs) and by
// tests/calendar-ics.test.js (module.exports).
//
// What maps:
//   VEVENT → one event. DTSTART/DTEND (or DURATION) as all-day
//   (VALUE=DATE), UTC (…Z), TZID or floating local time. A timed
//   event with a known IANA TZID other than this device's zone keeps
//   it: `tz` plus wall-clock times in that zone (the Calendar shows
//   them converted). UTC, floating and this device's own zone end up
//   as plain local times; an unknown zone name is read as floating.
//   SUMMARY/DESCRIPTION/LOCATION, CATEGORIES (first one, matched to a
//   label by name by the app), the first VALARM that equals a
//   Calendar reminder preset, STATUS:CANCELLED skipped.
//   RRULE → the Calendar's recurrence through OrosCalOccur.fromRrule
//   (every N days/weeks/months/years, weekly on several days,
//   monthly / yearly by day or "Nth / last weekday", UNTIL or COUNT).
//   Anything richer (several month days, "1st and 3rd Monday",
//   HOURLY …) is imported as its first occurrence and counted in
//   `simplified`: never extra occurrences. A repeating event may
//   span several days.
//   EXDATE → excluded dates. RECURRENCE-ID (a moved/edited single
//   occurrence) → its own event plus an excluded date on the series.
//
// Ids: a UID "<id>@oros.calendar" (our own export) maps back to <id>,
// so re-importing an orOS export updates instead of duplicating.
// Any other UID becomes "ics-" + a hash of it: stable across imports.

(function (root) {
  "use strict";

  var OCC = (root && root.OrosCalOccur) ||
    (typeof module !== "undefined" && typeof require === "function" ? require("./occur.js") : null);

  var MAX_EVENTS = 5000;
  var REMIND_PRESETS = [5, 15, 30, 60, 1440, 4320, 7200];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function dimOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // "a,b\,c" → ["a", "b\,c"] (escaped commas stay inside a value).
  function splitList(v) {
    var out = [], cur = "";
    for (var i = 0; i < v.length; i++) {
      var ch = v.charAt(i);
      if (ch === "\\" && i + 1 < v.length) { cur += ch + v.charAt(++i); continue; }
      if (ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  // Unfold (CRLF + space/tab continues the previous line).
  function unfold(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if ((ln.charAt(0) === " " || ln.charAt(0) === "\t") && out.length) {
        out[out.length - 1] += ln.slice(1);
      } else if (ln) {
        out.push(ln);
      }
    }
    return out;
  }

  // "DTSTART;TZID=\"Europe/Athens\";VALUE=DATE-TIME:2026…" →
  // { name, params: { TZID, VALUE }, value }. Quoted parameter values
  // may hold ":" and ";".
  function prop(line) {
    var i = 0, q = false, head = null;
    for (; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') q = !q;
      else if (ch === ":" && !q) { head = line.slice(0, i); break; }
    }
    if (head === null) return null;
    var value = line.slice(i + 1);
    var parts = [], cur = "";
    q = false;
    for (var j = 0; j < head.length; j++) {
      var c = head.charAt(j);
      if (c === '"') { q = !q; continue; }
      if (c === ";" && !q) { parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    parts.push(cur);
    var params = {};
    for (var k = 1; k < parts.length; k++) {
      var eq = parts[k].indexOf("=");
      if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1);
    }
    return { name: parts[0].toUpperCase(), params: params, value: value };
  }

  function unesc(s) {
    return String(s || "").replace(/\\([\\;,nN])/g, function (m, c) {
      return (c === "n" || c === "N") ? "\n" : c;
    });
  }

  // Offset (ms) of time zone `tz` at UTC instant `ms`; null when the
  // zone is unknown to this browser (e.g. Windows zone names).
  var fmtCache = {};
  function tzOffset(tz, ms) {
    var f = fmtCache[tz];
    if (f === undefined) {
      try {
        f = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hourCycle: "h23",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
      } catch (e) { f = null; }
      fmtCache[tz] = f;
    }
    if (!f) return null;
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  // Parsed DATE / DATE-TIME → { date: "YYYY-MM-DD", time: "HH:MM" | null }
  // in the device's local time, plus for a time: ms (the instant;
  // floating = read as local), wall (as written) and tz (the zone it
  // was written in: an IANA name, "UTC", or "" for floating). null
  // when unreadable.
  function localFrom(ms) {
    var dt = new Date(ms);
    return { date: ymd(dt.getFullYear(), dt.getMonth(), dt.getDate()),
             time: pad(dt.getHours()) + ":" + pad(dt.getMinutes()) };
  }
  function parseDt(value, params) {
    var v = String(value || "").trim();
    var m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (mo < 0 || mo > 11 || d < 1 || d > dimOfMonth(y, mo)) return null;
    if (m[4] === undefined || (params && String(params.VALUE).toUpperCase() === "DATE")) {
      return { date: ymd(y, mo, d), time: null };
    }
    var h = +m[4], mi = +m[5];
    if (h > 23 || mi > 59) return null;
    var wall = { date: ymd(y, mo, d), time: pad(h) + ":" + pad(mi) };
    var tz = params && params.TZID ? String(params.TZID).replace(/^\//, "") : "";
    var ms = null, zone = "";
    if (m[7] === "Z" || /^(UTC|GMT|Etc\/UTC|Z)$/i.test(tz)) {
      ms = Date.UTC(y, mo, d, h, mi);
      zone = "UTC";
    } else if (tz) {
      var guess = Date.UTC(y, mo, d, h, mi);
      var off = tzOffset(tz, guess);
      if (off !== null) {
        ms = guess - off;
        var off2 = tzOffset(tz, ms);          // DST edge: re-check once
        if (off2 !== null && off2 !== off) ms = guess - off2;
        zone = tz;
      }
    }
    if (ms === null) {                        // floating (or unknown zone)
      ms = new Date(y, mo, d, h, mi).getTime();
      return { date: wall.date, time: wall.time, ms: ms, wall: wall, tz: "" };
    }
    var loc = localFrom(ms);
    return { date: loc.date, time: loc.time, ms: ms, wall: wall, tz: zone };
  }
  // A parsed value as wall time in zone Z (Z empty: device local).
  function inZone(dt, Z) {
    if (!dt || dt.time === null || !Z) return dt;
    if (dt.tz === Z) return { date: dt.wall.date, time: dt.wall.time };
    return OCC.msToWall(dt.ms, Z);
  }

  // "P1D", "PT1H30M", "-PT15M", "P1W" → minutes (signed); null if bad.
  function durMin(s) {
    var t = String(s || "").trim();
    var m = t.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m || !/\d/.test(t) || /T$/.test(t)) return null;
    var min = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) +
              Math.floor((+m[6] || 0) / 60);
    return m[1] === "-" ? -min : min;
  }

  function addMinutes(dt, min) {
    var p = dt.date.split("-");
    var hm = (dt.time || "00:00").split(":");
    var d = new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1] + min);
    return { date: ymd(d.getFullYear(), d.getMonth(), d.getDate()),
             time: dt.time ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : null };
  }
  function addDays(s, n) {
    var p = s.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return ymd(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Stable id from a UID (FNV-1a, two seeds → 64 bits of hex).
  function hashId(s) {
    function fnv(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return ("0000000" + h.toString(16)).slice(-8);
    }
    return "ics-" + fnv(2166136261) + fnv(0x9747b28c);
  }

  function alarmMinutes(lines) {
    var trig = null, related = "START";
    lines.forEach(function (ln) {
      var p = prop(ln);
      if (!p || p.name !== "TRIGGER" || trig !== null) return;
      if (p.params.VALUE && String(p.params.VALUE).toUpperCase() === "DATE-TIME") return;
      if (p.params.RELATED) related = String(p.params.RELATED).toUpperCase();
      trig = durMin(p.value);
    });
    if (trig === null || related !== "START" || trig > 0) return null;
    var before = -trig;
    return REMIND_PRESETS.indexOf(before) !== -1 ? before : null;
  }

  function parse(text) {
    var res = { events: [], found: 0, skipped: 0, simplified: 0, more: false };
    var lines = unfold(text);
    var blocks = [];                        // { props: [], alarms: [[…]] }
    var cur = null, alarm = null, depth = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var u = ln.toUpperCase();
      if (u === "BEGIN:VEVENT") { cur = { props: [], alarms: [] }; depth = 0; continue; }
      if (!cur) continue;
      if (u === "END:VEVENT") { blocks.push(cur); cur = null; alarm = null; continue; }
      if (u === "BEGIN:VALARM") { alarm = []; continue; }
      if (u === "END:VALARM") { if (alarm) cur.alarms.push(alarm); alarm = null; continue; }
      if (u.indexOf("BEGIN:") === 0) { depth++; continue; }      // unknown sub-component
      if (u.indexOf("END:") === 0) { if (depth) depth--; continue; }
      if (depth) continue;
      if (alarm) alarm.push(ln); else cur.props.push(ln);
    }
    res.found = blocks.length;

    var byUid = {};                          // uid → master event (for RECURRENCE-ID)
    var overrides = [];
    blocks.forEach(function (b) {
      if (res.events.length >= MAX_EVENTS) { res.more = true; return; }
      var P = {}, exRaw = [], cats = [];
      b.props.forEach(function (ln) {
        var p = prop(ln);
        if (!p) return;
        if (p.name === "EXDATE") {
          p.value.split(",").forEach(function (v) {
            var d = parseDt(v, p.params);
            if (d) exRaw.push(d);
          });
          return;
        }
        if (p.name === "CATEGORIES") {
          splitList(p.value).forEach(function (c) {
            var n = unesc(c).trim();
            if (n) cats.push(n.slice(0, 40));
          });
          return;
        }
        if (!P[p.name]) P[p.name] = p;      // first one wins
      });

      if (P.STATUS && /^CANCELLED$/i.test(P.STATUS.value.trim())) { res.skipped++; return; }
      var start0 = P.DTSTART ? parseDt(P.DTSTART.value, P.DTSTART.params) : null;
      if (!start0) { res.skipped++; return; }
      // The event's own zone: a real IANA zone that is not this device's.
      var Z = (start0.time !== null && start0.tz && start0.tz !== "UTC" && OCC &&
               OCC.tzValid(start0.tz) && start0.tz !== OCC.deviceZone()) ? start0.tz : "";
      var start = inZone(start0, Z);

      var end = null;
      if (P.DTEND) end = inZone(parseDt(P.DTEND.value, P.DTEND.params), Z);
      else if (P.DURATION) {
        var dm = durMin(P.DURATION.value);
        if (dm !== null && dm >= 0) {
          if (start0.time === null) end = addMinutes(start, dm);
          else end = Z ? OCC.msToWall(start0.ms + dm * 60000, Z) : localFrom(start0.ms + dm * 60000);
        }
      }

      var ev = {
        id: "", date: start.date, dateEnd: null, start: null, end: null,
        title: unesc(P.SUMMARY ? P.SUMMARY.value : "").replace(/\s+/g, " ").trim().slice(0, 80),
        note: unesc(P.DESCRIPTION ? P.DESCRIPTION.value : "").trim().slice(0, 500),
        location: unesc(P.LOCATION ? P.LOCATION.value : "").replace(/\s+/g, " ").trim().slice(0, 150),
        cats: cats,
        recur: null,
        remindMin: null
      };
      if (Z) ev.tz = Z;
      if (start.time === null) {
        // All-day: DTEND is exclusive.
        if (end && end.date > addDays(start.date, 1)) ev.dateEnd = addDays(end.date, -1);
      } else {
        ev.start = start.time;
        if (end && end.time !== null) {
          if (end.date === start.date) {
            if (end.time > start.time) ev.end = end.time;
          } else if (end.date > start.date) {
            if (!(end.time === "00:00" && end.date === addDays(start.date, 1))) {
              ev.dateEnd = end.date;
              ev.end = end.time;
            }
          }
        }
      }
      for (var a = 0; a < b.alarms.length && ev.remindMin === null; a++) {
        ev.remindMin = alarmMinutes(b.alarms[a]);
      }

      var uidRaw = P.UID ? P.UID.value.trim() : "";
      var own = uidRaw.match(/^(.+)@oros\.calendar$/);
      if (P["RECURRENCE-ID"]) {
        var rid = parseDt(P["RECURRENCE-ID"].value, P["RECURRENCE-ID"].params);
        ev.id = hashId(uidRaw + "|" + P["RECURRENCE-ID"].value.trim());
        if (rid) overrides.push({ uid: uidRaw, rid: rid });
      } else {
        ev.id = own && /^[A-Za-z0-9_-]{1,64}$/.test(own[1]) ? own[1]
          : hashId(uidRaw || (ev.title + "|" + P.DTSTART.value));
        if (P.RRULE && OCC) {
          var r = OCC.fromRrule(P.RRULE.value, start.date, {
            until: function (v) {
              var u = parseDt(v, v.length === 8 ? { VALUE: "DATE" } : P.DTSTART.params);
              return u ? inZone(u, Z).date : null;
            }
          });
          if (r.recur) {
            var exd = exRaw.map(function (d) { return inZone(d, Z).date; });
            r.recur.exdates = exd.filter(function (d, ix, arr) {
              return d >= start.date && arr.indexOf(d) === ix;
            }).sort();
            ev.recur = r.recur;
          } else if (r.simplified) {
            res.simplified++;
          }
        }
        if (uidRaw && !byUid[uidRaw]) byUid[uidRaw] = ev;
      }
      res.events.push(ev);
    });

    // A moved/edited occurrence: the series skips its original date
    // (as a date in the series' own zone).
    overrides.forEach(function (o) {
      var m = byUid[o.uid];
      if (!m || !m.recur) return;
      var day = inZone(o.rid, m.tz || "").date;
      if (m.recur.exdates.indexOf(day) === -1) {
        m.recur.exdates.push(day);
        m.recur.exdates.sort();
      }
    });

    // Duplicate ids inside one file: the first one wins.
    var seen = {};
    res.events = res.events.filter(function (e) {
      if (seen[e.id]) { res.skipped++; return false; }
      seen[e.id] = true;
      return true;
    });
    return res;
  }

  // ---------- export (the text builder) ----------
  // RFC 5545 subset: VEVENT with UID/DTSTAMP/DTSTART/DTEND/SUMMARY/
  // DESCRIPTION/LOCATION/RRULE/EXDATE/CATEGORIES/VALARM. All-day →
  // VALUE=DATE; timed → floating local datetimes, or TZID=<IANA> for
  // an event with its own time zone (no VTIMEZONE block: calendar
  // apps know the IANA names). RRULE from occur.js toRrule. Pure:
  // used by the Calendar's Export and by the .oroscal file's
  // preview/calendar.ics (calendar/package.js).
  //   build(events, { label(id) → name | null, untitled }) → text (CRLF)
  function icsEsc(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }
  function icsDt(dateYmd, hm) {
    var d = dateYmd.replace(/-/g, "");
    if (!hm) return d;                       // VALUE=DATE form
    return d + "T" + hm.replace(":", "") + "00";
  }
  function icsUtc(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }
  // One stored event → its VEVENT lines.
  function eventLines(e, opts) {
    var L = [], untitled = opts.untitled || "";
    L.push("BEGIN:VEVENT");
    L.push("UID:" + icsEsc(e.id) + "@oros.calendar");
    // 2000-01-01 fallback mtime as a stable STAMP source
    L.push("DTSTAMP:" + icsUtc(e.mtime || 946684800000));
    var tz = e.start && e.tz && OCC.tzValid(e.tz) ? e.tz : "";
    var tzp = tz ? ";TZID=" + tz : "";
    if (!e.start) {
      // all-day: DTEND is exclusive in RFC 5545 → +1 day
      var endDate = OCC.addDays(e.dateEnd || e.date, 1);
      L.push("DTSTART;VALUE=DATE:" + icsDt(e.date));
      L.push("DTEND;VALUE=DATE:" + icsDt(endDate));
    } else {
      L.push("DTSTART" + tzp + ":" + icsDt(e.date, e.start));
      L.push("DTEND" + tzp + ":" + icsDt(e.dateEnd || e.date, e.end || e.start));
    }
    L.push("SUMMARY:" + icsEsc(e.title || untitled));
    if (e.note) L.push("DESCRIPTION:" + icsEsc(e.note));
    if (e.location) L.push("LOCATION:" + icsEsc(e.location));
    if (OCC.validRecur(e.recur)) {
      L.push("RRULE:" + OCC.toRrule(e, {
        until: function (u) {
          if (!e.start) return u.replace(/-/g, "");
          // UNTIL matches DTSTART: UTC with a zone, local otherwise.
          return tz ? icsUtc(OCC.wallToMs(u, "23:59", tz) + 59000) : u.replace(/-/g, "") + "T235959";
        }
      }));
      var ex = Array.isArray(e.recur.exdates) ? e.recur.exdates : [];
      if (ex.length) {
        if (e.start) {
          L.push("EXDATE" + tzp + ":" + ex.map(function (d) { return icsDt(d, e.start); }).join(","));
        } else {
          L.push("EXDATE;VALUE=DATE:" + ex.map(function (d) { return icsDt(d); }).join(","));
        }
      }
    }
    var cat = e.labelId && typeof opts.label === "function" ? opts.label(e.labelId) : null;
    if (cat != null) L.push("CATEGORIES:" + icsEsc(cat));
    if (typeof e.remindMin === "number" && e.remindMin > 0) {
      L.push("BEGIN:VALARM");
      L.push("ACTION:DISPLAY");
      L.push("TRIGGER:-PT" + e.remindMin + "M");
      L.push("DESCRIPTION:" + icsEsc(e.title || untitled));
      L.push("END:VALARM");
    }
    L.push("END:VEVENT");
    return L;
  }
  function build(events, opts) {
    opts = opts || {};
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Calendar//EN", "CALSCALE:GREGORIAN"];
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (e && typeof e.id === "string" && typeof e.date === "string") L = L.concat(eventLines(e, opts));
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n");
  }

  var api = { parse: parse, parseDt: parseDt, durMin: durMin, hashId: hashId, MAX_EVENTS: MAX_EVENTS,
              build: build, esc: icsEsc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosIcs = api;
})(typeof window !== "undefined" ? window : null);
