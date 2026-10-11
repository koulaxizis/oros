// orOS Calendar — iCalendar (.ics) import parser, RFC 5545 subset.
//
// Pure: text in, plain event objects out (the Calendar's own event
// shape, see sanitizeEvent in calendar.js). No DOM, no storage, no
// network, nothing from the file is ever executed or rendered as
// HTML. Loaded by calendar/index.html (window.OrosIcs) and by
// tests/calendar-ics.test.js (module.exports).
//
// What maps:
//   VEVENT → one event. DTSTART/DTEND (or DURATION) as all-day
//   (VALUE=DATE), UTC (…Z), TZID (converted with Intl) or floating
//   local time; everything ends up in the device's local time, the
//   way the Calendar stores it. SUMMARY/DESCRIPTION/LOCATION,
//   CATEGORIES (first one, matched to a label by name by the app),
//   the first VALARM that equals a Calendar reminder preset,
//   STATUS:CANCELLED skipped.
//   RRULE → the Calendar's recurrence when it fits (DAILY/WEEKLY/
//   MONTHLY/YEARLY, interval 1, or 2 on WEEKLY, UNTIL or COUNT,
//   BY* parts that only repeat DTSTART). Anything richer (every
//   Mon+Wed, "2nd Tuesday", interval 3 …) is imported as its first
//   occurrence and counted in `simplified`: never extra occurrences.
//   EXDATE → excluded dates. RECURRENCE-ID (a moved/edited single
//   occurrence) → its own event plus an excluded date on the series.
//
// Ids: a UID "<id>@oros.calendar" (our own export) maps back to <id>,
// so re-importing an orOS export updates instead of duplicating.
// Any other UID becomes "ics-" + a hash of it: stable across imports.

(function (root) {
  "use strict";

  var MAX_EVENTS = 5000;
  var REMIND_PRESETS = [5, 15, 30, 60, 1440, 4320, 7200];
  var FREQ = { DAILY: "D", WEEKLY: "W", MONTHLY: "M", YEARLY: "Y" };
  var WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

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
  // in the device's local time. null when unreadable.
  function localFrom(y, mo, d, h, mi) {
    var dt = new Date(y, mo, d, h, mi);
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
    var tz = params && params.TZID ? String(params.TZID).replace(/^\//, "") : "";
    if (m[7] === "Z" || /^(UTC|GMT|Etc\/UTC|Z)$/i.test(tz)) {
      var u = new Date(Date.UTC(y, mo, d, h, mi));
      return localFrom(u.getFullYear(), u.getMonth(), u.getDate(), u.getHours(), u.getMinutes());
    }
    if (tz) {
      var guess = Date.UTC(y, mo, d, h, mi);
      var off = tzOffset(tz, guess);
      if (off !== null) {
        var utc = guess - off;
        var off2 = tzOffset(tz, utc);          // DST edge: re-check once
        if (off2 !== null && off2 !== off) utc = guess - off2;
        var t = new Date(utc);
        return localFrom(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes());
      }
    }
    return { date: ymd(y, mo, d), time: pad(h) + ":" + pad(mi) };   // floating
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

  // Date of the n-th occurrence (n ≥ 1) under the Calendar's own
  // stepping rules (sticky month clamp), so COUNT becomes UNTIL.
  function nthOccurrence(date, freq, interval, n) {
    var p = date.split("-");
    var y = +p[0], m = +p[1] - 1, d0 = +p[2];
    var k = (n - 1) * interval;
    if (freq === "D") return addDays(date, k);
    if (freq === "W") return addDays(date, 7 * k);
    if (freq === "M") {
      m += k;
      y += Math.floor(m / 12);
      m = m % 12;
      return ymd(y, m, Math.min(d0, dimOfMonth(y, m)));
    }
    y += k;
    return ymd(y, m, Math.min(d0, dimOfMonth(y, m)));
  }

  // RRULE → { recur } when the Calendar can hold it exactly, else
  // { simplified: true } (import the first occurrence only).
  function mapRrule(value, start, params) {
    var parts = {};
    String(value || "").split(";").forEach(function (kv) {
      var eq = kv.indexOf("=");
      if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
    });
    var freq = FREQ[parts.FREQ];
    if (!freq) return { simplified: true };
    var interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
    if (!(interval === 1 || (interval === 2 && freq === "W"))) return { simplified: true };
    var sp = start.date.split("-");
    var sd = new Date(+sp[0], +sp[1] - 1, +sp[2]);
    for (var key in parts) {
      if (!Object.prototype.hasOwnProperty.call(parts, key)) continue;
      var v = parts[key];
      if (key === "FREQ" || key === "INTERVAL" || key === "UNTIL" || key === "COUNT" || key === "WKST") continue;
      // BY* parts are fine only when they restate DTSTART.
      if (key === "BYDAY" && (freq === "W" || freq === "D") && v === WD[sd.getDay()]) continue;
      if (key === "BYMONTHDAY" && (freq === "M" || freq === "Y") && +v === sd.getDate()) continue;
      if (key === "BYMONTH" && freq === "Y" && +v === sd.getMonth() + 1) continue;
      return { simplified: true };
    }
    if (parts.BYDAY && freq === "D") return { simplified: true };   // "daily on Mondays" = weekly, keep it honest
    var until = null;
    if (parts.UNTIL) {
      var u = parseDt(parts.UNTIL, parts.UNTIL.length === 8 ? { VALUE: "DATE" } : (params || null));
      if (!u) return { simplified: true };
      until = u.date;
    } else if (parts.COUNT) {
      var n = parseInt(parts.COUNT, 10);
      if (!(n >= 1)) return { simplified: true };
      if (n === 1) return { single: true };
      until = nthOccurrence(start.date, freq, interval, Math.min(n, 100000));
    }
    if (until && until < start.date) return { single: true };
    return { recur: { freq: freq, interval: interval, until: until, exdates: [] } };
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
      var P = {}, exdates = [], cats = [];
      b.props.forEach(function (ln) {
        var p = prop(ln);
        if (!p) return;
        if (p.name === "EXDATE") {
          p.value.split(",").forEach(function (v) {
            var d = parseDt(v, p.params);
            if (d) exdates.push(d.date);
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
      var start = P.DTSTART ? parseDt(P.DTSTART.value, P.DTSTART.params) : null;
      if (!start) { res.skipped++; return; }

      var end = null;
      if (P.DTEND) end = parseDt(P.DTEND.value, P.DTEND.params);
      else if (P.DURATION) {
        var dm = durMin(P.DURATION.value);
        if (dm !== null && dm >= 0) end = addMinutes(start, dm);
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
        if (rid) overrides.push({ uid: uidRaw, date: rid.date });
      } else {
        ev.id = own && /^[A-Za-z0-9_-]{1,64}$/.test(own[1]) ? own[1]
          : hashId(uidRaw || (ev.title + "|" + P.DTSTART.value));
        if (P.RRULE) {
          var r = mapRrule(P.RRULE.value, start, P.DTSTART.params);
          if (r.recur) {
            r.recur.exdates = exdates.filter(function (d, ix, arr) {
              return d >= start.date && arr.indexOf(d) === ix;
            }).sort();
            ev.recur = r.recur;
            if (ev.dateEnd) { ev.dateEnd = null; ev.end = null; res.simplified++; }
          } else if (r.simplified) {
            res.simplified++;
          }
        }
        if (uidRaw && !byUid[uidRaw]) byUid[uidRaw] = ev;
      }
      res.events.push(ev);
    });

    // A moved/edited occurrence: the series skips its original date.
    overrides.forEach(function (o) {
      var m = byUid[o.uid];
      if (m && m.recur && m.recur.exdates.indexOf(o.date) === -1) {
        m.recur.exdates.push(o.date);
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

  var api = { parse: parse, parseDt: parseDt, durMin: durMin, hashId: hashId, MAX_EVENTS: MAX_EVENTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosIcs = api;
})(typeof window !== "undefined" ? window : null);
