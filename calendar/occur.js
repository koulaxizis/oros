// ============================================================
// orOS Calendar — occurrences of the Calendar's own events (v2.0.0)
// ONE truth for "which days does this event fall on", shared by the
// Calendar (calendar.js views), the shell's reminder engine
// (shell.js calRemEachOccurrence), the Today summary (calendar/
// today.js), universal search (calendar/search.js), the .ics parser
// (calendar/ics.js) and the phone bridge (phone.js). Pure: no DOM,
// no storage.
//
// Event fields read here: date, dateEnd, start, end, tz, recur.
//   recur = { freq: D|W|M|Y, interval: 1|2, until, exdates[],
//             every?, byday?, pos?, wday?, count?, wkst? }
//   interval  legacy: 2 only on weekly ("every 2 weeks"); older
//             versions read only this one.
//   every     2…999 for any other "every N" (left out when interval
//             says it already: weekly 2) .
//   byday     weekly on several weekdays: [0…6] (0 = Sunday), sorted;
//             left out when it is just the start's weekday.
//   pos/wday  monthly / yearly "Nth weekday": pos 1…5 or -1 (last),
//             wday 0…6. Yearly uses the start's month.
//   count     end after N occurrences (1…9999). `until` then holds
//             the date of the last one (derived, so older versions
//             still stop the series in the right place).
//   wkst      week start for "every N weeks on several days" (only
//             when not Monday, from imported files).
// Without pos, monthly / yearly keep the sticky clamp (Jan 31 →
// Feb 28 → Mar 31; Feb 29 → Feb 28). Exdates (moved / deleted single
// occurrences) are skipped; they still count towards `count`, like
// RFC 5545 EXDATE.
//
// Multi-day: dateEnd − date = the span of EVERY occurrence (a series
// may span days too). Time zone: `tz` (IANA) on a timed event means
// date/start/end/dateEnd are wall-clock times in that zone; instance()
// converts one occurrence to this device's zone. Without tz (or when
// it is this device's zone) the times are the device's own.
//
//   validRecur(r) · normRecur(r, date) · everyOf(r)
//   eachOccurrence(e, cb)    occurrence START dates (the event's own
//                            wall dates), ascending; cb(ymd) → false
//                            stops.
//   instance(e, occ)         { occ, date, dateEnd, start, end, zoned }
//                            in the device's zone
//   instanceOn(e, ymd)       the instance covering that device day or
//                            null · occursOn(e, ymd) → bool
//   instancesBetween(e, from, to, cb)  every instance touching
//                            [from, to] (device days)
//   startTs(e, occ)          ms of that occurrence's start
//   eventsOn(data, ymd)      stored events (oros-calendar-data) on that
//                            day, tombstones out, timed first by start
//   toRrule(e, opts) · fromRrule(rule, startYmd, opts)
//   tzValid(tz) · deviceZone() · wallToMs(ymd, hm, tz) ·
//   msToWall(ms, tz) · zoneOf(e)
// Exposes window.OrosCalOccur and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var HM_RE = /^\d{2}:\d{2}$/;
  var MAX_COUNT = 9999;
  var MAX_EVERY = 999;
  var MAX_EXDATES = 2000;
  var WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  var FREQ_OUT = { D: "DAILY", W: "WEEKLY", M: "MONTHLY", Y: "YEARLY" };
  var FREQ_IN = { DAILY: "D", WEEKLY: "W", MONTHLY: "M", YEARLY: "Y" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function dimOfMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function parts(s) { var p = s.split("-"); return [+p[0], +p[1] - 1, +p[2]]; }
  // Whole UTC days: DST can never shift a day.
  function dayNum(s) { var p = parts(s); return Math.round(Date.UTC(p[0], p[1], p[2]) / 86400000); }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function wdOf(s) { return ((dayNum(s) % 7) + 7 + 4) % 7; }     // 1970-01-01 was a Thursday
  function isInt(v, lo, hi) { return typeof v === "number" && v % 1 === 0 && v >= lo && v <= hi; }

  function validRecur(r) {
    return !!(r && typeof r === "object" && /^[DWMY]$/.test(r.freq || ""));
  }
  // The repeat step: `every` when set, else the legacy interval
  // (2 = every two weeks, read on weekly only, as always).
  function everyOf(r) {
    if (isInt(r.every, 2, MAX_EVERY)) return r.every;
    return (r.freq === "W" && r.interval === 2) ? 2 : 1;
  }
  function posOk(p) { return p === -1 || isInt(p, 1, 5); }

  // Day of month of the pos-th wday in (y, m), or null (no 5th).
  function nthWeekday(y, m, pos, wday) {
    var dim = dimOfMonth(y, m);
    if (pos === -1) {
      var lw = new Date(Date.UTC(y, m, dim)).getUTCDay();
      return dim - ((lw - wday + 7) % 7);
    }
    var fw = new Date(Date.UTC(y, m, 1)).getUTCDay();
    var d = 1 + ((wday - fw + 7) % 7) + (pos - 1) * 7;
    return d <= dim ? d : null;
  }
  // The pos (1…5, or -1 when asked for "last") of a date's weekday.
  function posOf(date, last) {
    var p = parts(date);
    if (last) return p[2] + 7 > dimOfMonth(p[0], p[1]) ? -1 : null;
    return Math.floor((p[2] - 1) / 7) + 1;
  }

  // Raw occurrence generator (exdates NOT applied, count and until
  // applied). `from`: a device-free hint that lets the simple daily /
  // weekly walks jump close to a far date instead of stepping there.
  function gen(date, r, cb, from) {
    var N = everyOf(r);
    var p = parts(date), y = p[0], m = p[1], d0 = p[2];
    var until = (typeof r.until === "string" && YMD_RE.test(r.until)) ? r.until : null;
    var count = isInt(r.count, 1, MAX_COUNT) ? r.count : 0;
    var n = 0;
    function emit(o) {
      if (until && o > until) return false;
      n++;
      if (cb(o) === false) return false;
      return !(count && n >= count);
    }
    var sdn = dayNum(date), k, k0 = 0;
    var swd = wdOf(date);
    var days = (r.freq === "W" && Array.isArray(r.byday) && r.byday.length) ? r.byday : null;
    if (days && days.length === 1 && days[0] === swd) days = null;
    if (r.freq === "D" || (r.freq === "W" && !days)) {
      var step = r.freq === "D" ? N : 7 * N;
      if (from && YMD_RE.test(from)) {
        k0 = Math.max(0, Math.floor((dayNum(from) - sdn) / step) - 1);
        if (count && k0 >= count) return;
        n = k0;                       // one occurrence per step
      }
      var maxD = r.freq === "D" ? 40000 : 5200;
      for (k = k0; k < maxD + k0; k++) {
        if (!emit(fromDayNum(sdn + k * step))) return;
      }
      return;
    }
    if (r.freq === "W") {
      var wk = isInt(r.wkst, 0, 6) ? r.wkst : 1;
      var ws = sdn - ((swd - wk + 7) % 7);
      var offs = days.map(function (x) { return (x - wk + 7) % 7; }).sort(function (a, b) { return a - b; });
      if (days.indexOf(swd) === -1 && !emit(date)) return;   // the start always counts
      for (k = 0; k < 5200; k++) {
        var base = ws + k * 7 * N;
        for (var i = 0; i < offs.length; i++) {
          var dn = base + offs[i];
          if (dn < sdn) continue;
          if (!emit(fromDayNum(dn))) return;
        }
      }
      return;
    }
    var nth = posOk(r.pos) && isInt(r.wday, 0, 6);
    if (nth && nthWeekday(y, m, r.pos, r.wday) !== d0 && !emit(date)) return;
    for (k = 0; k < 600; k++) {
      var yy = y, mm = m;
      if (r.freq === "M") { mm = m + k * N; yy = y + Math.floor(mm / 12); mm = mm % 12; }
      else yy = y + k * N;
      var dd = nth ? nthWeekday(yy, mm, r.pos, r.wday) : Math.min(d0, dimOfMonth(yy, mm));
      if (dd === null) continue;
      var o = ymd(yy, mm, dd);
      if (o < date) continue;
      if (!emit(o)) return;
    }
  }

  function exSetOf(r) {
    var ex = {};
    if (Array.isArray(r.exdates)) {
      for (var x = 0; x < r.exdates.length && x < MAX_EXDATES; x++) {
        if (YMD_RE.test(r.exdates[x])) ex[r.exdates[x]] = true;
      }
    }
    return ex;
  }

  function eachFrom(e, cb, from) {
    if (!e || typeof e.date !== "string" || !YMD_RE.test(e.date) || !validRecur(e.recur)) return;
    var ex = exSetOf(e.recur);
    gen(e.date, e.recur, function (o) {
      if (ex[o]) return true;
      return cb(o);
    }, from);
  }
  function eachOccurrence(e, cb) { eachFrom(e, cb, null); }

  // Canonical recur: what every device stores, byte for byte. Old
  // shapes come out unchanged; new keys only when they say something.
  function normRecur(r, date) {
    if (!validRecur(r)) return null;
    var N = everyOf(r);
    var exSet = {};
    if (Array.isArray(r.exdates)) {
      r.exdates.forEach(function (d) { if (typeof d === "string" && YMD_RE.test(d)) exSet[d] = true; });
    }
    var out = {
      freq: r.freq,
      interval: (r.freq === "W" && N === 2) ? 2 : 1,
      until: (typeof r.until === "string" && YMD_RE.test(r.until)) ? r.until : null,
      exdates: Object.keys(exSet).sort()
    };
    if (N > 1 && !(r.freq === "W" && N === 2)) out.every = N;
    var okDate = typeof date === "string" && YMD_RE.test(date);
    if (r.freq === "W" && Array.isArray(r.byday)) {
      var seen = {}, days = [];
      r.byday.forEach(function (x) { if (isInt(x, 0, 6) && !seen[x]) { seen[x] = 1; days.push(x); } });
      days.sort(function (a, b) { return a - b; });
      if (days.length && !(okDate && days.length === 1 && days[0] === wdOf(date))) out.byday = days;
    }
    if ((r.freq === "M" || r.freq === "Y") && posOk(r.pos) && isInt(r.wday, 0, 6)) {
      out.pos = r.pos;
      out.wday = r.wday;
    }
    if (isInt(r.count, 1, MAX_COUNT)) {
      out.count = r.count;
      if (okDate) {
        var last = null;
        gen(date, { freq: out.freq, interval: out.interval, every: out.every, byday: out.byday,
                    pos: out.pos, wday: out.wday, count: out.count, wkst: r.wkst }, function (o) { last = o; });
        if (last) out.until = last;
      }
    }
    if (out.byday && N > 1 && isInt(r.wkst, 0, 6) && r.wkst !== 1) out.wkst = r.wkst;
    return out;
  }

  /* ---------- time zones ---------- */
  var fmtCache = {};
  // Offset (ms) of zone `tz` at UTC instant `ms`; null when unknown.
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
  var tzOk = {};
  function tzValid(tz) {
    if (typeof tz !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(tz)) return false;
    if (tzOk[tz] === undefined) tzOk[tz] = tzOffset(tz, 0) !== null;
    return tzOk[tz];
  }
  var devZone = null, devZoneAt = 0;
  function deviceZone() {
    var now = Date.now();
    if (devZone === null || now - devZoneAt > 60000) {
      try { devZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { devZone = ""; }
      devZoneAt = now;
    }
    return devZone;
  }
  // Wall time in `tz` (or the device's zone when tz is empty) → ms.
  function wallToMs(date, hm, tz) {
    var p = parts(date), t = (HM_RE.test(hm || "") ? hm : "00:00").split(":");
    if (tz) {
      var guess = Date.UTC(p[0], p[1], p[2], +t[0], +t[1]);
      var off = tzOffset(tz, guess);
      if (off !== null) {
        var utc = guess - off;
        var off2 = tzOffset(tz, utc);              // DST edge: re-check once
        if (off2 !== null && off2 !== off) utc = guess - off2;
        return utc;
      }
    }
    return new Date(p[0], p[1], p[2], +t[0], +t[1]).getTime();
  }
  // ms → { date, time } as a wall clock in `tz` (device zone when empty).
  function msToWall(ms, tz) {
    var off = tz ? tzOffset(tz, ms) : null;
    if (off !== null) {
      var u = new Date(Math.floor(ms / 1000) * 1000 + off);
      return { date: ymd(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()),
               time: pad(u.getUTCHours()) + ":" + pad(u.getUTCMinutes()) };
    }
    var d = new Date(ms);
    return { date: ymd(d.getFullYear(), d.getMonth(), d.getDate()),
             time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
  }
  // The zone an event must be converted from, or null (device time).
  function zoneOf(e) {
    if (!e || typeof e.start !== "string" || !HM_RE.test(e.start) || !e.tz) return null;
    if (e.tz === deviceZone() || !tzValid(e.tz)) return null;
    return e.tz;
  }

  function spanOf(e) {
    if (typeof e.dateEnd !== "string" || !YMD_RE.test(e.dateEnd) || e.dateEnd <= e.date) return 0;
    return dayNum(e.dateEnd) - dayNum(e.date);
  }

  // One occurrence (its own start date `occ`) in the device's zone.
  function instance(e, occ) {
    var span = spanOf(e);
    var start = typeof e.start === "string" && HM_RE.test(e.start) ? e.start : null;
    var end = start && typeof e.end === "string" && HM_RE.test(e.end) ? e.end : null;
    var tz = zoneOf(e);
    if (!tz) {
      return { occ: occ, date: occ, dateEnd: span ? addDays(occ, span) : null, start: start, end: end, zoned: false };
    }
    var s = msToWall(wallToMs(occ, start, tz), "");
    var lastDay = addDays(occ, span);
    var fin = msToWall(wallToMs(lastDay, end || start, tz), "");
    return { occ: occ, date: s.date, dateEnd: fin.date > s.date ? fin.date : null,
             start: s.time, end: end ? fin.time : null, zoned: true };
  }
  function covers(inst, day) { return inst.date <= day && day <= (inst.dateEnd || inst.date); }

  // Instances touching the device days [from, to]; cb(inst) → false stops.
  function instancesBetween(e, from, to, cb) {
    if (!e || typeof e.date !== "string" || !YMD_RE.test(e.date)) return;
    if (!validRecur(e.recur)) {
      var one = instance(e, e.date);
      if (one.date <= to && (one.dateEnd || one.date) >= from) cb(one);
      return;
    }
    var slack = zoneOf(e) ? 2 : 0;
    var lo = addDays(from, -(spanOf(e) + slack)), hi = addDays(to, slack);
    eachFrom(e, function (o) {
      if (o > hi) return false;
      if (o < lo) return true;
      var inst = instance(e, o);
      if (inst.date <= to && (inst.dateEnd || inst.date) >= from) return cb(inst);
      return true;
    }, lo);
  }
  function instanceOn(e, day) {
    if (typeof day !== "string" || !YMD_RE.test(day)) return null;
    var found = null;
    instancesBetween(e, day, day, function (inst) { found = inst; return false; });
    return found;
  }
  function occursOn(e, dateStr) { return !!instanceOn(e, dateStr); }

  function startTs(e, occ) {
    var start = typeof e.start === "string" && HM_RE.test(e.start) ? e.start : null;
    if (!start) { var p = parts(occ); return new Date(p[0], p[1], p[2]).getTime(); }
    return wallToMs(occ, start, zoneOf(e));
  }

  function eventsOn(data, dateStr) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events) || !YMD_RE.test(dateStr)) return [];
    var gone = {};
    (Array.isArray(data.deleted) ? data.deleted : []).forEach(function (t) {
      if (t && typeof t.id === "string") gone[t.id] = true;
    });
    var key = {};
    return data.events.filter(function (e) {
      if (!(e && typeof e === "object" && typeof e.id === "string" && !gone[e.id] &&
            typeof e.date === "string" && YMD_RE.test(e.date))) return false;
      var inst = instanceOn(e, dateStr);
      if (!inst) return false;
      key[e.id] = inst.start;
      return true;
    }).sort(function (a, b) {
      var sa = key[a.id] || null, sb = key[b.id] || null;
      if (sa === sb) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa < sb ? -1 : 1;
    });
  }

  /* ---------- RRULE (RFC 5545) out and in ---------- */
  // opts.until(ymd) → the UNTIL value text (default: YYYYMMDD).
  // Monthly / yearly sticky clamp is written as BYMONTHDAY=28…d;
  // BYSETPOS=-1 so other calendars clamp like this one.
  function toRrule(e, opts) {
    var r = e && e.recur;
    if (!validRecur(r)) return null;
    opts = opts || {};
    var N = everyOf(r), s = "FREQ=" + FREQ_OUT[r.freq];
    if (N > 1) s += ";INTERVAL=" + N;
    var p = parts(e.date), day = p[2];
    var nth = posOk(r.pos) && isInt(r.wday, 0, 6);
    if (r.freq === "W" && Array.isArray(r.byday) && r.byday.length) {
      var ds = r.byday.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
      s += ";BYDAY=" + ds.map(function (x) { return WD[x]; }).join(",");
      if (isInt(r.wkst, 0, 6) && r.wkst !== 1) s += ";WKST=" + WD[r.wkst];
    } else if (r.freq === "M" && nth) {
      s += ";BYDAY=" + r.pos + WD[r.wday];
    } else if (r.freq === "Y" && nth) {
      s += ";BYMONTH=" + (p[1] + 1) + ";BYDAY=" + r.pos + WD[r.wday];
    } else if (r.freq === "M" && day > 28) {
      var list = [];
      for (var d = 28; d <= day; d++) list.push(d);
      s += ";BYMONTHDAY=" + list.join(",") + ";BYSETPOS=-1";
    } else if (r.freq === "Y" && p[1] === 1 && day === 29) {
      s += ";BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1";
    }
    if (isInt(r.count, 1, MAX_COUNT)) s += ";COUNT=" + r.count;
    else if (typeof r.until === "string" && YMD_RE.test(r.until)) {
      s += ";UNTIL=" + (opts.until ? opts.until(r.until) : r.until.replace(/-/g, ""));
    }
    return s;
  }

  // RRULE text → { recur } (canonical), { single: true } (one date
  // only) or { simplified: true } (a rule this Calendar cannot hold:
  // the caller keeps the first date). opts.until(value) → ymd | null.
  function fromRrule(value, start, opts) {
    opts = opts || {};
    if (typeof start !== "string" || !YMD_RE.test(start)) return { simplified: true };
    var P = {};
    String(value || "").replace(/^RRULE:/i, "").split(";").forEach(function (kv) {
      var eq = kv.indexOf("=");
      if (eq > 0) P[kv.slice(0, eq).trim().toUpperCase()] = kv.slice(eq + 1).trim().toUpperCase();
    });
    var freq = FREQ_IN[P.FREQ];
    if (!freq) return { simplified: true };
    var KNOWN = { FREQ: 1, INTERVAL: 1, UNTIL: 1, COUNT: 1, WKST: 1, BYDAY: 1, BYMONTHDAY: 1, BYMONTH: 1, BYSETPOS: 1 };
    for (var key in P) {
      if (Object.prototype.hasOwnProperty.call(P, key) && !KNOWN[key]) return { simplified: true };
    }
    var N = P.INTERVAL ? parseInt(P.INTERVAL, 10) : 1;
    if (!(N >= 1 && N <= MAX_EVERY) || (P.INTERVAL && !/^\d+$/.test(P.INTERVAL))) return { simplified: true };
    var sp = parts(start), sDay = sp[2], sMon = sp[1] + 1, sWd = wdOf(start);
    var r = { freq: freq, interval: 1, every: N, until: null, exdates: [] };
    if (freq === "W" && N === 2) { r.interval = 2; delete r.every; }

    var byday = null;
    if (P.BYDAY) {
      byday = [];
      var bad = false;
      P.BYDAY.split(",").forEach(function (it) {
        var m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(it);
        if (!m) { bad = true; return; }
        byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD.indexOf(m[2]) });
      });
      if (bad || !byday.length) return { simplified: true };
    }
    function single(list) { return list && list.length === 1 ? list[0] : null; }
    var mdays = P.BYMONTHDAY ? P.BYMONTHDAY.split(",").map(function (x) { return /^-?\d{1,2}$/.test(x) ? +x : NaN; }) : null;
    var months = P.BYMONTH ? P.BYMONTH.split(",").map(function (x) { return /^\d{1,2}$/.test(x) ? +x : NaN; }) : null;
    var setpos = P.BYSETPOS ? P.BYSETPOS.split(",").map(function (x) { return /^-?\d{1,3}$/.test(x) ? +x : NaN; }) : null;
    // BYMONTHDAY=28,…,d;BYSETPOS=-1 (our own clamp, and Android's)
    function clampList(d) {
      if (!mdays || !setpos || setpos.length !== 1 || setpos[0] !== -1 || d <= 28) return false;
      if (mdays.length !== d - 27) return false;
      for (var i = 0; i < mdays.length; i++) if (mdays[i] !== 28 + i) return false;
      return true;
    }
    if (freq === "D") {
      if (mdays || months || setpos) return { simplified: true };
      if (byday) {
        // "Daily on Mon–Fri" = weekly on those days (interval 1 only).
        if (N !== 1 || byday.some(function (b) { return b.n !== 0; })) return { simplified: true };
        r = { freq: "W", interval: 1, until: null, exdates: [], byday: byday.map(function (b) { return b.wd; }) };
      }
    } else if (freq === "W") {
      if (mdays || months || setpos) return { simplified: true };
      if (byday) {
        if (byday.some(function (b) { return b.n !== 0; })) return { simplified: true };
        r.byday = byday.map(function (b) { return b.wd; });
      }
      if (P.WKST) {
        var wk = WD.indexOf(P.WKST);
        if (wk === -1) return { simplified: true };
        r.wkst = wk;
      }
    } else {
      if (freq === "M" && months) return { simplified: true };
      if (freq === "Y" && months && !(months.length === 1 && months[0] === sMon)) return { simplified: true };
      if (byday) {
        if (mdays || byday.length !== 1) return { simplified: true };
        if (freq === "Y" && !months) return { simplified: true };      // "Nth weekday of the YEAR"
        var b = byday[0], pos = b.n;
        if (setpos) {
          if (pos !== 0 || setpos.length !== 1) return { simplified: true };
          pos = setpos[0];
        }
        if (!posOk(pos)) return { simplified: true };
        r.pos = pos;
        r.wday = b.wd;
      } else if (mdays) {
        var md = single(mdays);
        var fits = (md === sDay && !setpos) || clampList(sDay) ||
                   (freq === "Y" && sMon === 2 && sDay === 29 && clampList(29));
        if (!fits) return { simplified: true };
      } else if (setpos) {
        return { simplified: true };
      }
    }
    if (P.UNTIL) {
      var u = opts.until ? opts.until(P.UNTIL) : (/^(\d{4})(\d{2})(\d{2})/.test(P.UNTIL)
        ? P.UNTIL.slice(0, 4) + "-" + P.UNTIL.slice(4, 6) + "-" + P.UNTIL.slice(6, 8) : null);
      if (!u || !YMD_RE.test(u)) return { simplified: true };
      if (u < start) return { single: true };
      r.until = u;
    } else if (P.COUNT) {
      var c = parseInt(P.COUNT, 10);
      if (!(c >= 1) || !/^\d+$/.test(P.COUNT)) return { simplified: true };
      if (c === 1) return { single: true };
      r.count = Math.min(c, MAX_COUNT);
    }
    return { recur: normRecur(r, start) };
  }

  var api = {
    validRecur: validRecur, normRecur: normRecur, everyOf: everyOf,
    eachOccurrence: eachOccurrence, instance: instance, instanceOn: instanceOn,
    instancesBetween: instancesBetween, occursOn: occursOn, startTs: startTs, eventsOn: eventsOn,
    toRrule: toRrule, fromRrule: fromRrule, nthWeekday: nthWeekday, posOf: posOf,
    tzValid: tzValid, deviceZone: deviceZone, wallToMs: wallToMs, msToWall: msToWall, zoneOf: zoneOf,
    addDays: addDays, dayNum: dayNum, wdOf: wdOf, spanOf: spanOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosCalOccur = api;
})(typeof window !== "undefined" ? window : globalThis);
