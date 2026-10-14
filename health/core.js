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
//   timesOn(d, nowMs) (today's reminder times + done, for Today)
//   Medicines and symptoms (wave 2, block near the end): normMed,
//   normDose, normRefill, normSym, normSymKind, doseKey, slotsOn,
//   dosesOn, doseState, adherence, prnTaken, stockOf, daysLeft,
//   runOutDay, lowStock, dueDoses, symKindRow, symKindList
// Data (synced slice "health", key oros-health-data):
//   { ver: 1,
//     en: [entry…] by id, ty: [type…] by id,
//     md: [medicine…], dl: [dose log…], rf: [refill…],
//     sy: [symptom…], sk: [symptom kind…] (all by id; see the
//     medicines block), set: settings | null,
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
  var COLLS = ["en", "ty", "md", "dl", "rf", "sy", "sk"];
  var NOTE_LEN = 500, NAME_LEN = 40, UNIT_LEN = 12, TAG_LEN = 24, MAX_TAGS = 6, MAX_REM = 4;
  var MAX_AT = 4102444800000;        // 2100-01-01
  var CUSTOM_MAX = 1e12;
  var HOUR = 3600000, DAY = 86400000;
  var G_PER_LB = 453.59237;
  var MGDL_PER_MMOL = 18.016;

  // Built-in measurements. v = list of [min, max, required] in storage
  // units: grams, tenths of mg/dL, hundredths of °C, minutes.
  var BUILTIN = ["bp", "wt", "gl", "sl", "hr", "tp", "o2", "st"];
  var SPEC = {
    bp: [[50, 300, 1], [20, 200, 1], [20, 250, 0]],   // systolic, diastolic, pulse (mmHg, bpm)
    wt: [[500, 500000, 1]],                            // grams
    gl: [[100, 10000, 1]],                             // tenths of mg/dL (10–1000)
    sl: [[1, 1440, 1], [0, 5, 0]],                     // minutes asleep, quality 1–5 (0 = not given)
    hr: [[20, 250, 1]],                                // bpm
    tp: [[3000, 4500, 1]],                             // hundredths of °C (30–45)
    o2: [[50, 100, 1]],                                // %
    st: [[1, 200000, 1]]                               // steps in a day (one reading per day; the
                                                       // orOS Android app brings them from Health Connect)
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
  var NORM = { en: normEntry, ty: normType, md: normMed, dl: normDose, rf: normRefill, sy: normSym, sk: normSymKind };

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
  function emptyData() { return { ver: DATA_VER, en: [], ty: [], md: [], dl: [], rf: [], sy: [], sk: [], set: null, tombs: {} }; }
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

  // Today's reminder times of every shown kind, for the Today summary:
  // → [{ t, min, done }] sorted by time, then kind. A slot counts as
  // done when a reading of that kind was taken from REM_EARLY before
  // its time until REM_EARLY before the next slot of that kind (or the
  // end of the day), so a late reading still ticks it.
  function timesOn(d, nowMs) {
    var out = [];
    if (!d || !Array.isArray(d.ty)) return out;
    var now = new Date(nowMs);
    var y = now.getFullYear(), mo = now.getMonth(), da = now.getDate();
    var end = new Date(y, mo, da + 1).getTime();
    d.ty.forEach(function (ty) {
      if (!ty || ty.h || !Array.isArray(ty.r) || !ty.r.length) return;
      var mins = ty.r.slice().sort(function (a, b) { return a - b; });
      mins.forEach(function (min, i) {
        var at = new Date(y, mo, da, Math.floor(min / 60), min % 60).getTime();
        var until = i + 1 < mins.length
          ? new Date(y, mo, da, Math.floor(mins[i + 1] / 60), mins[i + 1] % 60).getTime() - REM_EARLY
          : end;
        var done = (d.en || []).some(function (e) { return e && e.t === ty.id && e.at >= at - REM_EARLY && e.at < until; });
        out.push({ t: ty.id, min: min, done: done });
      });
    });
    return out.sort(function (a, b) { return a.min - b.min || cmpStr(a.t, b.t); });
  }

  // ---------- Medicines and symptoms (wave 2) ----------
  // Medicines ("md"), one row per medicine:
  //   { id, m, n name, s strength ("500 mg", free text), f form (FORMS),
  //     q dose in hundredths of the form's unit (100 = 1 tablet),
  //     k schedule: "d" every day | "w" weekdays (wd bit 0 = Monday) |
  //       "n" every ev days from sd | "p" as needed (no times),
  //     tm dose times (minutes, ≤ 8, sorted), wd, ev, sd start, ed end
  //     ("" = no end), rm remind 0|1, sk stock in hundredths at sa (ms;
  //     -1 = stock not tracked), pk pack size (hundredths, "Refilled"),
  //     rw warn days before running out, ar stopped 0|1, ca created
  //     (ms; unlogged doses before it are never reminded or counted),
  //     nt note, ps earlier schedules [{ u last day, k, tm, wd, ev }]
  //     (≤ 12, sorted by u): a changed schedule applies from the day
  //     of the change, so past days keep the times they had }
  // Dose log ("dl"), one row per dose marked:
  //   { id, m, md, d day, tm slot minute (-1 = as needed), s "t" taken |
  //     "s" skipped | "z" snoozed, ta when (ms; editable for taken),
  //     q amount taken (hundredths), zu snoozed until (ms) }
  //   A scheduled dose's id IS its slot: doseKey(md, d, tm) =
  //   "<md>-YYYYMMDD-HHMM", so two devices marking the same dose write
  //   the same row and the merge keeps the newer mark. As-needed doses
  //   get "<md>-YYYYMMDD-p<random>".
  // Refills ("rf"): { id, m, md, at, a (hundredths) }: separate rows, so
  //   refills on two devices add up. Stock = sk + refills since sa −
  //   doses taken since sa (stockOf).
  // Symptoms ("sy"): { id, m, k kind, at, i intensity 1–10, n, g }.
  // Symptom kinds ("sk"): { id, m, n, h }: built-in rows (SYM_BUILTIN)
  //   exist only once hidden; own kinds "s…" carry a name.
  var FORMS = ["tab", "cap", "liq", "drop", "inh", "spray", "inj", "cream", "patch", "supp", "sach", "other"];
  var SCHED = ["d", "w", "n", "p"];
  var MED_ID_RE = /^[a-z0-9]{1,20}$/;
  var MAX_TIMES = 8, MED_NAME = 60, STRENGTH_LEN = 30;
  var QTY_MAX = 100000, STOCK_MAX = 10000000;
  var LATE_AFTER = 30 * 60000;
  var SYM_BUILTIN = ["ha", "na", "dz", "ft", "pn", "cg", "br", "pl"];

  function validYmd(s) {
    if (typeof s !== "string" || !YMD_RE.test(s)) return false;
    var p = s.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getFullYear() === +p[0] && d.getMonth() === +p[1] - 1 && d.getDate() === +p[2] && +p[0] >= 1900 && +p[0] < 2100;
  }
  function ymdDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ymdAdd(s, n) { var d = ymdDate(s); return ymdOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()); }
  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY); }
  function slotAt(s, min) { var d = ymdDate(s); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), min % 60).getTime(); }
  function okMs(v) { return isInt(v) && v >= 0 && v <= MAX_AT; }
  function bits(n) { var c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

  function normTimes(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (isInt(r) && r >= 0 && r < 1440 && !seen[r] && out.length < MAX_TIMES) { seen[r] = 1; out.push(r); }
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function normSched(x, sd) {
    if (!x || typeof x !== "object" || !validYmd(x.u) || x.u < sd) return null;
    var k = SCHED.indexOf(x.k) >= 0 ? x.k : "p";
    var tm = k === "p" ? [] : normTimes(x.tm);
    if (!tm.length) k = "p";
    return { u: x.u, k: k, tm: tm,
             wd: k === "w" && isInt(x.wd) && x.wd >= 1 && x.wd <= 127 ? x.wd : 127,
             ev: k === "n" ? (isInt(x.ev) && x.ev >= 2 && x.ev <= 90 ? x.ev : 2) : 1 };
  }
  function normPs(list, sd) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      var n = normSched(x, sd);
      if (n && !seen[n.u]) { seen[n.u] = 1; out.push(n); }
    });
    out.sort(function (a, b) { return cmpStr(a.u, b.u); });
    return out.slice(-12);
  }
  function normMed(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !MED_ID_RE.test(x.id) || !stamp(x)) return null;
    var n = normStr(x.n, MED_NAME);
    if (!n || !validYmd(x.sd)) return null;
    var k = SCHED.indexOf(x.k) >= 0 ? x.k : "d";
    var tm = k === "p" ? [] : normTimes(x.tm);
    if (!tm.length) k = "p";
    var ed = validYmd(x.ed) && x.ed >= x.sd ? x.ed : "";
    var sk = isInt(x.sk) && x.sk >= 0 && x.sk <= STOCK_MAX ? x.sk : -1;
    return {
      id: x.id, m: x.m, n: n, s: normStr(x.s, STRENGTH_LEN),
      f: FORMS.indexOf(x.f) >= 0 ? x.f : "tab",
      q: isInt(x.q) && x.q >= 1 && x.q <= QTY_MAX ? x.q : 100,
      k: k, tm: tm,
      wd: k === "w" && isInt(x.wd) && x.wd >= 1 && x.wd <= 127 ? x.wd : 127,
      ev: k === "n" ? (isInt(x.ev) && x.ev >= 2 && x.ev <= 90 ? x.ev : 2) : 1,
      sd: x.sd, ed: ed,
      rm: x.rm === 0 ? 0 : 1,
      sk: sk, sa: sk >= 0 && okMs(x.sa) ? x.sa : 0,
      pk: isInt(x.pk) && x.pk >= 1 && x.pk <= STOCK_MAX ? x.pk : 3000,
      rw: isInt(x.rw) && x.rw >= 0 && x.rw <= 60 ? x.rw : 7,
      ar: x.ar ? 1 : 0,
      ca: okMs(x.ca) ? x.ca : 0,
      nt: normNote(x.nt),
      ps: normPs(x.ps, x.sd)
    };
  }
  function sameSched(a, b) {
    return a.k === b.k && a.wd === b.wd && a.ev === b.ev && a.tm.join(",") === b.tm.join(",");
  }
  // A medicine edited on day `today`: when its schedule changed and it
  // had started before today, the old schedule is kept for the days up
  // to yesterday (once per day: a second change on the same day keeps
  // the first entry). Returns the new ps list.
  function withHistory(oldMed, newMed, today) {
    var ps = (oldMed && oldMed.ps ? oldMed.ps : []).slice();
    if (!oldMed || sameSched(oldMed, newMed)) return ps;
    var y = ymdAdd(today, -1);
    if (y < oldMed.sd || ps.some(function (p) { return p.u >= y; })) return ps;
    ps.push({ u: y, k: oldMed.k, tm: oldMed.tm.slice(), wd: oldMed.wd, ev: oldMed.ev });
    return normPs(ps, oldMed.sd);
  }
  function doseKey(md, ymd, min) {
    return md + "-" + ymd.replace(/-/g, "") + "-" + pad2(Math.floor(min / 60)) + pad2(min % 60);
  }
  var PRN_RE = /^p[a-z0-9]{1,8}$/;
  function normDose(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (typeof x.md !== "string" || !MED_ID_RE.test(x.md) || !validYmd(x.d)) return null;
    if (!isInt(x.tm) || x.tm < -1 || x.tm >= 1440) return null;
    var head = x.md + "-" + x.d.replace(/-/g, "") + "-";
    if (x.tm >= 0 ? x.id !== doseKey(x.md, x.d, x.tm) : (x.id.indexOf(head) !== 0 || !PRN_RE.test(x.id.slice(head.length)))) return null;
    var s = x.s === "t" || x.s === "s" || x.s === "z" ? x.s : "";
    if (!s || (x.tm < 0 && s !== "t") || !okMs(x.ta)) return null;
    return {
      id: x.id, m: x.m, md: x.md, d: x.d, tm: x.tm, s: s, ta: x.ta,
      q: s === "t" ? (isInt(x.q) && x.q >= 1 && x.q <= QTY_MAX ? x.q : 100) : 0,
      zu: s === "z" && okMs(x.zu) ? x.zu : 0
    };
  }
  function normRefill(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (typeof x.md !== "string" || !MED_ID_RE.test(x.md) || !okMs(x.at)) return null;
    if (!isInt(x.a) || x.a < 1 || x.a > STOCK_MAX) return null;
    return { id: x.id, m: x.m, md: x.md, at: x.at, a: x.a };
  }
  function isSymBuiltin(k) { return SYM_BUILTIN.indexOf(k) >= 0; }
  function normSym(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    if (typeof x.k !== "string" || !ID_RE.test(x.k) || !okMs(x.at)) return null;
    if (!isInt(x.i) || x.i < 1 || x.i > 10) return null;
    return { id: x.id, m: x.m, k: x.k, at: x.at, i: x.i, n: normNote(x.n), g: normTags(x.g) };
  }
  function normSymKind(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var built = isSymBuiltin(x.id);
    if (!built && (x.id.charAt(0) !== "s" || x.id.length < 4)) return null;
    var n = built ? "" : normStr(x.n, NAME_LEN);
    if (!built && !n) return null;
    return { id: x.id, m: x.m, n: n, h: x.h ? 1 : 0 };
  }
  function symKindRow(d, k) {
    var list = (d && d.sk) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === k) return list[i];
    return isSymBuiltin(k) ? { id: k, m: 0, n: "", h: 0 } : null;
  }
  // Built-ins first in their fixed order, then own kinds by name.
  function symKindList(d) {
    var own = ((d && d.sk) || []).filter(function (x) { return !isSymBuiltin(x.id); });
    own.sort(function (x, y) { return cmpStr(x.n.toLowerCase(), y.n.toLowerCase()) || cmpStr(x.id, y.id); });
    return SYM_BUILTIN.map(function (k) { return symKindRow(d, k); }).concat(own);
  }

  function medById(d, id) {
    var list = (d && d.md) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // { id → log } plus, per medicine and day, its scheduled marks
  // ("@<md>@<day>" → [log]).
  function logIndex(d) {
    var idx = {};
    ((d && d.dl) || []).forEach(function (l) {
      idx[l.id] = l;
      if (l.tm >= 0) (idx["@" + l.md + "@" + l.d] = idx["@" + l.md + "@" + l.d] || []).push(l);
    });
    return idx;
  }
  // The schedule in force on a day: the first earlier schedule whose
  // last day is on or after it, else the current one.
  function schedOn(med, ymd) {
    var ps = med.ps || [];
    for (var i = 0; i < ps.length; i++) if (ymd <= ps[i].u) return ps[i];
    return med;
  }
  // Scheduled dose times of one medicine on one day ([] when none).
  function slotsOn(med, ymd) {
    if (!med || ymd < med.sd || (med.ed && ymd > med.ed)) return [];
    var sc = schedOn(med, ymd);
    if (sc.k === "p") return [];
    if (sc.k === "w" && !(sc.wd & (1 << ((ymdDate(ymd).getDay() + 6) % 7)))) return [];
    if (sc.k === "n" && (dayNum(ymd) - dayNum(med.sd)) % sc.ev !== 0) return [];
    return sc.tm.slice();
  }
  // The state of one scheduled dose at nowMs:
  //   taken | skipped | snoozed | upcoming | due | late | missed
  // late = 30 minutes past the time, still today; missed = an earlier
  // day with no mark. Before the medicine was added: "due" at most.
  function doseState(row, nowMs) {
    var l = row.log;
    if (l && l.s === "t") return "taken";
    if (l && l.s === "s") return "skipped";
    if (nowMs < row.at) return "upcoming";
    if (l && l.s === "z" && l.zu > nowMs) return "snoozed";
    if (row.pre || nowMs - row.at < LATE_AFTER) return "due";
    return ymdOf(nowMs) === row.d ? "late" : "missed";
  }
  // Every scheduled dose of one day, all medicines (stopped ones too,
  // for the history), sorted by time then name:
  //   [{ key, md, med, d, tm, at, log, pre, state, extra }]
  // A dose taken or skipped at a time that is no longer in the
  // schedule (changed the same day) still shows, marked extra.
  function dosesOn(d, ymd, nowMs, idx) {
    idx = idx || logIndex(d);
    var out = [];
    ((d && d.md) || []).forEach(function (med) {
      var slots = slotsOn(med, ymd), seen = {};
      slots.forEach(function (min) {
        var key = doseKey(med.id, ymd, min), at = slotAt(ymd, min);
        seen[min] = 1;
        var row = { key: key, md: med.id, med: med, d: ymd, tm: min, at: at, log: idx[key] || null, pre: !!(med.ca && at < med.ca), extra: false };
        row.state = doseState(row, nowMs);
        out.push(row);
      });
      (idx["@" + med.id + "@" + ymd] || []).forEach(function (l) {
        if (seen[l.tm] || l.s === "z") return;
        var row = { key: l.id, md: med.id, med: med, d: ymd, tm: l.tm, at: slotAt(ymd, l.tm), log: l, pre: false, extra: true };
        row.state = doseState(row, nowMs);
        out.push(row);
      });
    });
    return out.sort(function (a, b) { return a.at - b.at || cmpStr(a.med.n.toLowerCase(), b.med.n.toLowerCase()) || cmpStr(a.md, b.md); });
  }
  // As-needed doses taken (log rows with tm -1) of one medicine (or
  // all, md = "") between two instants, oldest first.
  function prnTaken(d, md, from, to) {
    return ((d && d.dl) || []).filter(function (l) {
      return l.tm < 0 && l.s === "t" && (!md || l.md === md) && l.ta >= from && l.ta < to;
    }).sort(function (a, b) { return a.ta - b.ta || cmpStr(a.id, b.id); });
  }
  // Adherence over the days fromYmd..toYmd (inclusive) of one medicine
  // (md) or all (md = ""). Counted: doses at least 30 minutes past
  // their time, or already marked. Doses from before the medicine was
  // added count only when marked. pct = taken / counted (null if none).
  function adherence(d, md, fromYmd, toYmd, nowMs) {
    var res = { n: 0, taken: 0, skipped: 0, missed: 0, pct: null };
    if (!d || !Array.isArray(d.md) || !validYmd(fromYmd) || !validYmd(toYmd) || fromYmd > toYmd) return res;
    var meds = d.md.filter(function (x) { return !md || x.id === md; });
    if (!meds.length) return res;
    var start = fromYmd, today = ymdOf(nowMs);
    var first = meds.reduce(function (a, x) { return x.sd < a ? x.sd : a; }, "9999-12-31");
    if (first > start) start = first;
    var end = toYmd < today ? toYmd : today;
    var idx = logIndex(d), sub = { dl: d.dl, md: meds }, guard = 0;
    for (var day = start; day <= end && guard++ < 4000; day = ymdAdd(day, 1)) {
      dosesOn(sub, day, nowMs, idx).forEach(function (r) {
        if (r.state === "taken") { res.n++; res.taken++; }
        else if (r.state === "skipped") { res.n++; res.skipped++; }
        else if ((r.state === "late" || r.state === "missed") && !r.pre) { res.n++; res.missed++; }
      });
    }
    if (res.n) res.pct = res.taken / res.n;
    return res;
  }

  // ---------- Stock ----------
  // Units left (hundredths), or null when not tracked. Can go below 0
  // when more doses were marked than the count had.
  function stockOf(d, med) {
    if (!med || med.sk < 0) return null;
    var s = med.sk;
    ((d && d.rf) || []).forEach(function (r) { if (r.md === med.id && r.at >= med.sa) s += r.a; });
    ((d && d.dl) || []).forEach(function (l) { if (l.md === med.id && l.s === "t" && l.ta >= med.sa) s -= l.q; });
    return s;
  }
  // Average use per day in hundredths (0 for as needed).
  function perDay(med) {
    if (!med || med.k === "p" || !med.tm.length) return 0;
    var per = med.tm.length * med.q;
    if (med.k === "w") per = per * bits(med.wd) / 7;
    if (med.k === "n") per = per / med.ev;
    return per;
  }
  // Whole days the stock still covers (null: not tracked or as needed).
  function daysLeft(d, med) {
    var s = stockOf(d, med), p = perDay(med);
    if (s === null || !p) return null;
    return Math.max(0, Math.floor(s / p));
  }
  // The day the stock runs out ("" when unknown or after the course).
  function runOutDay(d, med, nowMs) {
    var n = daysLeft(d, med);
    if (n === null) return "";
    var day = ymdAdd(ymdOf(nowMs), n);
    return med.ed && day > med.ed ? "" : day;
  }
  // The latest change to a medicine's count: a new count or a refill.
  function stockEpoch(d, med) {
    var e = med.sa;
    ((d && d.rf) || []).forEach(function (r) { if (r.md === med.id && r.at > e) e = r.at; });
    return e;
  }
  // Medicines running low: count tracked, taken now (not stopped, not
  // ended) and either at most rw days left (scheduled) or less than one
  // dose left (as needed). key = once per count / refill, so a warning
  // is announced once until the next refill.
  function lowStock(d, nowMs) {
    var out = [], today = ymdOf(nowMs);
    ((d && d.md) || []).forEach(function (med) {
      if (med.ar || med.sk < 0 || (med.ed && med.ed < today) || med.sd > today) return;
      var s = stockOf(d, med), days = daysLeft(d, med);
      var low = med.k === "p" ? s < med.q : (days !== null && days <= med.rw);
      if (!low) return;
      out.push({ md: med.id, med: med, left: Math.max(0, s), days: days,
                 key: "low-" + med.id + "-" + stockEpoch(d, med).toString(36) });
    });
    return out;
  }

  // ---------- Dose reminders ----------
  // A dose reminds from its time for 4 hours (as a measurement does),
  // unless it was marked, the medicine is stopped or its reminder is
  // off, or it is snoozed (it reminds again when the snooze ends, with
  // its own key). Yesterday's late-evening doses still count.
  function dueDoses(d, nowMs) {
    var out = [];
    if (!d || !Array.isArray(d.md) || !d.md.length) return out;
    var today = ymdOf(nowMs), idx = logIndex(d);
    var live = { dl: d.dl, md: d.md.filter(function (x) { return !x.ar && x.rm; }) };
    [ymdAdd(today, -1), today].forEach(function (day) {
      dosesOn(live, day, nowMs, idx).forEach(function (r) {
        if (r.pre || nowMs < r.at || nowMs - r.at >= REM_WINDOW) return;
        var l = r.log;
        if (l && (l.s === "t" || l.s === "s")) return;
        if (l && l.s === "z" && l.zu > nowMs) return;
        out.push({ key: "d-" + r.key + (l && l.s === "z" ? "-z" + l.zu.toString(36) : ""), md: r.md, med: r.med, d: r.d, tm: r.tm, at: r.at });
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
    slotKey: slotKey, ymdOf: ymdOf, timesOn: timesOn,
    FORMS: FORMS, SCHED: SCHED, MED_ID_RE: MED_ID_RE, MAX_TIMES: MAX_TIMES, MED_NAME: MED_NAME,
    STRENGTH_LEN: STRENGTH_LEN, QTY_MAX: QTY_MAX, STOCK_MAX: STOCK_MAX, LATE_AFTER: LATE_AFTER,
    SYM_BUILTIN: SYM_BUILTIN, validYmd: validYmd, ymdAdd: ymdAdd, slotAt: slotAt,
    normMed: normMed, normDose: normDose, normRefill: normRefill, normSym: normSym, normSymKind: normSymKind,
    isSymBuiltin: isSymBuiltin, symKindRow: symKindRow, symKindList: symKindList,
    medById: medById, logIndex: logIndex, schedOn: schedOn, withHistory: withHistory, doseKey: doseKey, slotsOn: slotsOn, doseState: doseState,
    dosesOn: dosesOn, prnTaken: prnTaken, adherence: adherence, stockOf: stockOf, perDay: perDay,
    daysLeft: daysLeft, runOutDay: runOutDay, lowStock: lowStock, dueDoses: dueDoses
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosHealthCore = API;
})(typeof window !== "undefined" ? window : globalThis);
