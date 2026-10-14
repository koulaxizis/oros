// ============================================================
// orOS Time — clock core (v1.0.0, wave 5)
// Pure logic for the world clock search, the meeting planner, the
// named timers and the stopwatch with laps. No DOM; time/time.js
// draws it. UMD: window.OrosClockCore in the app, module.exports
// under Node for tests/time-clock.test.js.
//
// Cities: time/cities.js ("English|Greek|zone|country"), searched
// by name in either language with accents ignored; any IANA zone
// the browser knows (Intl.supportedValuesOf) is searchable too.
//
// Device-local (never synced):
//   oros-time-timers  [{ id, name, dur ms (preset, for Reset),
//                        tot ms (this run's total, for the bar),
//                        left ms (idle / paused), end ms (running /
//                        done), st: idle|run|pause|done, sound,
//                        aid: the shell alarm "tmr-…" while running }]
//   oros-time-sw      { run, start ms, base ms, laps: [total ms] }
//   oros-time-plan    { open, places: [{ tz, city }]|null,
//                        wf "HH:MM", wt "HH:MM", len min }
// ============================================================
(function (root) {
  "use strict";

  var RAW = [];
  try {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") RAW = require("./cities.js");
  } catch (e) { RAW = []; }
  if ((!RAW || !RAW.length) && root && root.OrosTimeCities) RAW = root.OrosTimeCities;

  var HOUR = 3600000, MIN = 60000;

  /* ---------- text ---------- */
  function fold(s) {
    var x = String(s == null ? "" : s);
    try { x = x.normalize("NFD"); } catch (e) {}
    return x.replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/ς/g, "σ").replace(/[^a-z0-9Ͱ-Ͽ]+/g, " ").trim();
  }
  function lastSeg(tz) {
    return String(tz || "").split("/").pop().replace(/_/g, " ");
  }

  /* ---------- cities ---------- */
  var CITY = null;
  function cities() {
    if (CITY) return CITY;
    CITY = [];
    (Array.isArray(RAW) ? RAW : []).forEach(function (s, i) {
      var p = String(s).split("|");
      if (p.length !== 4) return;
      CITY.push({ en: p[0], el: p[1], tz: p[2], cc: p[3], i: i, fe: fold(p[0]), fg: fold(p[1]) });
    });
    return CITY;
  }
  function findCity(name, tz) {
    if (!name) return null;
    var list = cities(), f = fold(name);
    for (var i = 0; i < list.length; i++) {
      if (list[i].tz === tz && (list[i].en === name || list[i].fe === f)) return list[i];
    }
    return null;
  }
  // The city that names a bare zone ("Europe/Berlin" → Berlin).
  function zoneCity(tz) {
    var list = cities(), f = fold(lastSeg(tz));
    for (var i = 0; i < list.length; i++) if (list[i].tz === tz && list[i].fe === f) return list[i];
    return null;
  }
  function cityLabel(c, lang) { return c ? (lang === "el" ? c.el : c.en) : ""; }
  // What a world-clock row / planner place is called.
  function zoneLabel(tz, city, lang) {
    if (city) {
      var c = findCity(city, tz);
      return c ? cityLabel(c, lang) : String(city);
    }
    if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
    var z = zoneCity(tz);
    return z ? cityLabel(z, lang) : lastSeg(tz);
  }

  /* ---------- zones ---------- */
  var ZONES = null;
  function allZones(intl) {
    if (ZONES) return ZONES;
    var I = intl || (typeof Intl !== "undefined" ? Intl : null), out = [];
    try { if (I && typeof I.supportedValuesOf === "function") out = I.supportedValuesOf("timeZone").slice(); } catch (e) { out = []; }
    var seen = {};
    out.forEach(function (z) { seen[z] = 1; });
    if (!out.length) {
      cities().forEach(function (c) { if (!seen[c.tz]) { seen[c.tz] = 1; out.push(c.tz); } });
    }
    if (!seen.UTC) out.push("UTC");
    out.sort();
    ZONES = out;
    return out;
  }
  function validZone(tz) {
    if (typeof tz !== "string" || !tz || tz.length > 64) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }

  // Cities first (name in either language, accents ignored), then raw
  // zones whose id matches. Exact > starts with > a word starts with >
  // contains; ties keep the list order.
  function searchPlaces(q, opts) {
    opts = opts || {};
    var fq = fold(q), limit = opts.limit || 40;
    if (!fq) return [];
    function score(f) {
      if (!f) return 9;
      if (f === fq) return 0;
      if (f.indexOf(fq) === 0) return 1;
      if ((" " + f).indexOf(" " + fq) >= 0) return 2;
      if (f.indexOf(fq) >= 0) return 3;
      return 9;
    }
    var hits = [];
    cities().forEach(function (c) {
      var s = Math.min(score(c.fe), score(c.fg));
      if (s < 9) hits.push({ kind: "city", city: c, tz: c.tz, s: s, i: c.i });
    });
    hits.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    var named = {};
    hits.forEach(function (h) { named[h.tz + "|" + h.city.fe] = 1; });
    var zs = [];
    (opts.zones || allZones()).forEach(function (tz, i) {
      var f = fold(tz.replace(/[_/]/g, " "));
      var s = score(f);
      if (s === 9) s = score(fold(lastSeg(tz)));
      if (s === 9) return;
      if (named[tz + "|" + fold(lastSeg(tz))]) return;    // the city row already covers it
      zs.push({ kind: "zone", tz: tz, s: s + 4, i: i });
    });
    zs.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return hits.concat(zs).slice(0, limit).map(function (h) {
      return h.kind === "city" ? { kind: "city", tz: h.tz, city: h.city.en, en: h.city.en, el: h.city.el, cc: h.city.cc }
                               : { kind: "zone", tz: h.tz };
    });
  }

  /* ---------- time in a zone ---------- */
  var FMT = {};
  function fmtOf(tz) {
    if (!FMT[tz]) {
      FMT[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric", weekday: "short"
      });
    }
    return FMT[tz];
  }
  var WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function partsIn(tz, ms) {
    var o = {};
    fmtOf(tz).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    var h = +o.hour;
    if (h === 24) h = 0;
    return { y: +o.year, mo: +o.month, d: +o.day, h: h, mi: +o.minute, s: +o.second,
             wd: WD[o.weekday] !== undefined ? WD[o.weekday] : new Date(Date.UTC(+o.year, +o.month - 1, +o.day)).getUTCDay() };
  }
  // Minutes east of UTC at that instant.
  function offsetMin(tz, ms) {
    var p = partsIn(tz, ms);
    var asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
  }
  // The instant of local midnight on y-mo-d in that zone.
  function midnightIn(tz, y, mo, d) {
    var u = Date.UTC(y, mo - 1, d);
    var g = u - offsetMin(tz, u) * MIN;
    return u - offsetMin(tz, g) * MIN;
  }
  function ymd(p) { return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(p) { return pad(p.h) + ":" + pad(p.mi); }
  // "+2", "−5:30", "±0" (hours) between two offsets.
  function diffLabel(mins) {
    if (!mins) return "±0";
    var a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
    return (mins > 0 ? "+" : "−") + h + (m ? ":" + pad(m) : "");
  }
  // −1 yesterday · 0 today · +1 tomorrow (zone date vs reference date).
  function dayDiff(a, b) {
    var x = Date.UTC(a.y, a.mo - 1, a.d), y = Date.UTC(b.y, b.mo - 1, b.d);
    return Math.round((x - y) / 86400000);
  }

  /* ---------- meeting planner ---------- */
  function hmMin(s, dflt) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || ""));
    return m ? (+m[1]) * 60 + (+m[2]) : dflt;
  }
  function isWork(minOfDay, wd, wf, wt) {
    if (wd === 0 || wd === 6) return false;
    if (wf === wt) return false;
    return wf < wt ? (minOfDay >= wf && minOfDay < wt) : (minOfDay >= wf || minOfDay < wt);
  }
  // One row per place, 24 hourly cells starting at baseMs, each with
  // the place's local hour and a class: work (working hours on a
  // weekday) · awake (07:00–22:00) · night. allWork[i]: everyone works.
  function planRows(tzs, baseMs, opts) {
    opts = opts || {};
    var wf = hmMin(opts.wf, 540), wt = hmMin(opts.wt, 1020), n = opts.hours || 24;
    var rows = [], allWork = [];
    for (var i = 0; i < n; i++) allWork.push(tzs.length > 0);
    tzs.forEach(function (tz) {
      var cells = [];
      for (var i = 0; i < n; i++) {
        var ms = baseMs + i * HOUR, p = partsIn(tz, ms), mod = p.h * 60 + p.mi;
        var cls = isWork(mod, p.wd, wf, wt) ? "work" : (mod >= 420 && mod < 1320 ? "awake" : "night");
        if (cls !== "work") allWork[i] = false;
        cells.push({ ms: ms, h: p.h, mi: p.mi, y: p.y, mo: p.mo, d: p.d, wd: p.wd, cls: cls,
                     newDay: i === 0 || p.h === 0 });
      }
      rows.push({ tz: tz, cells: cells });
    });
    return { rows: rows, allWork: allWork };
  }
  // The slot in each place: [{tz, start parts, end parts}].
  function slotIn(tzs, startMs, lenMin) {
    var end = startMs + lenMin * MIN;
    return tzs.map(function (tz) { return { tz: tz, s: partsIn(tz, startMs), e: partsIn(tz, end) }; });
  }

  /* ---------- named timers ---------- */
  var SOUNDS = ["beep", "chime", "bell", "digital", "gentle"];
  var MAX_TIMERS = 20, MAX_MS = 100 * HOUR, ID_RE = /^[a-z0-9]{4,24}$/;
  function num(v, lo, hi, d) { return (typeof v === "number" && isFinite(v)) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
  function timerNorm(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (t) {
      if (!t || typeof t !== "object" || typeof t.id !== "string" || !ID_RE.test(t.id) || seen[t.id]) return;
      if (out.length >= MAX_TIMERS) return;
      seen[t.id] = 1;
      if (typeof t.dur !== "number" || !(t.dur >= 1000)) return;
      var dur = num(t.dur, 1000, MAX_MS, 0);
      var st = ["idle", "run", "pause", "done"].indexOf(t.st) >= 0 ? t.st : "idle";
      var end = num(t.end, 0, 8.64e15, 0);
      if ((st === "run" || st === "done") && !end) st = "idle";
      out.push({
        id: t.id,
        name: typeof t.name === "string" ? t.name.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 40) : "",
        dur: dur,
        tot: num(t.tot, 1000, MAX_MS, dur),
        left: num(t.left, 0, MAX_MS, dur),
        end: st === "run" || st === "done" ? end : 0,
        st: st,
        sound: SOUNDS.indexOf(t.sound) >= 0 ? t.sound : "beep",
        aid: (typeof t.aid === "string" && /^tmr-[a-z0-9-]{1,60}$/.test(t.aid)) ? t.aid : ""
      });
    });
    return out;
  }
  function timerNew(id, name, durMs, sound) {
    var d = num(durMs, 1000, MAX_MS, 60000);
    return { id: id, name: String(name || "").slice(0, 40), dur: d, tot: d, left: d, end: 0, st: "idle",
             sound: SOUNDS.indexOf(sound) >= 0 ? sound : "beep", aid: "" };
  }
  function copy(t, o) { var r = {}, k; for (k in t) r[k] = t[k]; for (k in o) r[k] = o[k]; return r; }
  // Time left (ms); negative after the end (how long it has been ringing).
  function timerLeft(t, now) {
    if (t.st === "run" || t.st === "done") return t.end - now;
    return t.left;
  }
  function timerProgress(t, now) {
    var tot = t.tot || t.dur || 1, left = Math.max(0, timerLeft(t, now));
    return t.st === "done" ? 1 : Math.min(1, Math.max(0, 1 - left / tot));
  }
  function timerStart(t, now) {
    if (t.st === "run") return t;
    if (t.st === "done" || t.left <= 0) return copy(t, { st: "run", end: now + t.dur, tot: t.dur, left: t.dur });
    return copy(t, { st: "run", end: now + t.left });
  }
  function timerPause(t, now) {
    if (t.st !== "run") return t;
    return copy(t, { st: "pause", left: Math.max(0, t.end - now), end: 0 });
  }
  function timerAdd(t, ms, now) {
    if (t.st === "run") return copy(t, { end: Math.min(now + MAX_MS, t.end + ms), tot: Math.min(MAX_MS, t.tot + ms) });
    if (t.st === "done") return copy(t, { st: "run", end: now + ms, tot: ms, left: ms });
    return copy(t, { left: Math.min(MAX_MS, t.left + ms), tot: Math.min(MAX_MS, Math.max(t.tot, t.left) + ms) });
  }
  function timerReset(t) { return copy(t, { st: "idle", left: t.dur, tot: t.dur, end: 0 }); }
  // Running timers whose end has passed → done.
  function timerTick(list, now) {
    var changed = false;
    var out = list.map(function (t) {
      if (t.st === "run" && t.end <= now) { changed = true; return copy(t, { st: "done" }); }
      return t;
    });
    return { list: out, changed: changed };
  }

  /* ---------- stopwatch ---------- */
  function swNorm(o) {
    o = (o && typeof o === "object") ? o : {};
    var laps = (Array.isArray(o.laps) ? o.laps : []).filter(function (x) { return typeof x === "number" && isFinite(x) && x >= 0; }).slice(0, 999);
    for (var i = 1; i < laps.length; i++) if (laps[i] < laps[i - 1]) { laps = laps.slice(0, i); break; }
    var run = o.run === true && typeof o.start === "number" && isFinite(o.start) && o.start > 0;
    return { run: run, start: run ? o.start : 0, base: num(o.base, 0, 8.64e15, 0), laps: laps };
  }
  function swElapsed(sw, now) { return sw.base + (sw.run ? Math.max(0, now - sw.start) : 0); }
  function swToggle(sw, now) {
    if (sw.run) return { run: false, start: 0, base: swElapsed(sw, now), laps: sw.laps.slice() };
    return { run: true, start: now, base: sw.base, laps: sw.laps.slice() };
  }
  function swLap(sw, now) {
    if (!sw.run || sw.laps.length >= 999) return sw;
    return { run: true, start: sw.start, base: sw.base, laps: sw.laps.concat([swElapsed(sw, now)]) };
  }
  function swReset() { return { run: false, start: 0, base: 0, laps: [] }; }
  // [{n, lap, total, best, worst}], newest last; best / worst only with 2+ laps.
  function lapRows(laps) {
    var rows = [], prev = 0;
    (laps || []).forEach(function (tot, i) { rows.push({ n: i + 1, lap: tot - prev, total: tot, best: false, worst: false }); prev = tot; });
    if (rows.length >= 2) {
      var bi = 0, wi = 0;
      rows.forEach(function (r, i) { if (r.lap < rows[bi].lap) bi = i; if (r.lap > rows[wi].lap) wi = i; });
      if (bi !== wi) { rows[bi].best = true; rows[wi].worst = true; }
    }
    return rows;
  }
  // 00:12.34 · 1:02:03.45 (hundredths, truncated)
  function fmtSw(ms) {
    ms = Math.max(0, Math.floor(ms));
    var cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / MIN) % 60, h = Math.floor(ms / HOUR);
    return (h ? h + ":" : "") + pad(m) + ":" + pad(s) + "." + pad(cs);
  }
  // 05:00 · 1:05:00 · −00:12 (timers: whole seconds, rounded up while counting down)
  function fmtTimer(ms) {
    var neg = ms < 0, a = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
    var s = a % 60, m = Math.floor(a / 60) % 60, h = Math.floor(a / 3600);
    return (neg ? "−" : "") + (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s);
  }
  function lapsText(rows, words) {
    words = words || {};
    var lines = [(words.title || "Stopwatch") + " · " + fmtSw(rows.length ? rows[rows.length - 1].total : 0)];
    rows.forEach(function (r) {
      lines.push((words.lap || "Lap") + " " + r.n + "\t" + fmtSw(r.lap) + "\t" + fmtSw(r.total));
    });
    return lines.join("\n");
  }
  function lapsCsv(rows, head) {
    var h = head || ["Lap", "Lap time", "Total", "Lap (ms)", "Total (ms)"];
    var q = function (v) { v = String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [h.map(q).join(",")];
    rows.forEach(function (r) { out.push([r.n, fmtSw(r.lap), fmtSw(r.total), r.lap, r.total].map(q).join(",")); });
    return out.join("\r\n") + "\r\n";
  }

  var API = {
    fold: fold, lastSeg: lastSeg, cities: cities, findCity: findCity, zoneCity: zoneCity,
    cityLabel: cityLabel, zoneLabel: zoneLabel, allZones: allZones, validZone: validZone,
    searchPlaces: searchPlaces, partsIn: partsIn, offsetMin: offsetMin, midnightIn: midnightIn,
    ymd: ymd, hm: hm, pad: pad, diffLabel: diffLabel, dayDiff: dayDiff, hmMin: hmMin, isWork: isWork,
    planRows: planRows, slotIn: slotIn,
    SOUNDS: SOUNDS, MAX_TIMERS: MAX_TIMERS, timerNorm: timerNorm, timerNew: timerNew, timerLeft: timerLeft,
    timerProgress: timerProgress, timerStart: timerStart, timerPause: timerPause, timerAdd: timerAdd,
    timerReset: timerReset, timerTick: timerTick, fmtTimer: fmtTimer,
    swNorm: swNorm, swElapsed: swElapsed, swToggle: swToggle, swLap: swLap, swReset: swReset,
    lapRows: lapRows, fmtSw: fmtSw, lapsText: lapsText, lapsCsv: lapsCsv
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosClockCore = API;
})(typeof window !== "undefined" ? window : null);
