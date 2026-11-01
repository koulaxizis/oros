// ============================================================
// orOS Typing Tutor: data model and scoring (pure, no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// TYPING v1, slice "typing", localStorage "oros-typing-data":
//   { ver: 1,
//     set:  { m, lay "el"|"en"|"de"|"elp"|"dv"|"cm", goal minutes 1-120, hint "auto"|"on"|"off",
//             err "stop"|"go", kid 0|1, fs 1-3 text size, rs reset stamp },
//     prog: { "<lay>|<lesson id>": { s stars 0-3, w best wpm, a best accuracy %, m } },
//     days: { "<yyyymmdd>|<dev>": { ms practice time, ch characters right, er errors, n runs, m } },
//     keys: { "<lay>|<dev>": { m, k: { "<char>": [right, wrong, ms spent on the right ones] } } },
//     best: { "<lay>|<test minutes>": { w, a, t, m } } }
// Sync rules (OROS_BIBLE.md Part I R5/R17/R26):
//   - set: last write wins by m, a tie goes to the larger JSON;
//   - prog: every number takes the max, so progress is never lost;
//   - days, keys: one row per device, written only by that device,
//     last write wins by m; totals add the devices up;
//   - best: the higher wpm wins (then accuracy, then the newer t);
//   - set.rs (Reset progress) drops every row with m < rs, on every
//     device, inside the merge; days keep the 400 newest dates.
//   merge is symmetric, idempotent and associative, never reads the
//   clock and drops a bad row instead of repairing it.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  // wave 4 adds elp (polytonic), dv (Dvorak), cm (Colemak): a device on
  // 4.84.00 or older drops their rows when it saves; every newer device
  // keeps them (each merge is a union), so nothing is lost for good.
  var LAYS = ["el", "en", "de", "elp", "dv", "cm"];
  var HINTS = ["auto", "on", "off"];
  var ERRS = ["stop", "go"];
  var MAX_DAYS = 400;
  var MAX_KEYS = 200;

  function defSet() { return { m: 0, lay: "", goal: 10, hint: "auto", err: "stop", kid: 0, fs: 2, rs: 0 }; }
  function empty() { return { ver: VER, set: defSet(), prog: {}, days: {}, keys: {}, best: {} }; }

  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function int(v) { return Math.round(v); }
  function ms(v) { return num(v, 1, 1e15) ? Math.floor(v) : 0; }
  function canon(o) { return JSON.stringify(o); }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  var ID_RE = /^[a-z0-9]{1,6}$/;
  var DEV_RE = /^[a-z0-9]{1,12}$/;

  function cleanSet(s) {
    if (!isObj(s)) return null;
    var d = defSet();
    return {
      m: ms(s.m), lay: LAYS.indexOf(s.lay) >= 0 ? s.lay : d.lay,
      goal: num(s.goal, 1, 120) ? int(s.goal) : d.goal,
      hint: HINTS.indexOf(s.hint) >= 0 ? s.hint : d.hint,
      err: ERRS.indexOf(s.err) >= 0 ? s.err : d.err,
      kid: s.kid === 1 ? 1 : 0,
      fs: num(s.fs, 1, 3) ? int(s.fs) : d.fs,
      rs: ms(s.rs)
    };
  }
  function cleanProg(k, v) {
    var p = k.split("|");
    if (p.length !== 2 || LAYS.indexOf(p[0]) < 0 || !ID_RE.test(p[1]) || !isObj(v)) return null;
    var m = ms(v.m);
    if (!m) return null;
    return { s: num(v.s, 0, 3) ? int(v.s) : 0, w: num(v.w, 0, 400) ? int(v.w) : 0, a: num(v.a, 0, 100) ? int(v.a) : 0, m: m };
  }
  function cleanDay(k, v) {
    var p = k.split("|");
    if (p.length !== 2 || !/^\d{8}$/.test(p[0]) || !DEV_RE.test(p[1]) || !isObj(v)) return null;
    var m = ms(v.m);
    if (!m) return null;
    return {
      ms: num(v.ms, 0, 864e5) ? int(v.ms) : 0, ch: num(v.ch, 0, 1e7) ? int(v.ch) : 0,
      er: num(v.er, 0, 1e7) ? int(v.er) : 0, n: num(v.n, 0, 1e5) ? int(v.n) : 0, m: m
    };
  }
  function cleanKeys(k, v) {
    var p = k.split("|");
    if (p.length !== 2 || LAYS.indexOf(p[0]) < 0 || !DEV_RE.test(p[1]) || !isObj(v) || !isObj(v.k)) return null;
    var m = ms(v.m);
    if (!m) return null;
    var out = { m: m, k: {} };
    Object.keys(v.k).sort().slice(0, MAX_KEYS).forEach(function (ch) {
      var a = v.k[ch];
      if (Array.from(ch).length !== 1 || !Array.isArray(a) || a.length !== 3) return;
      if (!a.every(function (x) { return num(x, 0, 1e12); })) return;
      out.k[ch] = [int(a[0]), int(a[1]), int(a[2])];
    });
    return out;
  }
  function cleanBest(k, v) {
    var p = k.split("|");
    if (p.length !== 2 || LAYS.indexOf(p[0]) < 0 || ["1", "2", "5"].indexOf(p[1]) < 0 || !isObj(v)) return null;
    var m = ms(v.m), t = ms(v.t);
    if (!m || !t || !num(v.w, 0, 400) || !num(v.a, 0, 100)) return null;
    return { w: int(v.w), a: int(v.a), t: t, m: m };
  }

  function lww(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function maxProg(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { s: Math.max(a.s, b.s), w: Math.max(a.w, b.w), a: Math.max(a.a, b.a), m: Math.max(a.m, b.m) };
  }
  function betterBest(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.w !== b.w) return a.w > b.w ? a : b;
    if (a.a !== b.a) return a.a > b.a ? a : b;
    if (a.t !== b.t) return a.t > b.t ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }

  function sorted(o) {
    var out = {};
    Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  function mergeAll(list) {
    // The settings first: their reset stamp decides which rows count,
    // before any row is combined with another (a row from before a
    // reset never lifts a newer one).
    var set = null, prog = {}, days = {}, keys = {}, best = {};
    list.forEach(function (d) {
      var s = isObj(d) ? cleanSet(d.set) : null;
      if (s) set = lww(set, s);
    });
    var out = empty();
    out.set = set || defSet();
    var rs = out.set.rs;
    list.forEach(function (d) {
      if (!isObj(d)) return;
      [["prog", cleanProg, maxProg, prog], ["days", cleanDay, lww, days],
       ["keys", cleanKeys, lww, keys], ["best", cleanBest, betterBest, best]].forEach(function (x) {
        var src = isObj(d[x[0]]) ? d[x[0]] : {};
        Object.keys(src).forEach(function (k) {
          var v = x[1](k, src[k]);
          if (v && v.m >= rs) x[3][k] = x[2](x[3][k], v);
        });
      });
    });
    out.prog = sorted(prog);
    out.keys = sorted(keys);
    out.best = sorted(best);
    // days: the 400 newest dates (every device's row of a kept date)
    var kd = days, dates = {};
    Object.keys(kd).forEach(function (k) { dates[k.slice(0, 8)] = true; });
    var newest = Object.keys(dates).sort().reverse().slice(0, MAX_DAYS);
    var cut = newest.length ? newest[newest.length - 1] : "";
    var dd = {};
    Object.keys(kd).forEach(function (k) { if (k.slice(0, 8) >= cut) dd[k] = kd[k]; });
    out.days = sorted(dd);
    return out;
  }

  function normalize(d) { return mergeAll([d]); }
  function merge(a, b) { return mergeAll([a, b]); }
  function serialize(d) { return canon(normalize(d)); }

  // ---------- dates ----------
  function ymd(t) {
    var d = new Date(t);
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }

  // ---------- scoring ----------
  // A run: { chars (right characters), errors (wrong presses), ms, keys }.
  // wpm = right characters / 5 per minute; accuracy = right / (right + wrong).
  function wpm(chars, msTime) { return msTime > 0 ? Math.min(400, Math.round((chars / 5) / (msTime / 60000))) : 0; }
  function accuracy(chars, errors) { return chars + errors > 0 ? Math.round(100 * chars / (chars + errors)) : 100; }
  // Stars: 1 = finished with 90 % or more; 2 = 95 % and 15 wpm;
  // 3 = 98 % and 25 wpm. Review lessons ask the same.
  // Kids mode (wave 3): accuracy only, 85 / 92 / 97 %.
  function stars(w, a, kid) {
    if (kid) return a >= 97 ? 3 : a >= 92 ? 2 : a >= 85 ? 1 : 0;
    if (a >= 98 && w >= 25) return 3;
    if (a >= 95 && w >= 15) return 2;
    if (a >= 90) return 1;
    return 0;
  }

  // ---------- edits (the app passes the clock and the device in) ----------
  function setPrefs(d, patch, now) {
    var out = normalize(d), s = Object.assign({}, out.set);
    ["lay", "goal", "hint", "err", "kid", "fs"].forEach(function (k) { if (patch[k] !== undefined) s[k] = patch[k]; });
    s.m = Math.max(now, out.set.m + 1);
    var c = cleanSet(s);
    if (c) out.set = c;
    return normalize(out);
  }

  function resetProgress(d, now) {
    var out = normalize(d), s = Object.assign({}, out.set);
    s.m = Math.max(now, out.set.m + 1);
    s.rs = s.m;
    out.set = cleanSet(s);
    return normalize(out);
  }

  // run = { lay, lesson?, test? (minutes), kid? (kids' stars), chars, errors, ms, keys: {char: [right, wrong, ms]} }
  function record(d, run, now, dev) {
    var out = normalize(d), lay = run.lay, m = Math.max(now, out.set.rs);
    if (LAYS.indexOf(lay) < 0 || !DEV_RE.test(dev)) return out;
    var w = wpm(run.chars, run.ms), a = accuracy(run.chars, run.errors);
    // the day
    var dk = ymd(now) + "|" + dev, day = out.days[dk] || { ms: 0, ch: 0, er: 0, n: 0, m: 0 };
    out.days[dk] = {
      ms: Math.min(864e5, day.ms + Math.max(0, Math.round(run.ms))), ch: day.ch + run.chars,
      er: day.er + run.errors, n: day.n + 1, m: Math.max(m, day.m + 1)
    };
    // keys
    var kk = lay + "|" + dev, row = out.keys[kk] || { m: 0, k: {} }, k = {};
    Object.keys(row.k).forEach(function (c) { k[c] = row.k[c].slice(); });
    Object.keys(run.keys || {}).forEach(function (c) {
      var v = run.keys[c], o = k[c] || [0, 0, 0];
      k[c] = [o[0] + (v[0] || 0), o[1] + (v[1] || 0), o[2] + Math.round(v[2] || 0)];
    });
    out.keys[kk] = { m: Math.max(m, row.m + 1), k: k };
    // lesson progress
    if (run.lesson && ID_RE.test(run.lesson)) {
      var pk = lay + "|" + run.lesson;
      out.prog[pk] = maxProg(out.prog[pk], { s: stars(w, a, !!run.kid), w: w, a: a, m: m });
    }
    // speed test record
    if (run.test && [1, 2, 5].indexOf(run.test) >= 0) {
      var bk = lay + "|" + run.test;
      out.best[bk] = betterBest(out.best[bk], { w: w, a: a, t: now, m: m });
    }
    return normalize(out);
  }

  // ---------- reading ----------
  function todayMs(d, now) {
    var day = ymd(now), sum = 0;
    Object.keys(d.days).forEach(function (k) { if (k.slice(0, 8) === day) sum += d.days[k].ms; });
    return sum;
  }
  // Every date with practice, devices added up, newest first.
  function history(d) {
    var by = {};
    Object.keys(d.days).forEach(function (k) {
      var day = k.slice(0, 8), r = d.days[k], o = by[day] || (by[day] = { day: day, ms: 0, ch: 0, er: 0, n: 0 });
      o.ms += r.ms; o.ch += r.ch; o.er += r.er; o.n += r.n;
    });
    return Object.keys(by).sort().reverse().map(function (k) { return by[k]; });
  }
  // Days in a row up to today (or up to yesterday when today is empty).
  function streak(d, now) {
    var have = {};
    history(d).forEach(function (h) { if (h.ms > 0) have[h.day] = true; });
    var n = 0, t = new Date(now);
    t.setHours(12, 0, 0, 0);
    if (!have[ymd(t.getTime())]) t.setDate(t.getDate() - 1);
    while (have[ymd(t.getTime())]) { n++; t.setDate(t.getDate() - 1); }
    return n;
  }
  // Per character of a layout, devices added up: {char: {r, w, ms}}.
  function keyStats(d, lay) {
    var out = {};
    Object.keys(d.keys).forEach(function (k) {
      if (k.split("|")[0] !== lay) return;
      var row = d.keys[k].k;
      Object.keys(row).forEach(function (c) {
        var o = out[c] || (out[c] = { r: 0, w: 0, ms: 0 });
        o.r += row[c][0]; o.w += row[c][1]; o.ms += row[c][2];
      });
    });
    return out;
  }
  function progress(d, lay, id) { return d.prog[lay + "|" + id] || null; }

  var API = {
    VER: VER, LAYS: LAYS, empty: empty, normalize: normalize, merge: merge, serialize: serialize,
    ymd: ymd, wpm: wpm, accuracy: accuracy, stars: stars,
    setPrefs: setPrefs, resetProgress: resetProgress, record: record,
    todayMs: todayMs, history: history, streak: streak, keyStats: keyStats, progress: progress
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingCore = API;
})(typeof window !== "undefined" ? window : globalThis);
