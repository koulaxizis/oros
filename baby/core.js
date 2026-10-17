// ============================================================
// orOS Baby — shared core (v1.1.0)
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
//     st:   [ { id, ml, d, w, u, s?, sd?, th?, tx?, m } ]  milk stash
//       (wave 34; the key is absent while the list is empty) · ml ·
//       d day pumped · w "f" fridge | "z" freezer · u use-by day ·
//       s "u" used | "x" thrown away (absent = in stock) · sd the day
//       it was used / thrown away · th the day it was thawed
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
//   7. Reminders (rule shared with the shell engine)
//   8. Calendar feed rows
//   9. Milk stash (wave 34)
// A pump session's length (wave 34) is its end e − ts (1–180 min):
// older builds already keep e on a pump, so nothing is lost.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION     = "1.1.0";
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
    pumpMin: [1, 180],            // pump session length (minutes, kept as e − ts)
    bag:   [1, 1000],             // one stash bag (ml)
    temp:  [340, 430],            // tenths of °C
    tummy: [1, 180],              // minutes
    g:     [300, 30000],          // grams
    l:     [300, 1300],           // mm
    h:     [250, 600]             // mm
  };
  var DEFAULT_PREFS = { wu: "kg", tu: "c", vu: "ml" };
  // Ready milestones, in order. Labels: MS_W (key "ms.<id>").
  var MS_W = {
    en: {
      "ms.smile": "First smile",
      "ms.laugh": "First laugh",
      "ms.head": "Holds head up",
      "ms.roll": "Rolls over",
      "ms.sit": "Sits without support",
      "ms.solid": "First solid food",
      "ms.tooth": "First tooth",
      "ms.crawl": "Crawls",
      "ms.stand": "Stands with support",
      "ms.word": "First word",
      "ms.wave": "Waves bye-bye",
      "ms.walk": "First steps"
    },
    el: {
      "ms.smile": "Πρώτο χαμόγελο",
      "ms.laugh": "Πρώτο γέλιο",
      "ms.head": "Κρατά το κεφάλι",
      "ms.roll": "Γυρίζει μπρούμυτα",
      "ms.sit": "Κάθεται χωρίς στήριξη",
      "ms.solid": "Πρώτη στερεή τροφή",
      "ms.tooth": "Πρώτο δόντι",
      "ms.crawl": "Μπουσουλάει",
      "ms.stand": "Στέκεται με στήριξη",
      "ms.word": "Πρώτη λέξη",
      "ms.wave": "Κάνει «γεια»",
      "ms.walk": "Πρώτα βήματα"
    }
  };
  // [id, English label] (the shape baby.js and the tests read).
  var MILESTONES = ["smile", "laugh", "head", "roll", "sit", "solid", "tooth", "crawl", "stand", "word", "wave", "walk"].map(function (k) { return [k, MS_W.en["ms." + k]]; });
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

  // wave 34: one bag of the milk stash (shared by the family, no kid)
  function normSt(x) {
    if (!stampOk(x)) return null;
    if (x.del) return tomb(x);
    if (!inRange(x.ml, LIM.bag) || !validDay(x.d) || !validDay(x.u) || (x.w !== "f" && x.w !== "z")) return null;
    var o = { id: x.id, ml: x.ml, d: x.d, w: x.w, u: x.u };
    if (x.s === "u" || x.s === "x") {
      o.s = x.s;
      if (validDay(x.sd)) o.sd = x.sd;
    }
    if (validDay(x.th)) o.th = x.th;
    var tx = cleanText(x.tx, LIM.text);
    if (tx) o.tx = tx;
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

  function mergeBaby(A, B) { return dropEmptySt(mergeBaby0(A, B)); }
  function mergeBaby0(A, B) {
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
      st: mergeList(a.st, b.st, normSt),
      prefs: prefs,
      pm: pm
    };
  }
  function normalize(x) { return mergeBaby(x, x); }
  // wave 34: the stash list is left out while empty, so the bytes of a
  // slice that never had a bag stay what they were (no upload at update)
  function dropEmptySt(o) { if (o && Array.isArray(o.st) && !o.st.length) delete o.st; return o; }
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
  // A word table for a language: English and Greek inline; any other
  // language (a pack, i18n.js) is English overlaid with the "baby"
  // pack, built once. Every table here shares the pack with baby.js,
  // so its keys carry their own prefix (age., rep., rem., cal., ms.).
  function words(T, lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !T[lang]) I.table(T, "baby", lang);
    return T[lang] || T.en;
  }
  var AGE_W = {
    en: { "age.born": "Due", "age.d1": "1 day", "age.dN": "{n} days", "age.wk": "{w} wk", "age.wkd": "{w} wk {d} d",
          "age.mo1": "1 month", "age.moN": "{n} months", "age.mod": "{n} mo {d} d", "age.yr": "{y} yr", "age.yrm": "{y} yr {m} mo", "age.day0": "Newborn" },
    el: { "age.born": "Αναμένεται", "age.d1": "1 ημέρας", "age.dN": "{n} ημερών", "age.wk": "{w} εβδ.", "age.wkd": "{w} εβδ. {d} ημ.",
          "age.mo1": "1 μηνός", "age.moN": "{n} μηνών", "age.mod": "{n} μην. {d} ημ.", "age.yr": "{y} ετών", "age.yrm": "{y} ετ. {m} μην.", "age.day0": "Νεογέννητο" }
  };
  // One pass: a value that itself contains "{x}" (a child's name)
  // is never filled again.
  function fill(s, p) {
    return s.replace(/\{(\w+)\}/g, function (all, k) {
      return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : all;
    });
  }
  function fmtAge(birth, key, lang) {
    var w = words(AGE_W, lang), a = age(birth, key);
    if (!a) return "";
    if (a.days < 0) return w["age.born"];
    if (a.days === 0) return w["age.day0"];
    if (a.days === 1) return w["age.d1"];
    if (a.days < 14) return fill(w["age.dN"], { n: a.days });
    if (a.months < 3) {
      var wk = Math.floor(a.days / 7), dd = a.days % 7;
      return dd ? fill(w["age.wkd"], { w: wk, d: dd }) : fill(w["age.wk"], { w: wk });
    }
    if (a.months < 24) return a.rest ? fill(w["age.mod"], { n: a.months, d: a.rest }) : fill(a.months === 1 ? w["age.mo1"] : w["age.moN"], { n: a.months });
    var y = Math.floor(a.months / 12), m = a.months % 12;
    return m ? fill(w["age.yrm"], { y: y, m: m }) : fill(w["age.yr"], { y: y });
  }
  // Age in months as a decimal (chart x axis).
  function ageMonths(birth, key) {
    var b = keyDate(birth), d = keyDate(key);
    return (d - b) / DAY_MS / 30.4375;
  }

  function locale(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    return I ? I.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
  }
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
      if (MILESTONES[i][0] === key) return words(MS_W, lang)["ms." + key] || MILESTONES[i][1];
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
      "rep.title": "{name} · summary for the paediatrician", "rep.born": "Born {d} ({age})",
      "rep.avg": "Daily average, last {n} days:", "rep.none": "No full day logged in the last 7 days yet.",
      "rep.feeds": "Feeds: {n} (breast {b} min, bottle {ml})", "rep.sleep": "Sleep: {h} h (night {nh} h)",
      "rep.nappies": "Nappies: {w} wet, {d} dirty", "rep.growth": "Latest measurements:",
      "rep.w": "Weight {v} ({d})", "rep.l": "Length {v} ({d})", "rep.h": "Head {v} ({d})",
      "rep.ms": "Milestones:", "rep.vac": "Vaccines:", "rep.foot": "Made with orOS Baby. Not medical advice."
    },
    el: {
      "rep.title": "{name} · σύνοψη για τον παιδίατρο", "rep.born": "Γεννήθηκε {d} ({age})",
      "rep.avg": "Μέσος όρος ημέρας, τελευταίες {n} ημέρες:", "rep.none": "Δεν υπάρχει ακόμα ολόκληρη μέρα με καταγραφές τις τελευταίες 7 ημέρες.",
      "rep.feeds": "Ταΐσματα: {n} (θηλασμός {b} λεπτά, μπιμπερό {ml})", "rep.sleep": "Ύπνος: {h} ώρες (νύχτα {nh} ώρες)",
      "rep.nappies": "Πάνες: {w} βρεγμένες, {d} λερωμένες", "rep.growth": "Τελευταίες μετρήσεις:",
      "rep.w": "Βάρος {v} ({d})", "rep.l": "Μήκος {v} ({d})", "rep.h": "Κεφάλι {v} ({d})",
      "rep.ms": "Ορόσημα:", "rep.vac": "Εμβόλια:", "rep.foot": "Από την εφαρμογή Μωρό του orOS. Δεν είναι ιατρική συμβουλή."
    }
  };
  function summary(data, kid, todayKey, lang, now) {
    var w = words(SUM_W, lang), k = findIn(data.kids, kid);
    if (!k || k.del) return "";
    var p = data.prefs, out = [];
    out.push(fill(w["rep.title"], { name: k.n }));
    out.push(fill(w["rep.born"], { d: k.b, age: fmtAge(k.b, todayKey, lang) }));
    out.push("");
    var a = averages(data, kid, todayKey, 7, now);
    if (!a) out.push(w["rep.none"]);
    else {
      out.push(fill(w["rep.avg"], { n: a.days }));
      out.push("- " + fill(w["rep.feeds"], { n: fmtNum(a.feeds, lang, 1), b: fmtNum(a.breastMin, lang), ml: fmtVol(Math.round(a.bottleMl), p, lang) }));
      out.push("- " + fill(w["rep.sleep"], { h: fmtNum(a.sleepMin / 60, lang, 1), nh: fmtNum(a.nightMin / 60, lang, 1) }));
      out.push("- " + fill(w["rep.nappies"], { w: fmtNum(a.wet, lang, 1), d: fmtNum(a.dirty, lang, 1) }));
    }
    var g = kidGrowth(data, kid), lw = null, ll = null, lh = null;
    g.forEach(function (x) { if (x.g) lw = x; if (x.l) ll = x; if (x.h) lh = x; });
    if (lw || ll || lh) {
      out.push("");
      out.push(w["rep.growth"]);
      if (lw) out.push("- " + fill(w["rep.w"], { v: fmtWeight(lw.g, p, lang), d: lw.d }));
      if (ll) out.push("- " + fill(w["rep.l"], { v: fmtLen(ll.l, lang), d: ll.d }));
      if (lh) out.push("- " + fill(w["rep.h"], { v: fmtLen(lh.h, lang), d: lh.d }));
    }
    var ms = kidMarks(data, kid, "ms");
    if (ms.length) {
      out.push("");
      out.push(w["rep.ms"]);
      ms.forEach(function (x) { out.push("- " + x.d + " " + (x.key ? msLabel(x.key, lang) : x.tx)); });
    }
    var vac = kidMarks(data, kid, "vac");
    if (vac.length) {
      out.push("");
      out.push(w["rep.vac"]);
      vac.forEach(function (x) { out.push("- " + x.d + " " + x.tx); });
    }
    out.push("");
    out.push(w["rep.foot"]);
    return out.join("\n");
  }

  // ---------- 7. Reminders (phase 2) ----------
  // Settings are DEVICE-LOCAL (oros-baby-rem): each parent chooses on
  // their own device, nothing travels in the slice. Off by default.
  //   { feed: minutes after the last feed's start (0 = off, else
  //     REM_FEED[]), med: "HH:MM" daily medicine/vitamin time ("" =
  //     off), mt: optional label for it }
  // The shell engine (shell.js babyCheckTick) and the app share this
  // rule; the engine only runs while orOS is open (no push server).
  var REM_KEY = "oros-baby-rem";
  var REM_FEED = [120, 150, 180, 210, 240, 300, 360];
  var REM_MED_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var REM_STALE = DAY_MS;              // no feed logged for a day → silent
  var REM_MED_BEFORE = 2 * 3600000;    // a med logged up to 2 h early counts
  function readRem(o) {
    o = (o && typeof o === "object") ? o : {};
    return {
      feed: REM_FEED.indexOf(o.feed) >= 0 ? o.feed : 0,
      med: typeof o.med === "string" && REM_MED_RE.test(o.med) ? o.med : "",
      mt: cleanText(o.mt, LIM.name)
    };
  }
  function remOn(rem) { return !!(rem.feed || rem.med); }
  // → [{ kind: "feed", key, kid, last } | { kind: "med", key, at }].
  // Keys are stable per gap / per day, so the inbox (synced, deduped
  // by ns + key) shows each reminder once even with two devices on.
  function reminderDue(data, rem, now) {
    rem = readRem(rem);
    var t = now instanceof Date ? now.getTime() : now, out = [];
    var today = dayKeyOf(t);
    var kids = liveKids(data).filter(function (k) { return k.b <= today; });
    if (!kids.length) return out;
    if (rem.feed) {
      kids.forEach(function (k) {
        var last = lastOf(data, k.id, ["feed", "bottle"], t);
        if (!last || (last.t === "feed" && last.e === undefined)) return;   // none yet / feeding now
        var gap = t - last.ts;
        if (gap < rem.feed * 60000 || gap > REM_STALE) return;
        out.push({ kind: "feed", key: "feed-" + k.id + "-" + last.id, kid: k, last: last });
      });
    }
    if (rem.med) {
      var m = REM_MED_RE.exec(rem.med), at = keyDate(today);
      at.setHours(+m[1], +m[2], 0, 0);
      at = at.getTime();
      if (t >= at) {
        var done = data.ev.some(function (e) {
          return !e.del && e.t === "med" && e.ts >= at - REM_MED_BEFORE && e.ts <= t;
        });
        if (!done) out.push({ kind: "med", key: "med-" + today, at: at });
      }
    }
    return out;
  }
  var REM_W = {
    en: { "rem.h": "{h} h", "rem.hm": "{h} h {m} min", "rem.feed": "Feed time?", "rem.feedB": "{n}: last feed {x} ago, at {t}.",
          "rem.med": "Medicine time", "rem.medB": "Daily medicine or vitamin, {t}.", "rem.medL": "{l}, {t}." },
    el: { "rem.h": "{h} ώρ.", "rem.hm": "{h} ώρ. {m} λεπ.", "rem.feed": "Ώρα για τάισμα;", "rem.feedB": "{n}: τελευταίο τάισμα πριν από {x}, στις {t}.",
          "rem.med": "Ώρα για το φάρμακο", "rem.medB": "Καθημερινό φάρμακο ή βιταμίνη, {t}.", "rem.medL": "{l}, {t}." }
  };
  function gapWords(ms, w) {
    var min = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(min / 60), m = min % 60;
    return fill(m ? w["rem.hm"] : w["rem.h"], { h: h, m: m });
  }
  function reminderText(item, rem, lang, now) {
    var w = words(REM_W, lang), t = now instanceof Date ? now.getTime() : now;
    if (item.kind === "feed") {
      return { title: w["rem.feed"],
               body: fill(w["rem.feedB"], { n: item.kid.n, x: gapWords(t - item.last.ts, w), t: fmtClock(item.last.ts) }) };
    }
    rem = readRem(rem);
    return { title: w["rem.med"], body: rem.mt ? fill(w["rem.medL"], { l: rem.mt, t: rem.med }) : fill(w["rem.medB"], { t: rem.med }) };
  }

  // ---------- 8. Calendar feed (phase 2) ----------
  // Read-only rows for calendar/calendar.js (label lbl-feed-baby):
  // milestones, vaccines and doctor visits on their day, and the
  // child's age: every month up to 2 years, then each birthday.
  // Rows are computed, never stored.
  var CAL_W = {
    en: { "cal.ms": "{n}: {x}", "cal.vac": "{n}: vaccine, {x}", "cal.doc": "{n}: doctor, {x}",
          "cal.mo1": "{n} is 1 month old today", "cal.moN": "{n} is {m} months old today", "cal.bday": "🎂 {n} turns {y}" },
    el: { "cal.ms": "{n}: {x}", "cal.vac": "{n}: εμβόλιο, {x}", "cal.doc": "{n}: γιατρός, {x}",
          "cal.mo1": "{n}: κλείνει σήμερα 1 μηνός", "cal.moN": "{n}: κλείνει σήμερα {m} μηνών", "cal.bday": "🎂 {n}: γενέθλια ({y})" }
  };
  function calendarRows(data, key, lang) {
    var w = words(CAL_W, lang), out = [], kids = {};
    if (!validDay(key)) return out;
    liveKids(data).forEach(function (k) {
      kids[k.id] = k;
      var a = age(k.b, key);
      if (!a || a.days <= 0 || a.rest !== 0 || a.months < 1) return;
      var title;
      if (a.months % 12 === 0) title = fill(w["cal.bday"], { n: k.n, y: a.months / 12 });
      else if (a.months < 24) title = fill(a.months === 1 ? w["cal.mo1"] : w["cal.moN"], { n: k.n, m: a.months });
      else return;
      out.push({ id: "age-" + k.id + "-" + key, kid: k.id, kind: "age", title: title });
    });
    data.mk.forEach(function (x) {
      if (x.del || x.d !== key || !kids[x.k]) return;
      var what = x.key ? msLabel(x.key, lang) : x.tx;
      out.push({ id: x.id, kid: x.k, kind: x.t, title: fill(w["cal." + x.t], { n: kids[x.k].n, x: what }) });
    });
    var order = { age: 0, ms: 1, vac: 2, doc: 3 };
    return out.sort(function (x, y) { return order[x.kind] - order[y.kind] || cmpStr(x.id, y.id); });
  }

  // ---------- 9. Milk stash (wave 34) ----------
  // Usual storage times for expressed breast milk (CDC guidance):
  // fridge 4 days, freezer 6 months (best; up to 12 is acceptable),
  // thawed in the fridge: use within 24 hours, never refreeze.
  var STASH = { fridgeDays: 4, freezerMonths: 6, thawDays: 1 };
  function addMonths(key, n) {
    var d = keyDate(key), day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return dayKey(d);
  }
  function useBy(pumped, where) {
    return where === "z" ? addMonths(pumped, STASH.freezerMonths) : addDays(pumped, STASH.fridgeDays);
  }
  // Thawing a freezer bag: it moves to the fridge, use within a day.
  function thaw(bag, today) {
    var o = JSON.parse(JSON.stringify(bag));
    o.w = "f";
    o.th = today;
    o.u = addDays(today, STASH.thawDays);
    if (bag.u < o.u) o.u = bag.u;                 // never later than it was
    return o;
  }
  // Bags in stock, the one to use first on top: fridge before freezer
  // (fridge milk keeps for days, frozen for months), then the earliest
  // use-by, then the oldest pumped ("use oldest first").
  function stashBags(data, today) {
    var list = ((data && data.st) || []).filter(function (b) { return !b.del && !b.s; });
    return list.map(function (b) {
      return { bag: b, expired: b.u < today, soon: b.u >= today && b.u <= addDays(today, 1) };
    }).sort(function (x, y) {
      return (x.bag.w === y.bag.w ? 0 : (x.bag.w === "f" ? -1 : 1)) ||
        cmpStr(x.bag.u, y.bag.u) || cmpStr(x.bag.d, y.bag.d) || cmpStr(x.bag.id, y.bag.id);
    });
  }
  function stashTotals(data, today) {
    var o = { f: { n: 0, ml: 0 }, z: { n: 0, ml: 0 }, expired: 0 };
    stashBags(data, today).forEach(function (x) {
      if (x.expired) { o.expired++; return; }
      o[x.bag.w].n++;
      o[x.bag.w].ml += x.bag.ml;
    });
    return o;
  }
  function nextBag(data, today) {
    var list = stashBags(data, today).filter(function (x) { return !x.expired; });
    return list.length ? list[0].bag : null;
  }
  // Used or thrown-away bags, newest first (the history under the list).
  function stashDone(data) {
    return ((data && data.st) || []).filter(function (b) { return !b.del && b.s; })
      .sort(function (x, y) { return cmpStr(y.sd || y.d, x.sd || x.d) || cmpStr(y.id, x.id); });
  }

  var API = {
    STASH: STASH, normSt: normSt, useBy: useBy, thaw: thaw, stashBags: stashBags, stashTotals: stashTotals,
    nextBag: nextBag, stashDone: stashDone, addMonths: addMonths,
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
    csvCell: csvCell, toCsv: toCsv, growthCsv: growthCsv, summary: summary,
    REM_KEY: REM_KEY, REM_FEED: REM_FEED, readRem: readRem, remOn: remOn,
    reminderDue: reminderDue, reminderText: reminderText, calendarRows: calendarRows
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.orosBabyCore = API;
})(typeof window !== "undefined" ? window : globalThis);
