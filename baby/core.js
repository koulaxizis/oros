// ============================================================
// orOS Baby — shared core (v1.0.0)
// The pure model of the Baby app (feeds, sleep, nappies, growth,
// milestones). No DOM, no storage writes. Exposes
// window.orosBabyCore and, under Node, module.exports
// (tests/baby.test.js).
//
// Data (synced slice "baby", key oros-baby-data):
//   { ver: 1,
//     kids: [ { id, n, b, s, c, m } ]                 sorted by id
//       n name · b birth "YYYY-MM-DD" · s "f"|"m"|"" · c colour 0-5
//     ev:   [ { id, k, t, ts, e?, ... , m } ]         sorted by id
//       k kid id · t type (TYPES) · ts start · e end (a running
//       timer has no e) · per type: ls/rs breast seconds, cur/cs
//       running side + segment start, sd side, ml, x sub-kind,
//       v value, tx text
//     gr:   [ { id, k, d, g?, l?, h?, m } ]           growth
//       d day · g grams · l length mm · h head mm
//     mk:   [ { id, k, t, key?, tx?, d, nt?, m } ]    marks
//       t "ms" milestone | "vac" vaccine | "doc" doctor visit
//       a seed milestone has key and id = kid id + "x" + key, so
//       two devices that tick the same milestone merge into one
//     prefs: { wu, tu, vu }, pm }                     units + stamp
//   - every record: per id, newer m wins, a tombstone { id, m,
//     del: 1 } wins ties (R5, R17); prefs travel as one record,
//     newer pm wins; arrays sorted by id, fixed key order (R26)
//   - a running timer is an event without e; stopping it on any
//     device is an edit of that same event, so it merges like one
// Sections:
//   1. Constants + helpers
//   2. Normalize + merge
//   3. Queries: per kid, per day, timers
//   4. Day maths: totals, sleep split, week
//   5. Age + formatting
//   6. Export: CSV, summary
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION     = "1.0.0";
  var STORAGE_KEY = "oros-baby-data";
  var DATA_VER    = 1;
  var DAY_MS      = 86400000;
  var TYPES = ["feed", "bottle", "solid", "sleep", "diaper", "pump", "med", "temp", "bath", "tummy", "note"];
  var TIMED = { feed: 1, sleep: 1 };          // may run (no end yet)
  var SUBS = {
    bottle: ["bm", "fm"],                     // breast milk · formula
    solid:  ["y", "n", "a"],                  // liked · refused · reaction
    diaper: ["w", "d", "wd"]                  // wet · dirty · both
  };
  var SIDES = ["l", "r", "b"];
  var LIM = {
    name:  40,
    text:  200,
    sec:   [0, 4 * 3600],         // breast seconds per side
    span:  DAY_MS,                // longest event (ts → e)
    ml:    [1, 500],              // bottle
    pump:  [1, 1000],
    temp:  [340, 430],            // tenths of °C
    tummy: [1, 180],              // minutes
    g:     [300, 30000],          // grams
    l:     [300, 1300],           // mm
    h:     [250, 600]             // mm
  };
  var DEFAULT_PREFS = { wu: "kg", tu: "c", vu: "ml" };
  var MILESTONES = [
    ["smile",  "First smile",            "Πρώτο χαμόγελο"],
    ["laugh",  "First laugh",            "Πρώτο γέλιο"],
    ["head",   "Holds head up",          "Κρατά το κεφάλι"],
    ["roll",   "Rolls over",             "Γυρίζει μπρούμυτα"],
    ["sit",    "Sits without support",   "Κάθεται χωρίς στήριξη"],
    ["solid",  "First solid food",       "Πρώτη στερεή τροφή"],
    ["tooth",  "First tooth",            "Πρώτο δόντι"],
    ["crawl",  "Crawls",                 "Μπουσουλάει"],
    ["stand",  "Stands with support",    "Στέκεται με στήριξη"],
    ["word",   "First word",             "Πρώτη λέξη"],
    ["wave",   "Waves bye-bye",          "Κάνει «γεια»"],
    ["walk",   "First steps",            "Πρώτα βήματα"]
  ];
  var MS_KEYS = MILESTONES.map(function (x) { return x[0]; });
  var MARK_TYPES = ["ms", "vac", "doc"];
  var ID_RE  = /^[a-z0-9]{6,60}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function inRange(v, r) { return isInt(v) && v >= r[0] && v <= r[1]; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function cleanText(s, max) {
    if (typeof s !== "string") return "";
    // no control characters, collapsed to one line
    s = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max).trim() : s;
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayKeyOf(ts) { return dayKey(new Date(ts)); }
  function keyDate(key) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }
  function addDays(key, n) {
    var d = keyDate(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  function validDay(key) {
    if (typeof key !== "string" || !DAY_RE.test(key)) return false;
    var d = keyDate(key);
    return !!d && dayKey(d) === key;
  }
  function dayStart(key) { return keyDate(key).getTime(); }
  function dayEnd(key) { return keyDate(addDays(key, 1)).getTime(); }

  function newId() {
    var r = new Uint32Array(2);
    (root.crypto || require("crypto").webcrypto).getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function msId(kid, key) { return kid + "x" + key; }

  // ---------- 2. Normalize + merge ----------
  function stampOk(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }
  function tomb(x) { return { id: x.id, m: x.m, del: 1 }; }
  function kidOk(k) { return typeof k === "string" && ID_RE.test(k); }

  function normKid(x) {
    if (!stampOk(x)) return null;
    if (x.del) return tomb(x);
    var n = cleanText(x.n, LIM.name);
    if (!n || !validDay(x.b)) return null;
    return {
      id: x.id, n: n, b: x.b,
      s: (x.s === "f" || x.s === "m") ? x.s : "",
      c: inRange(x.c, [0, 5]) ? x.c : 0,
      m: x.m
    };
  }

  // One event; the fields kept depend on its type (fixed order).
  function normEv(x) {
    if (!stampOk(x)) return null;
    if (x.del) return tomb(x);
    if (!kidOk(x.k) || TYPES.indexOf(x.t) < 0 || !isInt(x.ts) || x.ts <= 0) return null;
    var o = { id: x.id, k: x.k, t: x.t, ts: x.ts };
    var hasEnd = isInt(x.e) && x.e >= x.ts && x.e - x.ts <= LIM.span;
    if (TIMED[x.t]) {
      if (hasEnd) o.e = x.e;
    } else if (hasEnd && x.e > x.ts) {
      o.e = x.e;
    }
    switch (x.t) {
      case "feed":
        o.ls = inRange(x.ls, LIM.sec) ? x.ls : 0;
        o.rs = inRange(x.rs, LIM.sec) ? x.rs : 0;
        if (o.e === undefined && (x.cur === "l" || x.cur === "r") && isInt(x.cs) && x.cs >= x.ts) {
          o.cur = x.cur;
          o.cs = x.cs;
        }
        o.sd = (x.sd === "l" || x.sd === "r") ? x.sd : (o.cur || (o.rs > o.ls ? "r" : "l"));
        break;
      case "bottle":
        if (!inRange(x.ml, LIM.ml)) return null;
        o.ml = x.ml;
        o.x = SUBS.bottle.indexOf(x.x) >= 0 ? x.x : "bm";
        break;
      case "solid":
        o.x = SUBS.solid.indexOf(x.x) >= 0 ? x.x : "y";
        break;
      case "diaper":
        if (SUBS.diaper.indexOf(x.x) < 0) return null;
        o.x = x.x;
        break;
      case "pump":
        if (!inRange(x.ml, LIM.pump)) return null;
        o.ml = x.ml;
        o.sd = SIDES.indexOf(x.sd) >= 0 ? x.sd : "b";
        break;
      case "temp":
        if (!inRange(x.v, LIM.temp)) return null;
        o.v = x.v;
        break;
      case "tummy":
        if (!inRange(x.v, LIM.tummy)) return null;
        o.v = x.v;
        break;
    }
    var tx = cleanText(x.tx, LIM.text);
    if ((x.t === "med" || x.t === "note") && !tx) return null;
    if (tx) o.tx = tx;
    o.m = x.m;
    return o;
  }

  function normGr(x) {
    if (!stampOk(x)) return null;
    if (x.del) return tomb(x);
    if (!kidOk(x.k) || !validDay(x.d)) return null;
    var o = { id: x.id, k: x.k, d: x.d };
    if (inRange(x.g, LIM.g)) o.g = x.g;
    if (inRange(x.l, LIM.l)) o.l = x.l;
    if (inRange(x.h, LIM.h)) o.h = x.h;
    if (o.g === undefined && o.l === undefined && o.h === undefined) return null;
    o.m = x.m;
    return o;
  }

  function normMk(x) {
    if (!stampOk(x)) return null;
    if (x.del) return tomb(x);
    if (!kidOk(x.k) || MARK_TYPES.indexOf(x.t) < 0 || !validDay(x.d)) return null;
    var o = { id: x.id, k: x.k, t: x.t };
    if (x.t === "ms" && MS_KEYS.indexOf(x.key) >= 0) {
      if (x.id !== msId(x.k, x.key)) return null;   // one record per seed milestone
      o.key = x.key;
    } else {
      var tx = cleanText(x.tx, LIM.text);
      if (!tx) return null;
      o.tx = tx;
    }
    o.d = x.d;
    var nt = cleanText(x.nt, LIM.text);
    if (nt) o.nt = nt;
    o.m = x.m;
    return o;
  }

  function normPrefs(p) {
    p = (p && typeof p === "object") ? p : {};
    return {
      wu: p.wu === "lb" ? "lb" : "kg",
      tu: p.tu === "f" ? "f" : "c",
      vu: p.vu === "oz" ? "oz" : "ml"
    };
  }

  // Newer m wins; equal m: a tombstone wins, then the larger JSON
  // (symmetric, so both devices pick the same record).
  function better(x, cur) {
    if (!cur) return true;
    if (x.m !== cur.m) return x.m > cur.m;
    if (!!x.del !== !!cur.del) return !!x.del;
    return JSON.stringify(x) > JSON.stringify(cur);
  }
  function mergeList(a, b, norm) {
    var best = {};
    [a, b].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = norm(raw);
        if (x && better(x, best[x.id])) best[x.id] = x;
      });
    });
    return Object.keys(best).sort(cmpStr).map(function (id) { return best[id]; });
  }

  function mergeBaby(A, B) {
    var a = (A && typeof A === "object") ? A : {};
    var b = (B && typeof B === "object") ? B : {};
    var pa = isInt(a.pm) && a.pm > 0 ? a.pm : 0;
    var pb = isInt(b.pm) && b.pm > 0 ? b.pm : 0;
    var prefs, pm;
    if (pa !== pb) {
      prefs = normPrefs(pa > pb ? a.prefs : b.prefs);
      pm = Math.max(pa, pb);
    } else {
      var na = normPrefs(a.prefs), nb = normPrefs(b.prefs);
      prefs = JSON.stringify(na) >= JSON.stringify(nb) ? na : nb;
      pm = pa;
    }
    return {
      ver: DATA_VER,
      kids: mergeList(a.kids, b.kids, normKid),
      ev: mergeList(a.ev, b.ev, normEv),
      gr: mergeList(a.gr, b.gr, normGr),
      mk: mergeList(a.mk, b.mk, normMk),
      prefs: prefs,
      pm: pm
    };
  }
  function normalize(x) { return mergeBaby(x, x); }
  function empty() { return normalize(null); }

  function looksLikeData(o) {
    return !!o && typeof o === "object" && Array.isArray(o.kids) && Array.isArray(o.ev);
  }
  // Parse what localStorage holds; null when it is unreadable (the
  // caller keeps a rescue copy), an empty model when there is none.
  function parse(raw) {
    if (raw === null || raw === undefined || raw === "") return empty();
    try {
      var o = JSON.parse(raw);
      if (looksLikeData(o)) return normalize(o);
    } catch (e) {}
    return null;
  }

  // ---------- 3. Queries ----------
  function live(list) { return list.filter(function (x) { return !x.del; }); }
  function liveKids(data) {
    return live(data.kids).sort(function (x, y) { return cmpStr(x.b, y.b) || cmpStr(x.id, y.id); });
  }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function byTime(x, y) { return x.ts - y.ts || cmpStr(x.id, y.id); }
  function kidEvents(data, kid) {
    return data.ev.filter(function (e) { return !e.del && e.k === kid; }).sort(byTime);
  }
  // Events that touch the day (a sleep across midnight shows on both).
  function dayEvents(data, kid, key) {
    var s = dayStart(key), en = dayEnd(key);
    return kidEvents(data, kid).filter(function (e) {
      var end = e.e !== undefined ? e.e : e.ts;
      if (TIMED[e.t] && e.e === undefined) end = Math.max(e.ts, Date.now());
      return (e.ts >= s && e.ts < en) || (TIMED[e.t] && e.ts < s && end > s);
    });
  }
  function running(data, kid) {
    return kidEvents(data, kid).filter(function (e) { return TIMED[e.t] && e.e === undefined; });
  }
  function lastOf(data, kid, types, now) {
    var list = kidEvents(data, kid), pick = null;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (types.indexOf(e.t) >= 0 && e.ts <= now) pick = e;
    }
    return pick;
  }

  // Breast seconds so far, a running segment included.
  function feedSecs(e, now) {
    var l = e.ls || 0, r = e.rs || 0;
    if (e.cur && e.cs !== undefined) {
      var run = Math.max(0, Math.floor((now - e.cs) / 1000));
      if (e.cur === "l") l += run; else r += run;
    }
    return { l: Math.min(l, LIM.sec[1]), r: Math.min(r, LIM.sec[1]) };
  }
  // Timer actions return a NEW event (the caller stamps m).
  function feedStart(kid, side, now, id) {
    return { id: id, k: kid, t: "feed", ts: now, ls: 0, rs: 0, cur: side, cs: now, sd: side };
  }
  function feedBank(e, now) {
    var s = feedSecs(e, now), o = JSON.parse(JSON.stringify(e));
    o.ls = s.l;
    o.rs = s.r;
    delete o.cur;
    delete o.cs;
    return o;
  }
  function feedSide(e, side, now) {
    var o = feedBank(e, now);
    o.cur = side;
    o.cs = now;
    o.sd = side;
    return o;
  }
  function feedPause(e, now) { return feedBank(e, now); }
  function feedStop(e, now) {
    var o = feedBank(e, now);
    o.e = Math.max(o.ts, Math.min(now, o.ts + LIM.span));
    return o;
  }
  // The side to offer next: the other one from the last feed.
  function nextSide(data, kid, now) {
    var f = lastOf(data, kid, ["feed"], now);
    if (!f) return "l";
    return f.sd === "l" ? "r" : "l";
  }
  function isAsleep(data, kid) {
    return running(data, kid).some(function (e) { return e.t === "sleep"; });
  }
  function lastWake(data, kid, now) {
    var list = kidEvents(data, kid), best = null;
    list.forEach(function (e) {
      if (e.t === "sleep" && e.e !== undefined && e.e <= now && (best === null || e.e > best)) best = e.e;
    });
    return best;
  }

  // ---------- 4. Day maths ----------
  // Minutes of [a, b) that fall inside [s, e).
  function overlapMin(a, b, s, e) {
    var x = Math.max(a, s), y = Math.min(b, e);
    return y > x ? (y - x) / 60000 : 0;
  }
  // Night = 19:00 → 07:00 (local clock).
  function nightMin(a, b, key) {
    var s = dayStart(key);
    return overlapMin(a, b, s, s + 7 * 3600000) + overlapMin(a, b, s + 19 * 3600000, dayEnd(key));
  }
  function evEnd(e, now) {
    if (e.e !== undefined) return e.e;
    return TIMED[e.t] ? Math.max(e.ts, Math.min(now, e.ts + LIM.span)) : e.ts;
  }

  function dayTotals(data, kid, key, now) {
    var s = dayStart(key), en = dayEnd(key);
    var o = { feeds: 0, breastMin: 0, bottles: 0, bottleMl: 0, solids: 0,
              sleepMin: 0, nightMin: 0, naps: 0, wet: 0, dirty: 0, pumpMl: 0 };
    kidEvents(data, kid).forEach(function (e) {
      var inDay = e.ts >= s && e.ts < en;
      if (e.t === "sleep") {
        var b = evEnd(e, now), mins = overlapMin(e.ts, b, s, en);
        o.sleepMin += mins;
        o.nightMin += nightMin(e.ts, b, key);
        if (inDay) o.naps++;
        return;
      }
      if (!inDay) return;
      switch (e.t) {
        case "feed":
          o.feeds++;
          var fs = feedSecs(e, now);
          o.breastMin += (fs.l + fs.r) / 60;
          break;
        case "bottle": o.feeds++; o.bottles++; o.bottleMl += e.ml; break;
        case "solid": o.solids++; break;
        case "diaper":
          if (e.x !== "d") o.wet++;
          if (e.x !== "w") o.dirty++;
          break;
        case "pump": o.pumpMl += e.ml; break;
      }
    });
    o.breastMin = Math.round(o.breastMin);
    o.sleepMin = Math.round(o.sleepMin);
    o.nightMin = Math.round(o.nightMin);
    return o;
  }

  // Sleep and feed spans of one day, as fractions 0..1 of the day
  // (for the 24-hour pattern strip).
  function daySpans(data, kid, key, now) {
    var s = dayStart(key), en = dayEnd(key), len = en - s, out = [];
    kidEvents(data, kid).forEach(function (e) {
      if (e.t !== "sleep" && e.t !== "feed" && e.t !== "bottle") return;
      var b = e.t === "bottle" ? e.ts + 10 * 60000 : evEnd(e, now);
      if (e.t === "feed" && b - e.ts < 5 * 60000) b = e.ts + 5 * 60000;   // visible
      var x = Math.max(e.ts, s), y = Math.min(b, en);
      if (y <= x) return;
      out.push({ t: e.t === "sleep" ? "sleep" : "feed", a: (x - s) / len, b: (y - s) / len });
    });
    return out;
  }

  function weekTotals(data, kid, endKey, now) {
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var k = addDays(endKey, -i);
      out.push({ key: k, tot: dayTotals(data, kid, k, now) });
    }
    return out;
  }

  // Average per day over the n full days before `todayKey`, from the
  // kid's first event on (days before it do not count).
  function averages(data, kid, todayKey, n, now) {
    var list = kidEvents(data, kid);
    if (!list.length) return null;
    var first = dayKeyOf(list[0].ts), sum = null, cnt = 0;
    for (var i = 1; i <= n; i++) {
      var k = addDays(todayKey, -i);
      if (k < first) break;
      var t = dayTotals(data, kid, k, now);
      if (!sum) { sum = {}; Object.keys(t).forEach(function (f) { sum[f] = 0; }); }
      Object.keys(t).forEach(function (f) { sum[f] += t[f]; });
      cnt++;
    }
    if (!cnt) return null;
    Object.keys(sum).forEach(function (f) { sum[f] = Math.round(sum[f] / cnt * 10) / 10; });
    sum.days = cnt;
    return sum;
  }

  function kidGrowth(data, kid) {
    return data.gr.filter(function (g) { return !g.del && g.k === kid; })
      .sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
  }
  function kidMarks(data, kid, type) {
    return data.mk.filter(function (x) { return !x.del && x.k === kid && x.t === type; })
      .sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
  }

  // ---------- 5. Age + formatting ----------
  // Whole months + leftover days from birth to `key` (calendar).
  function age(birth, key) {
    var b = keyDate(birth), d = keyDate(key);
    if (!b || !d) return null;
    var days = Math.round((d - b) / DAY_MS);
    if (days < 0) return { days: days, months: 0, rest: 0 };
    var months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
    var anchor = function (m) {
      var x = new Date(b.getFullYear(), b.getMonth() + m, 1);
      var last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      x.setDate(Math.min(b.getDate(), last));
      return x;
    };
    if (anchor(months) > d) months--;
    var rest = Math.round((d - anchor(months)) / DAY_MS);
    return { days: days, months: months, rest: rest };
  }
  var AGE_W = {
    en: { born: "Due", d1: "1 day", dN: "{n} days", wk: "{w} wk", wkd: "{w} wk {d} d",
          mo1: "1 month", moN: "{n} months", mod: "{n} mo {d} d", yr: "{y} yr", yrm: "{y} yr {m} mo", day0: "Newborn" },
    el: { born: "Αναμένεται", d1: "1 ημέρας", dN: "{n} ημερών", wk: "{w} εβδ.", wkd: "{w} εβδ. {d} ημ.",
          mo1: "1 μηνός", moN: "{n} μηνών", mod: "{n} μην. {d} ημ.", yr: "{y} ετών", yrm: "{y} ετ. {m} μην.", day0: "Νεογέννητο" }
  };
  function fill(s, p) {
    Object.keys(p).forEach(function (k) { s = s.split("{" + k + "}").join(String(p[k])); });
    return s;
  }
  function fmtAge(birth, key, lang) {
    var w = AGE_W[lang] || AGE_W.en, a = age(birth, key);
    if (!a) return "";
    if (a.days < 0) return w.born;
    if (a.days === 0) return w.day0;
    if (a.days === 1) return w.d1;
    if (a.days < 14) return fill(w.dN, { n: a.days });
    if (a.months < 3) {
      var wk = Math.floor(a.days / 7), dd = a.days % 7;
      return dd ? fill(w.wkd, { w: wk, d: dd }) : fill(w.wk, { w: wk });
    }
    if (a.months < 24) return a.rest ? fill(w.mod, { n: a.months, d: a.rest }) : fill(a.months === 1 ? w.mo1 : w.moN, { n: a.months });
    var y = Math.floor(a.months / 12), m = a.months % 12;
    return m ? fill(w.yrm, { y: y, m: m }) : fill(w.yr, { y: y });
  }
  // Age in months as a decimal (chart x axis).
  function ageMonths(birth, key) {
    var b = keyDate(birth), d = keyDate(key);
    return (d - b) / DAY_MS / 30.4375;
  }

  function locale(lang) { return lang === "el" ? "el-GR" : "en-GB"; }
  function fmtNum(n, lang, dec) {
    try {
      return new Intl.NumberFormat(locale(lang),
        { maximumFractionDigits: dec || 0, minimumFractionDigits: dec || 0 }).format(n);
    } catch (e) { return String(n); }
  }
  function fmtClock(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  // 75 → "1:15" (h:mm); under an hour → "45′"
  function fmtDur(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return min + "′";
    return Math.floor(min / 60) + ":" + pad(min % 60);
  }
  // Running clock: seconds → "m:ss" or "h:mm:ss"
  function fmtTimer(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }
  var OZ_ML = 29.5735, LB_G = 453.59237;
  function fmtVol(ml, prefs, lang) {
    return prefs.vu === "oz" ? fmtNum(ml / OZ_ML, lang, 1) + " fl oz" : fmtNum(ml, lang) + " ml";
  }
  function fmtWeight(g, prefs, lang) {
    if (prefs.wu === "lb") {
      var oz = Math.round(g / LB_G * 16), lb = Math.floor(oz / 16);
      return lb + " lb " + (oz % 16) + " oz";
    }
    return fmtNum(g / 1000, lang, 2) + " kg";
  }
  function fmtLen(mm, lang) { return fmtNum(mm / 10, lang, 1) + " cm"; }
  function fmtTemp(v, prefs, lang) {
    return prefs.tu === "f" ? fmtNum(v / 10 * 9 / 5 + 32, lang, 1) + " °F" : fmtNum(v / 10, lang, 1) + " °C";
  }
  function msLabel(key, lang) {
    for (var i = 0; i < MILESTONES.length; i++) {
      if (MILESTONES[i][0] === key) return lang === "el" ? MILESTONES[i][2] : MILESTONES[i][1];
    }
    return key;
  }

  // ---------- 6. Export ----------
  // A cell that could start a spreadsheet formula gets a leading
  // apostrophe (CSV injection); quotes are doubled.
  function csvCell(v) {
    var s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function stampText(ts) {
    var d = new Date(ts);
    return dayKey(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function toCsv(data) {
    var kids = {};
    data.kids.forEach(function (k) { if (!k.del) kids[k.id] = k.n; });
    var lines = ["child,type,start,end,minutes,left_min,right_min,ml,detail,note"];
    data.ev.filter(function (e) { return !e.del && kids[e.k] !== undefined; }).sort(byTime)
      .forEach(function (e) {
        var mins = e.e !== undefined ? Math.round((e.e - e.ts) / 60000) : "";
        var lm = "", rm = "", detail = e.x || e.sd || "";
        if (e.t === "feed") { lm = Math.round((e.ls || 0) / 60); rm = Math.round((e.rs || 0) / 60); detail = e.sd; }
        if (e.t === "temp") detail = (e.v / 10).toFixed(1) + "C";
        if (e.t === "tummy") detail = e.v + "min";
        lines.push([kids[e.k], e.t, stampText(e.ts), e.e !== undefined ? stampText(e.e) : "", mins,
          lm, rm, e.ml || "", detail, e.tx || ""].map(csvCell).join(","));
      });
    return lines.join("\r\n") + "\r\n";
  }
  function growthCsv(data) {
    var kids = {};
    data.kids.forEach(function (k) { if (!k.del) kids[k.id] = k; });
    var lines = ["child,date,age_days,weight_g,length_mm,head_mm"];
    data.gr.filter(function (g) { return !g.del && kids[g.k]; })
      .sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.id, y.id); })
      .forEach(function (g) {
        var a = age(kids[g.k].b, g.d);
        lines.push([kids[g.k].n, g.d, a ? a.days : "", g.g || "", g.l || "", g.h || ""].map(csvCell).join(","));
      });
    return lines.join("\r\n") + "\r\n";
  }

  var SUM_W = {
    en: {
      title: "{name} · summary for the paediatrician", born: "Born {d} ({age})",
      avg: "Daily average, last {n} days:", none: "No full day logged in the last 7 days yet.",
      feeds: "Feeds: {n} (breast {b} min, bottle {ml})", sleep: "Sleep: {h} h (night {nh} h)",
      nappies: "Nappies: {w} wet, {d} dirty", growth: "Latest measurements:",
      w: "Weight {v} ({d})", l: "Length {v} ({d})", h: "Head {v} ({d})",
      ms: "Milestones:", vac: "Vaccines:", foot: "Made with orOS Baby. Not medical advice."
    },
    el: {
      title: "{name} · σύνοψη για τον παιδίατρο", born: "Γεννήθηκε {d} ({age})",
      avg: "Μέσος όρος ημέρας, τελευταίες {n} ημέρες:", none: "Δεν υπάρχει ακόμα ολόκληρη μέρα με καταγραφές τις τελευταίες 7 ημέρες.",
      feeds: "Ταΐσματα: {n} (θηλασμός {b} λεπτά, μπιμπερό {ml})", sleep: "Ύπνος: {h} ώρες (νύχτα {nh} ώρες)",
      nappies: "Πάνες: {w} βρεγμένες, {d} λερωμένες", growth: "Τελευταίες μετρήσεις:",
      w: "Βάρος {v} ({d})", l: "Μήκος {v} ({d})", h: "Κεφάλι {v} ({d})",
      ms: "Ορόσημα:", vac: "Εμβόλια:", foot: "Από την εφαρμογή Μωρό του orOS. Δεν είναι ιατρική συμβουλή."
    }
  };
  function summary(data, kid, todayKey, lang, now) {
    var w = SUM_W[lang] || SUM_W.en, k = findIn(data.kids, kid);
    if (!k || k.del) return "";
    var p = data.prefs, out = [];
    out.push(fill(w.title, { name: k.n }));
    out.push(fill(w.born, { d: k.b, age: fmtAge(k.b, todayKey, lang) }));
    out.push("");
    var a = averages(data, kid, todayKey, 7, now);
    if (!a) out.push(w.none);
    else {
      out.push(fill(w.avg, { n: a.days }));
      out.push("- " + fill(w.feeds, { n: fmtNum(a.feeds, lang, 1), b: fmtNum(a.breastMin, lang), ml: fmtVol(Math.round(a.bottleMl), p, lang) }));
      out.push("- " + fill(w.sleep, { h: fmtNum(a.sleepMin / 60, lang, 1), nh: fmtNum(a.nightMin / 60, lang, 1) }));
      out.push("- " + fill(w.nappies, { w: fmtNum(a.wet, lang, 1), d: fmtNum(a.dirty, lang, 1) }));
    }
    var g = kidGrowth(data, kid), lw = null, ll = null, lh = null;
    g.forEach(function (x) { if (x.g) lw = x; if (x.l) ll = x; if (x.h) lh = x; });
    if (lw || ll || lh) {
      out.push("");
      out.push(w.growth);
      if (lw) out.push("- " + fill(w.w, { v: fmtWeight(lw.g, p, lang), d: lw.d }));
      if (ll) out.push("- " + fill(w.l, { v: fmtLen(ll.l, lang), d: ll.d }));
      if (lh) out.push("- " + fill(w.h, { v: fmtLen(lh.h, lang), d: lh.d }));
    }
    var ms = kidMarks(data, kid, "ms");
    if (ms.length) {
      out.push("");
      out.push(w.ms);
      ms.forEach(function (x) { out.push("- " + x.d + " " + (x.key ? msLabel(x.key, lang) : x.tx)); });
    }
    var vac = kidMarks(data, kid, "vac");
    if (vac.length) {
      out.push("");
      out.push(w.vac);
      vac.forEach(function (x) { out.push("- " + x.d + " " + x.tx); });
    }
    out.push("");
    out.push(w.foot);
    return out.join("\n");
  }

  var API = {
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER,
    TYPES: TYPES, TIMED: TIMED, SUBS: SUBS, LIM: LIM, DEFAULT_PREFS: DEFAULT_PREFS,
    MILESTONES: MILESTONES, MS_KEYS: MS_KEYS, ID_RE: ID_RE,
    isInt: isInt, inRange: inRange, cleanText: cleanText, newId: newId, msId: msId,
    dayKey: dayKey, dayKeyOf: dayKeyOf, keyDate: keyDate, addDays: addDays, validDay: validDay,
    dayStart: dayStart, dayEnd: dayEnd,
    normKid: normKid, normEv: normEv, normGr: normGr, normMk: normMk, normPrefs: normPrefs,
    mergeBaby: mergeBaby, normalize: normalize, empty: empty, parse: parse, looksLikeData: looksLikeData,
    liveKids: liveKids, findIn: findIn, kidEvents: kidEvents, dayEvents: dayEvents,
    running: running, lastOf: lastOf, isAsleep: isAsleep, lastWake: lastWake,
    feedSecs: feedSecs, feedStart: feedStart, feedSide: feedSide, feedPause: feedPause, feedStop: feedStop,
    nextSide: nextSide, evEnd: evEnd,
    dayTotals: dayTotals, daySpans: daySpans, weekTotals: weekTotals, averages: averages,
    kidGrowth: kidGrowth, kidMarks: kidMarks,
    age: age, fmtAge: fmtAge, ageMonths: ageMonths,
    fmtNum: fmtNum, fmtClock: fmtClock, fmtDur: fmtDur, fmtTimer: fmtTimer,
    fmtVol: fmtVol, fmtWeight: fmtWeight, fmtLen: fmtLen, fmtTemp: fmtTemp, msLabel: msLabel,
    csvCell: csvCell, toCsv: toCsv, growthCsv: growthCsv, summary: summary
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.orosBabyCore = API;
})(typeof window !== "undefined" ? window : globalThis);
