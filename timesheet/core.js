// ============================================================
// orOS Timesheet — shared core (v1.0.0)
// The pure model of the Timesheet app: no DOM, no storage writes.
// Exposes window.orosTimesheetCore and, under Node, module.exports
// (tests/timesheet.test.js).
//
// Data (synced slice "timesheet", key oros-timesheet-data):
//   { ver: 1,
//     clients:  [ { id, name, rate, m } | { id, m, del: 1 } ]
//     projects: [ { id, name, client, color, rate, bill, arch, m } | tomb ]
//     entries:  [ { id, p, desc, s, e, billed, m } | tomb ]
//     prefs: { cur, rate, goal, round, rup },
//     pm }                                       prefs stamp
//   - every list is sorted by id (R26); m moves only on a real edit
//   - an entry runs while e === 0; its day(s) are derived from s/e
//     in LOCAL time at render, never stored
//   - rates are integer cents per hour; 0 = not set (project → client
//     → default); color is an index into LABEL_COLORS
//   - merge: per id, newer m wins, a tombstone wins ties, then the
//     larger JSON (R5, R17); prefs travel as one record, newer pm wins
// Sections:
//   1. Constants + helpers
//   2. Normalize + merge
//   3. Lookups + rates
//   4. Time maths: day pieces, rounding, week grid, reports
//   5. Parsing + formatting
//   6. Export: CSV + JSON backup
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION     = "1.0.0";
  var STORAGE_KEY = "oros-timesheet-data";
  var DATA_VER    = 1;
  var HOUR = 3600000, DAY = 86400000;
  var MIN_TS = Date.UTC(2000, 0, 1), MAX_TS = Date.UTC(2100, 0, 1);
  var MAX_SPAN = 366 * DAY;          // a sanity bound, never a cut of real data
  var LIM = {
    name: 80, desc: 500,
    rate: [0, 10000000],             // cents per hour (100.000,00 max)
    goal: [0, 1440],                 // minutes per day, 0 = no goal
    color: [0, 7]
  };
  var ROUNDS = [0, 5, 6, 10, 15, 30, 60];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "SEK", "NOK", "DKK",
                    "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "JPY"];
  var DEFAULT_PREFS = { cur: "EUR", rate: 0, goal: 0, round: 0, rup: 1 };
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function inRange(v, r) { return isInt(v) && v >= r[0] && v <= r[1]; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Control characters out, whitespace collapsed, length capped.
  function cleanText(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
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
  // Monday of the week that holds `key`.
  function weekStart(key) {
    var d = keyDate(key);
    return addDays(key, -((d.getDay() + 6) % 7));
  }
  function monthStart(key) { return key.slice(0, 8) + "01"; }
  function monthEnd(key) {
    var d = keyDate(monthStart(key));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return dayKey(d);
  }

  function newId() {
    var r = new Uint32Array(2);
    (root.crypto || require("crypto").webcrypto).getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // ---------- 2. Normalize + merge ----------
  function baseOk(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }
  function tomb(x) { return { id: x.id, m: x.m, del: 1 }; }
  function refId(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }

  function normClient(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.name);
    if (!name) return null;
    return { id: x.id, name: name, rate: inRange(x.rate, LIM.rate) ? x.rate : 0, m: x.m };
  }
  function normProject(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.name);
    if (!name) return null;
    return {
      id: x.id, name: name, client: refId(x.client),
      color: inRange(x.color, LIM.color) ? x.color : 0,
      rate: inRange(x.rate, LIM.rate) ? x.rate : 0,
      bill: x.bill === 0 ? 0 : 1,
      arch: x.arch ? 1 : 0,
      m: x.m
    };
  }
  function normEntry(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (!isInt(x.s) || x.s < MIN_TS || x.s > MAX_TS) return null;
    var e = isInt(x.e) ? x.e : -1;
    if (e !== 0 && (e <= x.s || e - x.s > MAX_SPAN)) return null;
    return {
      id: x.id, p: refId(x.p), desc: cleanText(x.desc, LIM.desc),
      s: x.s, e: e, billed: x.billed ? 1 : 0, m: x.m
    };
  }
  // Fixed key order: two devices with the same prefs serialize alike.
  function normPrefs(p) {
    p = (p && typeof p === "object") ? p : {};
    var d = DEFAULT_PREFS;
    return {
      cur:   CURRENCIES.indexOf(p.cur) >= 0 ? p.cur : d.cur,
      rate:  inRange(p.rate, LIM.rate) ? p.rate : d.rate,
      goal:  inRange(p.goal, LIM.goal) ? p.goal : d.goal,
      round: ROUNDS.indexOf(p.round) >= 0 ? p.round : d.round,
      rup:   p.rup === 0 ? 0 : 1
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

  function mergeTimesheet(A, B) {
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
      clients: mergeList(a.clients, b.clients, normClient),
      projects: mergeList(a.projects, b.projects, normProject),
      entries: mergeList(a.entries, b.entries, normEntry),
      prefs: prefs,
      pm: pm
    };
  }
  function normalize(x) { return mergeTimesheet(x, x); }
  function empty() { return normalize(null); }
  function looksLike(o) {
    return !!o && typeof o === "object" && Array.isArray(o.entries) &&
           Array.isArray(o.projects) && Array.isArray(o.clients);
  }

  // Parse what localStorage holds; null when it is unreadable (the
  // caller keeps a rescue copy), an empty model when there is none.
  function parse(raw) {
    if (raw === null || raw === undefined || raw === "") return empty();
    try {
      var o = JSON.parse(raw);
      if (looksLike(o)) return normalize(o);
    } catch (e) {}
    return null;
  }

  // ---------- 3. Lookups + rates ----------
  function live(list) { return list.filter(function (x) { return !x.del; }); }
  function byId(list, id) {
    if (!id) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id && !list[i].del) return list[i];
    return null;
  }
  function project(data, id) { return byId(data.projects, id); }
  function client(data, id) { return byId(data.clients, id); }
  function projectClient(data, p) { return p ? client(data, p.client) : null; }
  // Effective hourly rate of an entry's project: project → client → default.
  function rateOf(data, pid) {
    var p = project(data, pid);
    if (p && p.rate) return p.rate;
    var c = projectClient(data, p);
    if (c && c.rate) return c.rate;
    return data.prefs.rate;
  }
  // An entry without a project, or whose project is gone, is billable
  // only when a default rate exists; a known project follows its flag.
  function billable(data, pid) {
    var p = project(data, pid);
    return p ? !!p.bill : true;
  }
  function running(data) {
    return data.entries.filter(function (x) { return !x.del && x.e === 0; })
      .sort(function (x, y) { return y.s - x.s || cmpStr(x.id, y.id); });
  }
  function endOf(x, now) { return x.e === 0 ? Math.max(now, x.s) : x.e; }

  // ---------- 4. Time maths ----------
  // An entry cut at local midnights: [{ k, s, e }] (DST-safe: each
  // boundary is the next local midnight, built with setDate).
  function pieces(s, e) {
    var out = [];
    var cur = s;
    while (cur < e) {
      var d = new Date(cur);
      var next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      var stop = Math.min(next, e);
      out.push({ k: dayKey(d), s: cur, e: stop });
      cur = stop;
    }
    return out;
  }
  // Rounding is applied to a reported duration, never to stored data.
  function roundMs(ms, round, up) {
    if (!round || ms <= 0) return ms;
    var step = round * 60000;
    var n = up ? Math.ceil(ms / step) : Math.round(ms / step);
    return n * step;
  }
  // Every live piece inside [fromKey, toKey] (inclusive local days).
  function piecesIn(data, fromKey, toKey, now) {
    var lo = dayStart(fromKey), hi = dayStart(addDays(toKey, 1)), out = [];
    data.entries.forEach(function (x) {
      if (x.del) return;
      var s = Math.max(x.s, lo), e = Math.min(endOf(x, now), hi);
      if (e <= s) return;
      pieces(s, e).forEach(function (pc) { pc.x = x; out.push(pc); });
    });
    return out;
  }
  function dayTotals(data, fromKey, toKey, now) {
    var out = {};
    piecesIn(data, fromKey, toKey, now).forEach(function (pc) {
      out[pc.k] = (out[pc.k] || 0) + (pc.e - pc.s);
    });
    return out;
  }
  // Entries that touch a day, oldest first.
  function dayEntries(data, key, now) {
    var lo = dayStart(key), hi = dayStart(addDays(key, 1));
    return data.entries.filter(function (x) {
      return !x.del && x.s < hi && endOf(x, now) > lo;
    }).sort(function (x, y) { return x.s - y.s || cmpStr(x.id, y.id); });
  }
  // Entries of the same day whose times cross `x` (warning only).
  function overlaps(data, x, now) {
    var xe = endOf(x, now);
    return data.entries.filter(function (y) {
      return !y.del && y.id !== x.id && y.s < xe && endOf(y, now) > x.s;
    });
  }

  // Week grid: rows per project (id "" = no project), 7 day columns.
  function weekGrid(data, mondayKey, now) {
    var sunday = addDays(mondayKey, 6), rows = {}, cols = [0, 0, 0, 0, 0, 0, 0], total = 0;
    var keys = [];
    for (var i = 0; i < 7; i++) keys.push(addDays(mondayKey, i));
    piecesIn(data, mondayKey, sunday, now).forEach(function (pc) {
      var pid = project(data, pc.x.p) ? pc.x.p : "";
      var r = rows[pid] || (rows[pid] = { p: pid, days: [0, 0, 0, 0, 0, 0, 0], total: 0 });
      var col = keys.indexOf(pc.k), ms = pc.e - pc.s;
      r.days[col] += ms; r.total += ms; cols[col] += ms; total += ms;
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (x, y) {
      return y.total - x.total || cmpStr(projectName(data, x.p), projectName(data, y.p)) || cmpStr(x.p, y.p);
    });
    return { keys: keys, rows: list, cols: cols, total: total };
  }
  function projectName(data, pid) { var p = project(data, pid); return p ? p.name : ""; }

  // The report / CSV filter for one entry.
  function matches(data, x, f) {
    var p = project(data, x.p), cid = p ? p.client : "";
    if (f.project && (p ? p.id : "") !== (f.project === "-" ? "" : f.project)) return false;
    if (f.client && cid !== (f.client === "-" ? "" : f.client)) return false;
    var b = billable(data, x.p);
    if (f.bill === "bill" && !b) return false;
    if (f.bill === "non" && b) return false;
    if (f.billed === "open" && x.billed) return false;
    if (f.billed === "done" && !x.billed) return false;
    return true;
  }

  // Report over a day range. f = { client, project, bill: "all"|"bill"|"non",
  // group: "project"|"client"|"day", billed: "all"|"open"|"done" }.
  // Rounding works per piece (an entry, or each day of one that
  // crosses midnight), so the three groupings always add up alike.
  function report(data, fromKey, toKey, f, now) {
    f = f || {};
    var prefs = data.prefs, groups = {}, tot = { ms: 0, billMs: 0, amount: 0, n: 0 }, ids = {};
    piecesIn(data, fromKey, toKey, now).forEach(function (pc) {
      var x = pc.x, p = project(data, x.p), cid = p ? p.client : "";
      if (!matches(data, x, f)) return;
      var isBill = billable(data, x.p);
      var ms = roundMs(pc.e - pc.s, prefs.round, prefs.rup);
      var rate = isBill ? rateOf(data, x.p) : 0;
      var amount = isBill ? Math.round(ms * rate / HOUR) : 0;
      var gk = f.group === "client" ? cid : (f.group === "day" ? pc.k : (p ? p.id : ""));
      var g = groups[gk] || (groups[gk] = { key: gk, ms: 0, billMs: 0, amount: 0, n: 0 });
      g.ms += ms; tot.ms += ms;
      if (isBill) { g.billMs += ms; tot.billMs += ms; }
      g.amount += amount; tot.amount += amount;
      g.n++; tot.n++;
      ids[x.id] = true;
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; });
    if (f.group === "day") rows.sort(function (x, y) { return cmpStr(x.key, y.key); });
    else rows.sort(function (x, y) { return y.ms - x.ms || cmpStr(x.key, y.key); });
    return { rows: rows, total: tot, ids: Object.keys(ids).sort(cmpStr) };
  }

  // ---------- 5. Parsing + formatting ----------
  // "2:30", "1,5", "1.5", "90m", "90 λ", "2h 30m", "2h30", "2ω 30λ" → minutes.
  // A bare whole number up to 12 reads as hours, above 12 as minutes.
  function parseDuration(text) {
    var s = String(text || "").trim().toLowerCase().replace(/\s+/g, " ").replace(",", ".");
    if (!s) return NaN;
    var m = /^(\d{1,3}):([0-5]\d)$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    m = /^\d{1,4}$/.exec(s);
    if (m) return +s <= 12 ? +s * 60 : +s;
    m = /^\d{1,3}\.\d{1,2}$/.exec(s);
    if (m) return Math.round(parseFloat(s) * 60);
    m = /^(?:(\d{1,3}(?:\.\d{1,2})?) ?(?:h|hr|hrs|ω|ώ|ωρ[α-ωάέήίόύώ]*|ώρ[α-ωάέήίόύώ]*))? ?(?:(\d{1,4}) ?(m|min|mins|λ|λεπ[α-ωάέήίόύώ]*|')?)?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return NaN;
    if (!m[1] && !m[3]) return NaN;
    return Math.round((m[1] ? parseFloat(m[1]) : 0) * 60) + (m[2] ? +m[2] : 0);
  }
  // "45", "45,50", "45.5", "1.250,00", "1,250.00" → cents; NaN when not money.
  function parseMoney(text) {
    var s = String(text || "").trim().replace(/[\s€$£]/g, "");
    if (!s) return 0;
    if (!/^\d[\d.,]*$/.test(s)) return NaN;
    var lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    var intPart = s, dec = "";
    if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
      intPart = s.slice(0, lastSep);
      dec = s.slice(lastSep + 1);
    }
    intPart = intPart.replace(/[.,]/g, "");
    if (!/^\d+$/.test(intPart || "0") || !/^\d{0,2}$/.test(dec)) return NaN;
    var cents = parseInt(intPart || "0", 10) * 100 + (dec ? parseInt((dec + "0").slice(0, 2), 10) : 0);
    return cents;
  }
  // "H:MM" (or "H:MM:SS" with secs) of a millisecond span.
  function fmtDur(ms, secs) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600), mi = Math.floor(total / 60) % 60, se = total % 60;
    return h + ":" + pad(mi) + (secs ? ":" + pad(se) : "");
  }
  function locale(lang) { return lang === "el" ? "el-GR" : "en-GB"; }
  function fmtHours(ms, lang) {
    try {
      return new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(ms / HOUR);
    } catch (e) { return (ms / HOUR).toFixed(2); }
  }
  function fmtMoney(cents, cur, lang) {
    try {
      return new Intl.NumberFormat(locale(lang), { style: "currency", currency: cur }).format(cents / 100);
    } catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
  }
  // Money for an input field: "45" or "45,50" (el) / "45.50" (en).
  function moneyInput(cents, lang) {
    if (!cents) return "";
    var whole = Math.floor(cents / 100), dec = cents % 100;
    return dec ? whole + (lang === "el" ? "," : ".") + pad(dec) : String(whole);
  }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // ---------- 6. Export ----------
  // A text cell that Excel / LibreOffice would read as a formula gets
  // a leading apostrophe (CSV injection), then RFC 4180 quoting.
  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // One row per piece (as in the report), `;` separated with a BOM so
  // spreadsheet apps read Greek right; decimals follow the language.
  function toCsv(data, fromKey, toKey, f, now, lang) {
    f = f || {};
    var el = lang === "el";
    var dec = function (n, d) { var s = n.toFixed(d); return el ? s.replace(".", ",") : s; };
    var head = el
      ? ["Ημερομηνία", "Έναρξη", "Λήξη", "Διάρκεια", "Ώρες", "Πελάτης", "Έργο", "Περιγραφή", "Χρεώσιμο", "Χρέωση/ώρα", "Ποσό", "Τιμολογήθηκε"]
      : ["Date", "Start", "End", "Duration", "Hours", "Client", "Project", "Description", "Billable", "Rate", "Amount", "Billed"];
    var yes = el ? "Ναι" : "Yes", no = el ? "Όχι" : "No";
    var lines = [head.map(csvCell).join(";")];
    var prefs = data.prefs;
    var rows = piecesIn(data, fromKey, toKey, now).filter(function (pc) {
      return matches(data, pc.x, f);
    }).sort(function (a, b) { return a.s - b.s || cmpStr(a.x.id, b.x.id); });
    rows.forEach(function (pc) {
      var x = pc.x, p = project(data, x.p), c = projectClient(data, p);
      var b = billable(data, x.p);
      var ms = roundMs(pc.e - pc.s, prefs.round, prefs.rup);
      var rate = b ? rateOf(data, x.p) : 0;
      var d = keyDate(pc.k);
      var dateText = el ? pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() : pc.k;
      lines.push([
        dateText, hhmm(pc.s), pc.e === dayStart(addDays(pc.k, 1)) ? "24:00" : hhmm(pc.e),
        fmtDur(ms), dec(ms / HOUR, 2),
        c ? c.name : "", p ? p.name : "", x.desc,
        b ? yes : no, dec(rate / 100, 2), dec(b ? Math.round(ms * rate / HOUR) / 100 : 0, 2),
        x.billed ? yes : no
      ].map(csvCell).join(";"));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // Backup file: the whole model, tombstones included, so a restore
  // merges (never replaces) and deletions stay deleted.
  function toBackup(data) {
    return JSON.stringify({ app: "timesheet", ver: DATA_VER, data: normalize(data) }, null, 1);
  }
  // A parsed backup → its model, or null when the file is not one.
  function fromBackup(text) {
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    if (!o || typeof o !== "object" || o.app !== "timesheet" || !looksLike(o.data)) return null;
    return normalize(o.data);
  }

  var API = {
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER, HOUR: HOUR, DAY: DAY,
    LIM: LIM, ROUNDS: ROUNDS, CURRENCIES: CURRENCIES, DEFAULT_PREFS: DEFAULT_PREFS, COLORS: COLORS,
    ID_RE: ID_RE, MAX_SPAN: MAX_SPAN,
    isInt: isInt, inRange: inRange, cleanText: cleanText, newId: newId,
    dayKey: dayKey, dayKeyOf: dayKeyOf, keyDate: keyDate, addDays: addDays, validDay: validDay,
    dayStart: dayStart, weekStart: weekStart, monthStart: monthStart, monthEnd: monthEnd,
    normClient: normClient, normProject: normProject, normEntry: normEntry, normPrefs: normPrefs,
    mergeTimesheet: mergeTimesheet, normalize: normalize, empty: empty, parse: parse,
    live: live, project: project, client: client, projectClient: projectClient,
    rateOf: rateOf, billable: billable, running: running, endOf: endOf,
    pieces: pieces, roundMs: roundMs, piecesIn: piecesIn, dayTotals: dayTotals,
    dayEntries: dayEntries, overlaps: overlaps, matches: matches, weekGrid: weekGrid, report: report,
    parseDuration: parseDuration, parseMoney: parseMoney, fmtDur: fmtDur, fmtHours: fmtHours,
    fmtMoney: fmtMoney, moneyInput: moneyInput, hhmm: hhmm,
    csvCell: csvCell, toCsv: toCsv, toBackup: toBackup, fromBackup: fromBackup
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.orosTimesheetCore = API;
})(typeof window !== "undefined" ? window : globalThis);
