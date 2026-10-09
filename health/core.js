// ============================================================
// orOS Health — core.js (shared logic, v1.0.0)
// One file holds the model, the merge, the reference ranges, the
// statistics and the reminder math, so every page that loads it
// agrees:
//   - the Health app (health/index.html)
//   - the shell (index.html → healthCheckTick, reminders while the
//     app is closed)
//   - the tests (tests/health.test.js, through module.exports)
// Pure functions, no DOM, no network, no language: the app formats.
//
// API (window.OrosHealthCore):
//   DATA_VER, ID_RE, BUILTIN, SPEC, CTX, isBuiltin(t)
//   normEntry(x), normType(x), normSettings(x), merge(A, B)
//   emptyData(), settingsOf(d), typeRow(d, t), typeList(d)
//   G_PER_LB, MGDL_PER_MMOL, toUnit(kind, v, set), fromUnit(kind, x, set)
//   bmi(grams, heightMm), classify(d, e), sleepEnd(e)
//   inRange(list, from, to), stats(nums), movingAvg(pts, days)
//   bpSplit(entries), glucoseByCtx(entries), timeInTarget(d, entries)
//   fitnessWeights(raw), dueReminders(d, nowMs), slotKey(t, ymd, min)
// Data (synced slice "health", key oros-health-data):
//   { ver: 1,
//     en: [entry…] by id, ty: [type…] by id, set: settings | null,
//     tombs: { "<coll>:<id>": deletedAt } }
//   entry = { id, m, t, at, v: [int…], c, a, p, n, g: [tag…] }
//     t  type id ("bp", "wt", … or a custom "c…" id)
//     at measured at (ms, local wall clock of the device that typed it)
//     v  integers in storage units (SPEC below); custom = value × 1000
//     c  glucose context (CTX)   a arm 0 / 1 left / 2 right
//     p  position 0 / 1 sitting / 2 standing / 3 lying
//     n  note   g tags
//   type  = { id, m, n, u, dc, h, lo, hi, lo2, hi2, r: [minute…] }
//     built-in rows exist only once edited (hidden, targets, reminders);
//     n / u / dc only for custom types. lo / hi / lo2 / hi2 = own
//     target in storage units or null. r = reminder times (minutes
//     after midnight, max 4).
//   set   = { m, h (height mm, 0 = unknown), wu kg|lb, gu mgdl|mmol,
//             tu c|f, nm (name on the report), fw (show Workouts weights) }
// Merge: LWW per row by m, equal m → larger canonical JSON; tombstone
// wins ties; a newer edit resurrects (R5, R17, R26).
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var COLLS = ["en", "ty"];
  var NOTE_LEN = 500, NAME_LEN = 40, UNIT_LEN = 12, TAG_LEN = 24, MAX_TAGS = 6, MAX_REM = 4;
  var MAX_AT = 4102444800000;        // 2100-01-01
  var CUSTOM_MAX = 1e12;
  var HOUR = 3600000, DAY = 86400000;
  var G_PER_LB = 453.59237;
  var MGDL_PER_MMOL = 18.016;

  // Built-in measurements. v = list of [min, max, required] in storage
  // units: grams, tenths of mg/dL, hundredths of °C, minutes.
  var BUILTIN = ["bp", "wt", "gl", "sl", "hr", "tp", "o2"];
  var SPEC = {
    bp: [[50, 300, 1], [20, 200, 1], [20, 250, 0]],   // systolic, diastolic, pulse (mmHg, bpm)
    wt: [[500, 500000, 1]],                            // grams
    gl: [[100, 10000, 1]],                             // tenths of mg/dL (10–1000)
    sl: [[1, 1440, 1], [0, 5, 0]],                     // minutes asleep, quality 1–5 (0 = not given)
    hr: [[20, 250, 1]],                                // bpm
    tp: [[3000, 4500, 1]],                             // hundredths of °C (30–45)
    o2: [[50, 100, 1]]                                 // %
  };
  // Glucose context: random, fasting, before a meal, 2 h after, bedtime
  var CTX = ["rnd", "fast", "pre", "post", "bed"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isBuiltin(t) { return BUILTIN.indexOf(t) >= 0; }
  function stamp(x) { return isInt(x.m) && x.m >= 0; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  function normStr(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function normNote(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\s+$/, "").slice(0, NOTE_LEN);
  }
  function normTags(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (g) {
      var s = normStr(g, TAG_LEN), k = s.toLowerCase();
      if (s && !seen[k] && out.length < MAX_TAGS) { seen[k] = 1; out.push(s); }
    });
    return out;
  }
  function optInt(v) { return isInt(v) && Math.abs(v) <= CUSTOM_MAX ? v : null; }

  // ---------- Model ----------
  function normEntry(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (typeof x.t !== "string" || !ID_RE.test(x.t)) return null;
    if (!isInt(x.at) || x.at < 0 || x.at > MAX_AT) return null;
    if (!Array.isArray(x.v)) return null;
    var spec = SPEC[x.t], v = [];
    if (spec) {
      for (var i = 0; i < spec.length; i++) {
        var n = x.v[i], ok = isInt(n) && n >= spec[i][0] && n <= spec[i][1];
        if (!ok && spec[i][2]) return null;
        v.push(ok ? n : 0);
      }
      if (x.t === "bp" && v[1] >= v[0]) return null;      // diastolic is always below systolic
    } else {
      if (!isInt(x.v[0]) || Math.abs(x.v[0]) > CUSTOM_MAX) return null;
      v.push(x.v[0]);
    }
    return {
      id: x.id, m: x.m, t: x.t, at: x.at, v: v,
      c: x.t === "gl" && isInt(x.c) && x.c >= 0 && x.c < CTX.length ? x.c : 0,
      a: x.t === "bp" && isInt(x.a) && x.a >= 0 && x.a <= 2 ? x.a : 0,
      p: x.t === "bp" && isInt(x.p) && x.p >= 0 && x.p <= 3 ? x.p : 0,
      n: normNote(x.n),
      g: normTags(x.g)
    };
  }

  function normRem(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (isInt(r) && r >= 0 && r < 1440 && !seen[r] && out.length < MAX_REM) { seen[r] = 1; out.push(r); }
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function normType(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var built = isBuiltin(x.id);
    if (!built && x.id.charAt(0) !== "c") return null;
    var n = built ? "" : normStr(x.n, NAME_LEN);
    if (!built && !n) return null;
    var lo = optInt(x.lo), hi = optInt(x.hi), lo2 = optInt(x.lo2), hi2 = optInt(x.hi2);
    if (lo !== null && hi !== null && lo > hi) { var s = lo; lo = hi; hi = s; }
    if (lo2 !== null && hi2 !== null && lo2 > hi2) { var s2 = lo2; lo2 = hi2; hi2 = s2; }
    if (x.id !== "bp") { lo2 = null; hi2 = null; }
    return {
      id: x.id, m: x.m, n: n,
      u: built ? "" : normStr(x.u, UNIT_LEN),
      dc: built ? 0 : (isInt(x.dc) && x.dc >= 0 && x.dc <= 3 ? x.dc : 1),
      h: x.h ? 1 : 0,
      lo: lo, hi: hi, lo2: lo2, hi2: hi2,
      r: normRem(x.r)
    };
  }

  var DEF_SET = { m: 0, h: 0, wu: "kg", gu: "mgdl", tu: "c", nm: "", fw: 1 };
  function normSettings(x) {
    if (!x || typeof x !== "object" || !stamp(x)) return null;
    return {
      m: x.m,
      h: isInt(x.h) && x.h >= 500 && x.h <= 2500 ? x.h : 0,
      wu: x.wu === "lb" ? "lb" : "kg",
      gu: x.gu === "mmol" ? "mmol" : "mgdl",
      tu: x.tu === "f" ? "f" : "c",
      nm: normStr(x.nm, 60),
      fw: x.fw === 0 ? 0 : 1
    };
  }
  var NORM = { en: normEntry, ty: normType };

  function canonPick(cur, x) {
    return !cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur));
  }

  function merge(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        var i = k.indexOf(":");
        if (i < 0 || COLLS.indexOf(k.slice(0, i)) < 0 || !ID_RE.test(k.slice(i + 1)) || !isInt(tm[k]) || tm[k] < 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var out = { ver: DATA_VER };
    COLLS.forEach(function (c) {
      var best = {};
      [a[c], b[c]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = NORM[c](raw);
          if (x && canonPick(best[x.id], x)) best[x.id] = x;
        });
      });
      var rows = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var k = c + ":" + id;
        if (k in tombs && tombs[k] >= best[id].m) return;
        rows.push(best[id]);
      });
      out[c] = rows;
    });
    var sa = normSettings(a.set), sb = normSettings(b.set);
    out.set = sa && sb ? (canonPick(sa, sb) ? sb : sa) : (sa || sb || null);
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { sorted[k] = tombs[k]; });
    out.tombs = sorted;
    return out;
  }
  function emptyData() { return { ver: DATA_VER, en: [], ty: [], set: null, tombs: {} }; }
  function settingsOf(d) { return (d && d.set) || DEF_SET; }

  // The effective row of a type: the stored one, or the defaults of a
  // built-in that was never edited. null for an unknown custom id.
  function typeRow(d, t) {
    var list = (d && d.ty) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === t) return list[i];
    if (!isBuiltin(t)) return null;
    return { id: t, m: 0, n: "", u: "", dc: 0, h: 0, lo: null, hi: null, lo2: null, hi2: null, r: [] };
  }
  // Built-ins first in their fixed order, then custom types by name.
  function typeList(d) {
    var out = BUILTIN.map(function (t) { return typeRow(d, t); });
    var custom = ((d && d.ty) || []).filter(function (x) { return !isBuiltin(x.id); });
    custom.sort(function (x, y) { return cmpStr(x.n.toLowerCase(), y.n.toLowerCase()) || cmpStr(x.id, y.id); });
    return out.concat(custom);
  }

  // ---------- Units ----------
  // kind: "w" weight (grams), "g" glucose (tenths mg/dL), "t" temperature
  // (hundredths °C). toUnit gives the number shown; fromUnit the stored
  // integer (NaN when x is not a number).
  function toUnit(kind, v, set) {
    set = set || DEF_SET;
    if (kind === "w") return set.wu === "lb" ? v / G_PER_LB : v / 1000;
    if (kind === "g") return set.gu === "mmol" ? v / 10 / MGDL_PER_MMOL : v / 10;
    if (kind === "t") return set.tu === "f" ? v / 100 * 9 / 5 + 32 : v / 100;
    return v;
  }
  function fromUnit(kind, x, set) {
    set = set || DEF_SET;
    if (typeof x !== "number" || !isFinite(x)) return NaN;
    if (kind === "w") return Math.round(set.wu === "lb" ? x * G_PER_LB : x * 1000);
    if (kind === "g") return Math.round(set.gu === "mmol" ? x * MGDL_PER_MMOL * 10 : x * 10);
    if (kind === "t") return Math.round(set.tu === "f" ? (x - 32) * 5 / 9 * 100 : x * 100);
    return Math.round(x);
  }

  function bmi(grams, heightMm) {
    if (!(grams > 0) || !(heightMm > 0)) return 0;
    var m = heightMm / 1000;
    return grams / 1000 / (m * m);
  }

  // ---------- Reference ranges ----------
  // Levels: "low", "ok", "bord" (borderline / high normal), "high",
  // "vhigh"; "" when there is nothing to compare with. The user's own
  // target (from the doctor) wins over the tables.
  //   Blood pressure: ESC/ESH 2023 office categories.
  //   Glucose: ADA (fasting / before a meal; 2 h after; other times).
  //   Weight: BMI (WHO) when the height is known.
  // The app records, it does not diagnose: the labels say so.
  function ownLevel(val, lo, hi) {
    if (lo === null && hi === null) return "";
    if (lo !== null && val < lo) return "low";
    if (hi !== null && val > hi) return "high";
    return "ok";
  }
  function worst(a, b) {
    var rank = { "": 0, ok: 1, bord: 2, low: 3, high: 4, vhigh: 5 };
    return rank[b] > rank[a] ? b : a;
  }
  function classify(d, e) {
    if (!e) return "";
    var ty = typeRow(d, e.t), v = e.v;
    if (!ty) return "";
    var own = ownLevel(v[0], ty.lo, ty.hi);
    if (e.t === "bp") {
      var own2 = ownLevel(v[1], ty.lo2, ty.hi2);
      if (own || own2) return worst(own, own2) || "ok";
      var s = v[0], di = v[1];
      if (s >= 180 || di >= 110) return "vhigh";
      if (s >= 140 || di >= 90) return "high";
      if (s < 90 || di < 60) return "low";
      if (s >= 130 || di >= 85) return "bord";
      return "ok";
    }
    if (own) return own;
    var x = v[0];
    switch (e.t) {
      case "gl":
        if (x < 700) return "low";
        if (e.c === 1 || e.c === 2) return x < 1000 ? "ok" : x < 1260 ? "bord" : "high";
        return x < 1400 ? "ok" : x < 2000 ? "bord" : "high";
      case "wt":
        var b = bmi(x, settingsOf(d).h);
        if (!b) return "";
        return b < 18.5 ? "low" : b < 25 ? "ok" : b < 30 ? "bord" : "high";
      case "sl":
        return x < 420 ? "low" : x > 540 ? "bord" : "ok";
      case "hr":
        return x < 50 ? "low" : x <= 100 ? "ok" : x <= 120 ? "bord" : "high";
      case "tp":
        return x < 3500 ? "low" : x < 3750 ? "ok" : x < 3800 ? "bord" : "high";
      case "o2":
        return x >= 95 ? "ok" : x >= 92 ? "bord" : "low";
    }
    return "";
  }
  // Sleep is typed as "went to bed at" (at) + minutes asleep (v[0]).
  function sleepEnd(e) { return e.at + e.v[0] * 60000; }

  // ---------- Statistics ----------
  function byAt(x, y) { return x.at - y.at || cmpStr(x.id, y.id); }
  function inRange(list, from, to) {
    return (list || []).filter(function (e) { return e.at >= from && e.at < to; }).sort(byAt);
  }
  function stats(nums) {
    if (!nums.length) return null;
    var sum = 0, lo = Infinity, hi = -Infinity;
    nums.forEach(function (n) { sum += n; if (n < lo) lo = n; if (n > hi) hi = n; });
    return { n: nums.length, avg: sum / nums.length, min: lo, max: hi };
  }
  // Trailing moving average over `days` calendar days. pts sorted by x.
  function movingAvg(pts, days) {
    var out = [], win = days * DAY, j = 0, sum = 0;
    for (var i = 0; i < pts.length; i++) {
      sum += pts[i].y;
      while (pts[j].x <= pts[i].x - win) { sum -= pts[j].y; j++; }
      out.push({ x: pts[i].x, y: sum / (i - j + 1) });
    }
    return out;
  }
  // Morning (before 12:00) and evening (from 12:00) blood pressure,
  // the split most doctors ask for with home readings.
  function bpSplit(entries) {
    var am = [], pm = [];
    entries.forEach(function (e) {
      if (e.t !== "bp") return;
      (new Date(e.at).getHours() < 12 ? am : pm).push(e);
    });
    function pack(list) {
      if (!list.length) return null;
      return { n: list.length,
               s: stats(list.map(function (e) { return e.v[0]; })).avg,
               d: stats(list.map(function (e) { return e.v[1]; })).avg };
    }
    return { am: pack(am), pm: pack(pm) };
  }
  function glucoseByCtx(entries) {
    var out = {};
    entries.forEach(function (e) {
      if (e.t !== "gl") return;
      (out[e.c] = out[e.c] || []).push(e.v[0]);
    });
    Object.keys(out).forEach(function (k) { out[k] = stats(out[k]); });
    return out;
  }
  // Share of readings classified "ok" (own target or the tables).
  function timeInTarget(d, entries) {
    var n = 0, ok = 0;
    entries.forEach(function (e) {
      var lv = classify(d, e);
      if (!lv) return;
      n++;
      if (lv === "ok") ok++;
    });
    return n ? ok / n : null;
  }

  // ---------- Workouts weights (read only) ----------
  // Body weights from the Workouts app (oros-fitness-data, rows "bm":
  // id = "YYYY-MM-DD", w = grams). Never written from here.
  function fitnessWeights(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.bm)) return [];
    var tombs = raw.tombs && typeof raw.tombs === "object" ? raw.tombs : {};
    var seen = {}, out = [];
    raw.bm.forEach(function (b) {
      if (!b || typeof b.id !== "string" || !YMD_RE.test(b.id) || seen[b.id]) return;
      if (!isInt(b.w) || b.w < 500 || b.w > 500000 || !isInt(b.m)) return;
      var tm = tombs["bm:" + b.id];
      if (isInt(tm) && tm >= b.m) return;
      var p = b.id.split("-");
      var at = new Date(+p[0], +p[1] - 1, +p[2], 12, 0).getTime();
      if (!isFinite(at)) return;
      seen[b.id] = 1;
      out.push({ d: b.id, at: at, g: b.w });
    });
    return out.sort(function (x, y) { return x.at - y.at; });
  }

  // ---------- Reminders ----------
  // A reminder time is due from that minute for 4 hours, unless the
  // measurement was already taken from one hour before it. Hidden
  // types never remind. One key per type, day and time, so two
  // devices (and the inbox dedup) agree.
  var REM_WINDOW = 4 * HOUR, REM_EARLY = HOUR;
  function slotKey(t, ymd, min) { return "r-" + t + "-" + ymd + "-" + pad2(Math.floor(min / 60)) + pad2(min % 60); }
  function dueReminders(d, nowMs) {
    var out = [];
    if (!d || !Array.isArray(d.ty)) return out;
    var now = new Date(nowMs);
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var today = ymdOf(nowMs);
    d.ty.forEach(function (ty) {
      if (ty.h || !ty.r || !ty.r.length) return;
      ty.r.forEach(function (min) {
        var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(min / 60), min % 60).getTime();
        if (at < midnight || nowMs < at || nowMs - at >= REM_WINDOW) return;
        var done = (d.en || []).some(function (e) { return e.t === ty.id && e.at >= at - REM_EARLY && e.at <= nowMs + 60000; });
        if (!done) out.push({ t: ty.id, min: min, key: slotKey(ty.id, today, min) });
      });
    });
    return out;
  }

  var API = {
    DATA_VER: DATA_VER, ID_RE: ID_RE, BUILTIN: BUILTIN, SPEC: SPEC, CTX: CTX, DEF_SET: DEF_SET,
    G_PER_LB: G_PER_LB, MGDL_PER_MMOL: MGDL_PER_MMOL, NOTE_LEN: NOTE_LEN, NAME_LEN: NAME_LEN,
    UNIT_LEN: UNIT_LEN, TAG_LEN: TAG_LEN, MAX_TAGS: MAX_TAGS, MAX_REM: MAX_REM, CUSTOM_MAX: CUSTOM_MAX,
    isBuiltin: isBuiltin, normEntry: normEntry, normType: normType, normSettings: normSettings,
    merge: merge, emptyData: emptyData, settingsOf: settingsOf, typeRow: typeRow, typeList: typeList,
    toUnit: toUnit, fromUnit: fromUnit, bmi: bmi, classify: classify, sleepEnd: sleepEnd,
    inRange: inRange, stats: stats, movingAvg: movingAvg, bpSplit: bpSplit, glucoseByCtx: glucoseByCtx,
    timeInTarget: timeInTarget, fitnessWeights: fitnessWeights, dueReminders: dueReminders,
    slotKey: slotKey, ymdOf: ymdOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosHealthCore = API;
})(typeof window !== "undefined" ? window : globalThis);
