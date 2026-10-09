// ============================================================
// orOS Water — shared core (v1.0.0)
// The pure model of the Water app, loaded by three hosts:
//   - water/index.html (the app itself)
//   - habits/index.html (the read-only "Water" row, via the
//     generic window.orosHabitFeeds registry)
//   - the shell index.html (the reminder engine in shell.js)
// No DOM, no storage writes. Exposes window.orosWaterCore and,
// under Node, module.exports (tests/water.test.js).
//
// Data (synced slice "water", key oros-water-data):
//   { ver: 1,
//     sips:  [ { id, ts, ml, m } | { id, m, del: 1 } ]  sorted by id
//     goals: [ { id: "YYYY-MM-DD", ml, m } ]            sorted by id
//     prefs: { glass, bottle, unit, rem{on,from,to,every}, habits },
//     pm }                                              prefs stamp
//   - a sip is one drink; its day is derived from ts in LOCAL time
//   - a goal applies from its day onward (past days keep theirs)
//   - merge: per id, newer m wins, a tombstone wins ties (R5, R17);
//     prefs travel as one record, newer pm wins; canonical (R26)
// Sections:
//   1. Constants + helpers
//   2. Normalize + merge
//   3. Day maths: totals, goals, streaks, averages
//   4. Formatting
//   5. Reminder decision
//   6. Habits feed
//   7. Export
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION      = "1.0.0";
  var STORAGE_KEY  = "oros-water-data";
  var DATA_VER     = 1;
  var DEFAULT_GOAL = 2000;
  var LIM = {
    sip:    [1, 5000],
    goal:   [500, 10000],
    glass:  [50, 1000],
    bottle: [100, 3000],
    every:  [30, 480],
    day:    [0, 1440]
  };
  var DEFAULT_PREFS = {
    glass: 250, bottle: 500, unit: "ml",
    rem: { on: 0, from: 540, to: 1260, every: 120 },
    habits: 1
  };
  var UNITS = ["ml", "glass", "oz"];
  var OZ_ML = 29.5735;
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function inRange(v, r) { return isInt(v) && v >= r[0] && v <= r[1]; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

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

  function newId() {
    var r = new Uint32Array(2);
    (root.crypto || require("crypto").webcrypto).getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // ---------- 2. Normalize + merge ----------
  function normSip(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    if (x.del) return { id: x.id, m: x.m, del: 1 };
    if (!isInt(x.ts) || x.ts <= 0 || !inRange(x.ml, LIM.sip)) return null;
    return { id: x.id, ts: x.ts, ml: x.ml, m: x.m };
  }
  function normGoal(x) {
    if (!x || typeof x !== "object" || !validDay(x.id) || !isInt(x.m) || x.m < 0 ||
        !inRange(x.ml, LIM.goal)) return null;
    return { id: x.id, ml: x.ml, m: x.m };
  }
  // Fixed key order: two devices with the same prefs serialize alike.
  function normPrefs(p) {
    p = (p && typeof p === "object") ? p : {};
    var r = (p.rem && typeof p.rem === "object") ? p.rem : {};
    var d = DEFAULT_PREFS;
    var from = inRange(r.from, LIM.day) ? r.from : d.rem.from;
    var to = inRange(r.to, LIM.day) ? r.to : d.rem.to;
    if (to <= from) { from = d.rem.from; to = d.rem.to; }
    return {
      glass:  inRange(p.glass, LIM.glass) ? p.glass : d.glass,
      bottle: inRange(p.bottle, LIM.bottle) ? p.bottle : d.bottle,
      unit:   UNITS.indexOf(p.unit) >= 0 ? p.unit : d.unit,
      rem: {
        on: r.on ? 1 : 0,
        from: from,
        to: to,
        every: inRange(r.every, LIM.every) ? r.every : d.rem.every
      },
      habits: p.habits === 0 ? 0 : 1
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

  function mergeWater(A, B) {
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
      sips: mergeList(a.sips, b.sips, normSip),
      goals: mergeList(a.goals, b.goals, normGoal),
      prefs: prefs,
      pm: pm
    };
  }
  function normalize(x) { return mergeWater(x, x); }
  function empty() { return normalize(null); }

  // Parse what localStorage holds; null when it is unreadable (the
  // caller keeps a rescue copy), an empty model when there is none.
  function parse(raw) {
    if (raw === null || raw === undefined || raw === "") return empty();
    try {
      var o = JSON.parse(raw);
      if (o && typeof o === "object" && Array.isArray(o.sips)) return normalize(o);
    } catch (e) {}
    return null;
  }

  // ---------- 3. Day maths ----------
  function liveSips(data) {
    return data.sips.filter(function (s) { return !s.del; });
  }
  function hasAny(data) {
    for (var i = 0; i < data.sips.length; i++) if (!data.sips[i].del) return true;
    return false;
  }
  function totals(data) {
    var out = {};
    data.sips.forEach(function (s) {
      if (s.del) return;
      var k = dayKeyOf(s.ts);
      out[k] = (out[k] || 0) + s.ml;
    });
    return out;
  }
  function dayTotal(data, key) { return totals(data)[key] || 0; }
  function daySips(data, key) {
    return liveSips(data).filter(function (s) { return dayKeyOf(s.ts) === key; })
      .sort(function (x, y) { return x.ts - y.ts || cmpStr(x.id, y.id); });
  }
  function firstDay(data) {
    var min = null;
    data.sips.forEach(function (s) { if (!s.del && (min === null || s.ts < min)) min = s.ts; });
    return min === null ? null : dayKeyOf(min);
  }
  // The goal in force on `key`: the latest goal set on or before it;
  // days before the first goal use that first goal.
  function goalFor(data, key) {
    var g = data.goals, pick = null;
    for (var i = 0; i < g.length; i++) {
      if (g[i].id <= key) pick = g[i]; else break;
    }
    if (!pick && g.length) pick = g[0];
    return pick ? pick.ml : DEFAULT_GOAL;
  }
  function setGoal(data, key, ml, now) {
    var cur = null;
    data.goals.forEach(function (g) { if (g.id === key) cur = g; });
    var m = Math.max(now, cur ? cur.m + 1 : 0);
    var next = data.goals.filter(function (g) { return g.id !== key; });
    next.push({ id: key, ml: ml, m: m });
    data.goals = mergeList(next, [], normGoal);
  }
  function metDays(data) {
    var t = totals(data), out = {};
    Object.keys(t).forEach(function (k) { if (t[k] >= goalFor(data, k)) out[k] = true; });
    return out;
  }
  // Current streak: ends today when today is met, else yesterday.
  function streaks(data, todayKey) {
    var met = metDays(data), first = firstDay(data);
    if (!first) return { current: 0, longest: 0 };
    var cur = 0, k = met[todayKey] ? todayKey : addDays(todayKey, -1);
    while (met[k]) { cur++; k = addDays(k, -1); }
    var longest = 0, run = 0;
    for (k = first; k <= todayKey; k = addDays(k, 1)) {
      run = met[k] ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    return { current: cur, longest: longest };
  }
  // Average of the n full days before today, from the first entry on.
  function average(data, todayKey, n) {
    var first = firstDay(data);
    if (!first) return null;
    var t = totals(data), sum = 0, cnt = 0;
    for (var i = 1; i <= n; i++) {
      var k = addDays(todayKey, -i);
      if (k < first) break;
      sum += t[k] || 0;
      cnt++;
    }
    return cnt ? Math.round(sum / cnt) : null;
  }
  // Share of days (first entry … yesterday, or today when met) on goal.
  function goalRate(data, todayKey) {
    var first = firstDay(data);
    if (!first) return null;
    var met = metDays(data), days = 0, hit = 0;
    for (var k = first; k <= todayKey; k = addDays(k, 1)) {
      if (k === todayKey && !met[k]) break;
      days++;
      if (met[k]) hit++;
    }
    return days ? Math.round(hit * 100 / days) : null;
  }

  // ---------- 4. Formatting ----------
  var WORDS = {
    en: { glass1: "glass", glassN: "glasses" },
    el: { glass1: "ποτήρι", glassN: "ποτήρια" }
  };
  function locale(lang) { return lang === "el" ? "el-GR" : "en-GB"; }
  function fmtNum(n, lang, dec) {
    try {
      return new Intl.NumberFormat(locale(lang),
        { maximumFractionDigits: dec || 0, minimumFractionDigits: 0 }).format(n);
    } catch (e) { return String(n); }
  }
  // The number alone in the chosen unit (no unit word).
  function amount(ml, prefs, lang) {
    if (prefs.unit === "glass") return fmtNum(Math.round(ml / prefs.glass * 10) / 10, lang, 1);
    if (prefs.unit === "oz") return fmtNum(Math.round(ml / OZ_ML * 10) / 10, lang, 1);
    return fmtNum(ml, lang, 0);
  }
  function unitWord(ml, prefs, lang) {
    if (prefs.unit === "glass") {
      var w = WORDS[lang] || WORDS.en;
      return Math.round(ml / prefs.glass * 10) / 10 === 1 ? w.glass1 : w.glassN;
    }
    return prefs.unit === "oz" ? "fl oz" : "ml";
  }
  function fmtAmount(ml, prefs, lang) {
    return amount(ml, prefs, lang) + " " + unitWord(ml, prefs, lang);
  }
  function fmtMinutes(min) { return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60); }

  // ---------- 5. Reminder decision ----------
  // Due when ALL hold: reminders on; the app has been used (SH-B7);
  // inside the hours window; below today's goal; behind the pace
  // (goal spread evenly over the window); nothing drunk for `every`
  // minutes (the window start counts as a drink). Dedupe key = day +
  // interval slot, so the inbox keeps one line per slot across tabs
  // and devices.
  function reminderDue(data, now) {
    var p = data.prefs.rem;
    if (!p.on || !hasAny(data)) return null;
    var mins = now.getHours() * 60 + now.getMinutes();
    if (mins < p.from || mins >= p.to) return null;
    var key = dayKey(now);
    var total = dayTotal(data, key), goal = goalFor(data, key);
    if (total >= goal) return null;
    if (total >= goal * (mins - p.from) / (p.to - p.from)) return null;
    var start = keyDate(key).getTime() + p.from * 60000, last = 0;
    liveSips(data).forEach(function (s) { if (s.ts > last && s.ts <= now.getTime()) last = s.ts; });
    if (now.getTime() - Math.max(last, start) < p.every * 60000) return null;
    return {
      key: "water-" + key + "-" + Math.floor((mins - p.from) / p.every),
      total: total,
      goal: goal
    };
  }
  function reminderText(due, prefs, lang) {
    var el = lang === "el";
    var left = Math.max(0, due.goal - due.total);
    return {
      title: el ? "Ώρα για λίγο νερό" : "Time for some water",
      body: el
        ? "Σήμερα: " + amount(due.total, prefs, lang) + " από " + fmtAmount(due.goal, prefs, lang) +
          ". Μένουν " + fmtAmount(left, prefs, lang) + "."
        : "Today: " + amount(due.total, prefs, lang) + " of " + fmtAmount(due.goal, prefs, lang) +
          ". " + fmtAmount(left, prefs, lang) + " to go."
    };
  }

  // ---------- 6. Habits feed ----------
  // Generic contract (habits.js reads window.orosHabitFeeds): one
  // record per provider app, all fields static except read(), which
  // returns null (nothing to show) or { days: {"YYYY-MM-DD": true},
  // first: "YYYY-MM-DD" }. Read-only: Habits never stores feed rows.
  var DROP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8C9 7 6 10.4 6 14.2a6 6 0 0 0 12 0C18 10.4 15 7 12 2.8z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.7"/></svg>';
  var FEED = {
    id: "water",
    app: "water",
    name: { en: "Water", el: "Νερό" },
    hint: { en: "Daily goal in the Water app", el: "Ημερήσιος στόχος στην εφαρμογή Νερό" },
    color: "#4fc4cf",
    icon: DROP,
    keys: [STORAGE_KEY],
    read: function () {
      var data = null;
      try { data = parse(root.localStorage.getItem(STORAGE_KEY)); } catch (e) {}
      if (!data || !data.prefs.habits || !hasAny(data)) return null;
      return { days: metDays(data), first: firstDay(data) };
    }
  };

  // ---------- 7. Export ----------
  function toCsv(data) {
    var lines = ["date,time,ml"];
    liveSips(data).sort(function (x, y) { return x.ts - y.ts || cmpStr(x.id, y.id); })
      .forEach(function (s) {
        var d = new Date(s.ts);
        lines.push(dayKey(d) + "," + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "," + s.ml);
      });
    return lines.join("\r\n") + "\r\n";
  }

  var API = {
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER,
    DEFAULT_GOAL: DEFAULT_GOAL, DEFAULT_PREFS: DEFAULT_PREFS, LIM: LIM, UNITS: UNITS, ID_RE: ID_RE,
    isInt: isInt, inRange: inRange, newId: newId,
    dayKey: dayKey, dayKeyOf: dayKeyOf, keyDate: keyDate, addDays: addDays, validDay: validDay,
    normSip: normSip, normGoal: normGoal, normPrefs: normPrefs,
    mergeWater: mergeWater, normalize: normalize, empty: empty, parse: parse,
    hasAny: hasAny, totals: totals, dayTotal: dayTotal, daySips: daySips, firstDay: firstDay,
    goalFor: goalFor, setGoal: setGoal, metDays: metDays, streaks: streaks,
    average: average, goalRate: goalRate,
    amount: amount, unitWord: unitWord, fmtAmount: fmtAmount, fmtNum: fmtNum, fmtMinutes: fmtMinutes,
    reminderDue: reminderDue, reminderText: reminderText,
    FEED: FEED, toCsv: toCsv
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) {
    root.orosWaterCore = API;
    var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
    var known = false;
    for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) known = true;
    if (!known) feeds.push(FEED);
  }
})(typeof window !== "undefined" ? window : globalThis);
