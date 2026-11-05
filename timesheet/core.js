// ============================================================
// orOS Timesheet — shared core (v1.0.0)
// The pure model of the Timesheet app: no DOM, no storage writes.
// Exposes window.orosTimesheetCore and, under Node, module.exports
// (tests/timesheet.test.js).
//
// Data (synced slice "timesheet", key oros-timesheet-data):
//   { ver: 1,
//     clients:  [ { id, name, rate, <billing>, crm?, m } | { id, m, del: 1 } ]
//               crm = the CRM customer it is (T1), written only when set
//     projects: [ { id, name, client, color, rate, bill, arch, budget?, fee?, <billing>, m } | tomb ]
//               fee = a fixed fee in cents (T3): its time is not charged
//               by the hour; the fee goes on as an extra charge (fee: 1)
//               <billing> = minH?, minAmt?, otH?, minPer?, otRate? (minimum
//               charge and overtime, see normBilling)
//     entries:  [ { id, p, desc, s, e, billed, task?, tags?, iv?, m } | tomb ]
//               iv = the Invoices document it went on (T1, BR-TS-INV),
//               written only when set and meant only while billed;
//               src = what it was for (T2): "todo:<id>", "kanban:<id>",
//               "cal:<event>:<day>", written only when set
//     extras:   [ { id, d, p, c, desc, amt, billed, iv?, km?, kmr?, fee?, bud?, m } | tomb ]
//               km/kmr = mileage (distance, cents per km), fee = a
//               project's fixed fee, bud = sent to Budget (T3)
//               extra charges (fuel, travel, …): written only when
//               the list has a record, so data without one stays
//               byte-identical to what older versions write
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
//   5b. Invoices link + unbilled time (T1)
//   5c. Time from tasks, cards and events (T2)
//   5d. Packages, fixed fees, mileage, Budget (T3); .ics (T5)
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
    color: [0, 7],
    task: 80, tag: 30, tags: 10,     // per entry (Wave 6)
    budget: [0, 6000000],            // minutes per project (100.000 h), 0 = no budget
    minH: [0, 44640],                // minimum minutes per period (31 days), 0 = none; also otH
    minAmt: [0, 100000000],          // minimum amount per period in cents (a day rate), 0 = none
    exDesc: 200, amt: [1, 100000000], // extra charge: text, cents (1.000.000,00 max)
    fee: [0, 100000000],             // T3: a project's fixed fee in cents, 0 = none
    km: [0.1, 100000],               // T3: a mileage charge's distance (one decimal)
    kmr: [1, 100000]                 // T3: its rate in cents per km
  };
  var MIN_PERS = ["d", "w", "m"];    // the minimum applies per day, week or month
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
  // An id of another app's record (an Invoices document, a CRM
  // customer): the shape those apps accept, nothing more is assumed.
  var LINK_RE = /^[A-Za-z0-9_-]{1,60}$/;
  function linkId(v) { return typeof v === "string" && LINK_RE.test(v) ? v : ""; }
  // T2 (BR-TS-SRC): what an entry was for, "todo:<task>", "kanban:<card>"
  // or "cal:<event>:<occurrence day>".
  var SRC_RE = /^(todo|kanban|cal):[A-Za-z0-9_.:-]{1,90}$/;
  function srcKey(v) { return typeof v === "string" && SRC_RE.test(v) ? v : ""; }

  // Forward compatibility (as in Budget): a flat field this version
  // does not know rides along on its record, sorted by name, so a
  // newer version can add fields without this one stripping them
  // (stripping would make two versions re-upload forever).
  var EXTRA_RE = /^[a-z][a-z0-9]{0,15}$/, EXTRA_MAX = 16;
  var KNOWN = {
    client:  ["id", "name", "rate", "minH", "minAmt", "otH", "minPer", "otRate", "crm", "m", "del"],
    project: ["id", "name", "client", "color", "rate", "bill", "arch", "budget",
              "minH", "minAmt", "otH", "minPer", "otRate", "fee", "m", "del"],
    entry:   ["id", "p", "desc", "s", "e", "billed", "task", "tags", "iv", "src", "m", "del"],
    extra:   ["id", "d", "p", "c", "desc", "amt", "billed", "iv", "km", "kmr", "fee", "bud", "m", "del"]
  };
  function withExtras(out, x, known) {
    var n = 0;
    Object.keys(x).filter(function (k) { return EXTRA_RE.test(k) && known.indexOf(k) < 0; })
      .sort(cmpStr).forEach(function (k) {
        var v = x[k];
        var ok = typeof v === "string" ? v.length <= 500
               : typeof v === "boolean" || (typeof v === "number" && isFinite(v));
        if (ok && n < EXTRA_MAX) { out[k] = v; n++; }
      });
    return out;
  }
  // Tags: "#" and control characters out, at most LIM.tags, unique
  // regardless of case (the first spelling stays), sorted, so every
  // device writes the same list.
  function normTags(v) {
    if (!Array.isArray(v)) return [];
    var out = [], seen = {};
    v.forEach(function (t) {
      var s = cleanText(typeof t === "string" ? t.replace(/^[#\s]+/, "") : "", LIM.tag);
      var k = s.toLowerCase();
      if (!s || seen[k] || out.length >= LIM.tags) return;
      seen[k] = true;
      out.push(s);
    });
    return out.sort(function (a, b) { return cmpStr(a.toLowerCase(), b.toLowerCase()) || cmpStr(a, b); });
  }
  // "design, #client a; urgent" → ["client a", "design", "urgent"]
  function parseTags(text) { return normTags(String(text || "").split(/[,;]/)); }

  function normClient(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.name);
    if (!name) return null;
    var out = { id: x.id, name: name, rate: inRange(x.rate, LIM.rate) ? x.rate : 0 };
    normBilling(out, x);
    // T1: the CRM customer this client is (BR-TS-CRM), written only when set
    var crm = linkId(x.crm);
    if (crm) out.crm = crm;
    out.m = x.m;
    return withExtras(out, x, KNOWN.client);
  }
  function normProject(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.name);
    if (!name) return null;
    var out = {
      id: x.id, name: name, client: refId(x.client),
      color: inRange(x.color, LIM.color) ? x.color : 0,
      rate: inRange(x.rate, LIM.rate) ? x.rate : 0,
      bill: x.bill === 0 ? 0 : 1,
      arch: x.arch ? 1 : 0
    };
    // Written only when set, so records without one stay byte-identical.
    if (inRange(x.budget, LIM.budget) && x.budget > 0) out.budget = x.budget;
    if (inRange(x.fee, LIM.fee) && x.fee > 0) out.fee = x.fee;      // T3: fixed fee, time not charged by the hour
    normBilling(out, x);
    out.m = x.m;
    return withExtras(out, x, KNOWN.project);
  }
  // Minimum charge and overtime of a client or a project, per period
  // minPer d|w|m (day by default): minH minimum hours (minutes),
  // minAmt minimum amount (cents: a day rate), otH hours after which
  // time is overtime (minutes; 0 = after minH, none without it),
  // otRate the overtime hourly rate (0 = the usual rate). All written
  // only when one of minH / minAmt / otH is set, so records without
  // them stay byte-identical.
  function normBilling(out, x) {
    var h = inRange(x.minH, LIM.minH) ? x.minH : 0, a = inRange(x.minAmt, LIM.minAmt) ? x.minAmt : 0;
    var o = inRange(x.otH, LIM.minH) ? x.otH : 0;
    if (!h && !a && !o) return out;
    if (h) out.minH = h;
    if (a) out.minAmt = a;
    if (o) out.otH = o;
    out.minPer = MIN_PERS.indexOf(x.minPer) >= 0 ? x.minPer : "d";
    if ((h || o) && inRange(x.otRate, LIM.rate) && x.otRate > 0) out.otRate = x.otRate;
    return out;
  }
  function hasBilling(r) { return !!r && !!(r.minH || r.minAmt || r.otH); }
  function normEntry(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (!isInt(x.s) || x.s < MIN_TS || x.s > MAX_TS) return null;
    var e = isInt(x.e) ? x.e : -1;
    if (e !== 0 && (e <= x.s || e - x.s > MAX_SPAN)) return null;
    var out = {
      id: x.id, p: refId(x.p), desc: cleanText(x.desc, LIM.desc),
      s: x.s, e: e, billed: x.billed ? 1 : 0
    };
    var task = cleanText(x.task, LIM.task), tags = normTags(x.tags);
    if (task) out.task = task;
    if (tags.length) out.tags = tags;
    var iv = linkId(x.iv);        // T1: the Invoices document it went on (meant only while billed)
    if (iv) out.iv = iv;
    var src = srcKey(x.src);      // T2: the To-Do task, Kanban card or Calendar event it was for
    if (src) out.src = src;
    out.m = x.m;
    return withExtras(out, x, KNOWN.entry);
  }
  // An extra charge on a day: a project (its client follows it) or
  // just a client, a description and an amount in cents.
  function normExtra(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (!validDay(x.d) || !inRange(x.amt, LIM.amt)) return null;
    var out = {
      id: x.id, d: x.d, p: refId(x.p), c: refId(x.c), desc: cleanText(x.desc, LIM.exDesc),
      amt: x.amt, billed: x.billed ? 1 : 0
    };
    var iv = linkId(x.iv);        // T1: the Invoices document it went on (meant only while billed)
    if (iv) out.iv = iv;
    // T3: a mileage charge keeps its distance and rate per km (amt is
    // what was charged: km × kmr, rounded); fee marks a project's fixed
    // fee; bud marks one sent to Budget. Each only when set.
    if (typeof x.km === "number" && isFinite(x.km) && x.km >= LIM.km[0] && x.km <= LIM.km[1] &&
        Math.abs(Math.round(x.km * 10) - x.km * 10) < 1e-9 && inRange(x.kmr, LIM.kmr)) {
      out.km = Math.round(x.km * 10) / 10;
      out.kmr = x.kmr;
    }
    if (x.fee === 1) out.fee = 1;
    if (x.bud === 1) out.bud = 1;
    out.m = x.m;
    return withExtras(out, x, KNOWN.extra);
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
    var out = {
      ver: DATA_VER,
      clients: mergeList(a.clients, b.clients, normClient),
      projects: mergeList(a.projects, b.projects, normProject),
      entries: mergeList(a.entries, b.entries, normEntry)
    };
    var extras = mergeList(a.extras, b.extras, normExtra);
    if (extras.length) out.extras = extras;
    out.prefs = prefs;
    out.pm = pm;
    return out;
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
  // A timer running this long is probably forgotten: the app shows a
  // banner and the shell sends one notification (Wave 3).
  var FORGOT_MS = 10 * 3600000;
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
  // Calendar feed (Wave 4): one row per project on a day, in the
  // order the work started. ms counts a running timer up to `now`;
  // notes = the day's distinct descriptions. pid "" = no project.
  function dayFeed(data, key, now) {
    var by = {}, out = [];
    piecesIn(data, key, key, now).sort(function (a, b) {
      return a.s - b.s || cmpStr(a.x.id, b.x.id);
    }).forEach(function (pc) {
      var pid = project(data, pc.x.p) ? pc.x.p : "";
      var r = by[pid];
      if (!r) {
        var p = project(data, pid);
        r = by[pid] = { pid: pid, name: p ? p.name : "", color: p ? p.color : -1, ms: 0, running: false, notes: [] };
        out.push(r);
      }
      r.ms += pc.e - pc.s;
      if (pc.x.e === 0) r.running = true;
      if (pc.x.desc && r.notes.indexOf(pc.x.desc) < 0) r.notes.push(pc.x.desc);
    });
    return out;
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
    if (f.tag === "-" && x.tags && x.tags.length) return false;
    if (f.tag && f.tag !== "-" && !hasTag(x, f.tag)) return false;
    return true;
  }
  function hasTag(x, tag) {
    var k = String(tag).toLowerCase();
    return !!x.tags && x.tags.some(function (t) { return t.toLowerCase() === k; });
  }
  // The report groups of one piece, as [key, label]. "task" groups per
  // project and task, "tag" per tag, both regardless of case (the label
  // is the first spelling met). "tag" puts an entry under each of its
  // tags (untagged under ""), so tag rows can add up to more than the total.
  var TASK_SEP = "\u0001";
  function groupKeys(data, x, k, f) {
    var p = project(data, x.p), pid = p ? p.id : "";
    if (f.group === "client") return [[p ? p.client : "", ""]];
    if (f.group === "day") return [[k, ""]];
    if (f.group === "task") return [[pid + TASK_SEP + (x.task || "").toLowerCase(), x.task || ""]];
    if (f.group === "tag") {
      if (!x.tags || !x.tags.length) return [["", ""]];
      return x.tags.filter(function (t) {
        return !f.tag || f.tag === "-" || t.toLowerCase() === f.tag.toLowerCase();
      }).map(function (t) { return [t.toLowerCase(), t]; });
    }
    return [[pid, ""]];
  }

  // ---------- Minimum charge, overtime, extra charges ----------
  // A project, or else its client, can have a minimum charge and an
  // overtime threshold per day, week or month (normBilling). In each
  // period with work, billable time up to the threshold (otH, else
  // minH) is charged at its usual rate and time beyond it is overtime
  // at otRate (0 = the usual rate); when the time up to the threshold
  // comes to less than the minimum (minH hours at the rate of the
  // period's last piece, or the amount minAmt, whichever is more), a
  // "top-up" charges the difference. A project's own settings make
  // its periods its own; a client's cover all its projects without
  // their own, together. Only billable time in the report's filter
  // counts, a period counts only when it lies wholly inside the
  // report's range (a week or month cut by the range gets no minimum
  // and no overtime: "partial"), and a period without work charges
  // nothing. Nothing here touches the stored entries.
  function periodOf(k, per) { return per === "w" ? weekStart(k) : per === "m" ? monthStart(k) : k; }
  function periodEnd(from, per) { return per === "w" ? addDays(from, 6) : per === "m" ? monthEnd(from) : from; }
  // Whose minimum / overtime applies to a project: { key, src (the
  // record), pid, cid }, or null.
  function billingOf(data, p) {
    if (!p) return null;
    if (hasBilling(p)) return { key: "p" + p.id, src: p, pid: p.id, cid: "" };
    var c = client(data, p.client);
    return hasBilling(c) ? { key: "c" + c.id, src: c, pid: "", cid: c.id } : null;
  }
  // The hourly rate time is charged at: rateOf, except that a project
  // with its own day rate (minAmt) has only its own hourly rate (none
  // inherited from the client or Settings), so a day-rate project
  // without one charges its day rate and overtime alone.
  function chargeRate(data, pid) {
    var p = project(data, pid);
    if (p && p.fee) return 0;              // T3: a fixed-fee project's time is not charged by the hour
    return p && hasBilling(p) && p.minAmt ? p.rate : rateOf(data, pid);
  }
  // The report's pieces in the range and filter, oldest first, each
  // with ms (rounded), bill, rate, amount (overtime included), otMs,
  // otRate and otAmount (what the overtime part is charged).
  // → { pcs, tops: [{ key, pid, cid, per, from, to, ms, rate, amount, pc }], partial }
  //   a top-up's ms > 0 when the minimum hours decided it (ms × rate),
  //   0 when the minimum amount did.
  function chargedPieces(data, fromKey, toKey, f, now) {
    var prefs = data.prefs, groups = {}, order = [], tops = [], partial = 0;
    var pcs = piecesIn(data, fromKey, toKey, now).filter(function (pc) {
      return matches(data, pc.x, f);
    }).sort(function (a, b) { return a.s - b.s || cmpStr(a.x.id, b.x.id); });
    pcs.forEach(function (pc) {
      pc.bill = billable(data, pc.x.p);
      pc.ms = roundMs(pc.e - pc.s, prefs.round, prefs.rup);
      pc.rate = pc.bill ? chargeRate(data, pc.x.p) : 0;
      pc.amount = pc.bill ? Math.round(pc.ms * pc.rate / HOUR) : 0;
      pc.otMs = 0;
      pc.otRate = 0;
      pc.otAmount = 0;
      if (!pc.bill) return;
      var b = billingOf(data, project(data, pc.x.p));
      if (!b) return;
      var per = b.src.minPer, from = periodOf(pc.k, per), gk = b.key + TASK_SEP + from;
      if (!groups[gk]) { groups[gk] = { b: b, from: from, to: periodEnd(from, per), list: [] }; order.push(gk); }
      groups[gk].list.push(pc);
    });
    order.forEach(function (gk) {
      var g = groups[gk], src = g.b.src;
      if (g.from < fromKey || g.to > toKey) { partial++; return; }
      var thr = (src.otH || src.minH || 0) * 60000, cum = 0, base = 0;
      g.list.forEach(function (pc) {
        var within = thr ? Math.max(0, Math.min(pc.ms, thr - cum)) : pc.ms, over = pc.ms - within;
        cum += pc.ms;
        base += Math.round(within * pc.rate / HOUR);
        if (!over) return;
        pc.otMs = over;
        pc.otRate = src.otRate || pc.rate;
        pc.otAmount = Math.round(over * pc.otRate / HOUR);
        pc.amount = Math.round(within * pc.rate / HOUR) + pc.otAmount;
      });
      var last = g.list[g.list.length - 1];
      var shortMs = src.minH ? Math.max(0, src.minH * 60000 - cum) : 0;
      var byHours = Math.round(shortMs * last.rate / HOUR), byAmt = src.minAmt ? Math.max(0, src.minAmt - base) : 0;
      if (shortMs || byAmt > 0) {
        var hoursWin = byHours >= byAmt && shortMs > 0;
        var amount = Math.max(byHours, byAmt);
        if (!amount && !hoursWin) return;
        tops.push({ key: g.b.key, pid: g.b.pid, cid: g.b.cid, per: src.minPer, from: g.from, to: g.to,
                    ms: hoursWin ? shortMs : 0, rate: hoursWin ? last.rate : 0, amount: amount, pc: last });
      }
    });
    return { pcs: pcs, tops: tops, partial: partial };
  }
  // An extra charge's project ("" when none or gone) and client (its
  // project's, else its own when that client still exists).
  function extraProject(data, x) { return project(data, x.p) ? x.p : ""; }
  function extraClient(data, x) {
    var p = project(data, x.p);
    if (p) return p.client;
    return client(data, x.c) ? x.c : "";
  }
  // Extra charges are billable and have no tags: a "non-billable" or a
  // tag filter leaves them out ("no tag" keeps them).
  function matchesExtra(data, x, f) {
    var pid = extraProject(data, x), cid = extraClient(data, x);
    if (f.project && pid !== (f.project === "-" ? "" : f.project)) return false;
    if (f.client && cid !== (f.client === "-" ? "" : f.client)) return false;
    if (f.bill === "non") return false;
    if (f.billed === "open" && x.billed) return false;
    if (f.billed === "done" && !x.billed) return false;
    if (f.tag && f.tag !== "-") return false;
    return true;
  }
  // Live extra charges in [fromKey, toKey] and the filter, by day.
  function extrasIn(data, fromKey, toKey, f) {
    f = f || {};
    return (data.extras || []).filter(function (x) {
      return !x.del && x.d >= fromKey && x.d <= toKey && matchesExtra(data, x, f);
    }).sort(function (a, b) { return cmpStr(a.d, b.d) || cmpStr(a.id, b.id); });
  }
  function extraGroupKey(data, x, f) {
    var pid = extraProject(data, x);
    if (f.group === "client") return [extraClient(data, x), ""];
    if (f.group === "day") return [x.d, ""];
    if (f.group === "task") return [pid + TASK_SEP, ""];
    if (f.group === "tag") return ["", ""];
    return [pid, ""];
  }

  // Report over a day range. f = { client, project, bill: "all"|"bill"|"non",
  // group: "project"|"client"|"day"|"task"|"tag", billed: "all"|"open"|"done",
  // tag: ""|"-" (untagged)|a tag }.
  // Rounding works per piece (an entry, or each day of one that
  // crosses midnight), so the three groupings always add up alike.
  // amount = time (overtime included) + minimum top-ups + extra
  // charges; minMs / minAmount, otMs / otAmount (what the overtime
  // part is charged) and exAmount / exN show the parts. A top-up
  // counts under the group of its period's last piece.
  function report(data, fromKey, toKey, f, now) {
    f = f || {};
    var groups = {}, ids = {}, exIds = [];
    var tot = { ms: 0, billMs: 0, amount: 0, n: 0, minMs: 0, minAmount: 0, minN: 0, otMs: 0, otAmount: 0, exAmount: 0, exN: 0 };
    function grp(kl) {
      return groups[kl[0]] || (groups[kl[0]] = { key: kl[0], label: kl[1], ms: 0, billMs: 0, amount: 0, n: 0,
                                                minMs: 0, otMs: 0, exAmount: 0 });
    }
    var plan = chargedPieces(data, fromKey, toKey, f, now);
    plan.pcs.forEach(function (pc) {
      var x = pc.x;
      groupKeys(data, x, pc.k, f).forEach(function (kl) {
        var g = grp(kl);
        g.ms += pc.ms;
        if (pc.bill) g.billMs += pc.ms;
        g.amount += pc.amount;
        g.otMs += pc.otMs;
        g.n++;
      });
      tot.ms += pc.ms;
      if (pc.bill) tot.billMs += pc.ms;
      tot.amount += pc.amount;
      tot.otMs += pc.otMs;
      tot.otAmount += pc.otAmount;
      tot.n++;
      ids[x.id] = true;
    });
    plan.tops.forEach(function (tp) {
      groupKeys(data, tp.pc.x, tp.pc.k, f).forEach(function (kl) {
        var g = grp(kl);
        g.minMs += tp.ms;
        g.amount += tp.amount;
      });
      tot.minMs += tp.ms;
      tot.minAmount += tp.amount;
      tot.minN++;
      tot.amount += tp.amount;
    });
    extrasIn(data, fromKey, toKey, f).forEach(function (x) {
      var g = grp(extraGroupKey(data, x, f));
      g.exAmount += x.amt;
      g.amount += x.amt;
      tot.exAmount += x.amt;
      tot.amount += x.amt;
      tot.exN++;
      exIds.push(x.id);
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; });
    if (f.group === "day") rows.sort(function (x, y) { return cmpStr(x.key, y.key); });
    else rows.sort(function (x, y) { return y.ms - x.ms || cmpStr(x.key, y.key); });
    return { rows: rows, total: tot, ids: Object.keys(ids).sort(cmpStr), exIds: exIds.sort(cmpStr),
             tops: plan.tops, partial: plan.partial };
  }

  // Hours budget of a project (all time, exact times as in the
  // Projects list). null without a budget; else { ms, budgetMs, pct,
  // state: "ok" | "near" (90 % or more) | "over" }.
  function budgetUse(data, pid, now) {
    var p = project(data, pid);
    if (!p || !p.budget) return null;
    var ms = 0;
    data.entries.forEach(function (x) { if (!x.del && x.p === pid) ms += endOf(x, now) - x.s; });
    var budgetMs = p.budget * 60000, pct = Math.floor(ms / budgetMs * 100);
    return { ms: ms, budgetMs: budgetMs, pct: pct,
             state: ms > budgetMs ? "over" : (pct >= 90 ? "near" : "ok") };
  }
  // Tasks used on a project, the most recently used first.
  function taskList(data, pid) {
    var last = {}, name = {};
    data.entries.forEach(function (x) {
      if (x.del || !x.task || (x.p || "") !== (pid || "")) return;
      var k = x.task.toLowerCase();
      if (!last[k] || x.s > last[k]) { last[k] = x.s; name[k] = x.task; }
    });
    return Object.keys(last).sort(function (a, b) { return last[b] - last[a] || cmpStr(a, b); })
      .map(function (k) { return name[k]; });
  }
  // Every tag in use (one spelling each, the most recent), A–Z.
  function tagList(data) {
    var last = {}, name = {};
    data.entries.forEach(function (x) {
      if (x.del || !x.tags) return;
      x.tags.forEach(function (t) {
        var k = t.toLowerCase();
        if (!last[k] || x.s > last[k]) { last[k] = x.s; name[k] = t; }
      });
    });
    return Object.keys(name).sort(cmpStr).map(function (k) { return name[k]; });
  }
  function splitTaskKey(key) {
    var i = key.indexOf(TASK_SEP);
    return i < 0 ? { p: key, task: "" } : { p: key.slice(0, i), task: key.slice(i + 1) };
  }

  // ---------- Pomodoro inbox (Wave 7, BR-TS-POMO) ----------
  // Time's Pomodoro writes each focus leg it should log to the
  // device-local key INBOX_KEY (never synced) when the leg STARTS,
  // with its planned end; stopping early moves the end to "now" (or
  // drops a leg under a minute). Timesheet alone turns legs whose end
  // has passed into entries (task "Pomodoro", id hashed from the
  // start, so a leg is logged once), then removes them from the inbox.
  // So a leg is logged even if Time is never opened again.
  var INBOX_KEY = "oros-timesheet-inbox", INBOX_MAX = 200, INBOX_BYTES = 65536;
  var POMO_MIN = 60000, POMO_MAX = 3 * HOUR, POMO_TASK = "Pomodoro";
  function inboxRead(raw) {
    var a = null;
    try { a = typeof raw === "string" && raw.length <= INBOX_BYTES ? JSON.parse(raw) : null; } catch (e) { a = null; }
    if (!Array.isArray(a)) return [];
    var out = [], seen = {};
    a.forEach(function (x) {
      if (!x || typeof x !== "object" || !isInt(x.s) || !isInt(x.e)) return;
      if (x.s < MIN_TS || x.s > MAX_TS || x.e <= x.s || x.e - x.s > POMO_MAX) return;
      if (seen[x.s] || out.length >= INBOX_MAX) return;
      seen[x.s] = true;
      out.push({ s: x.s, e: x.e, p: refId(x.p) });
    });
    return out.sort(function (x, y) { return x.s - y.s; });
  }
  // A leg starts (or is replaced): { s, e, p }.
  function inboxPut(list, leg) {
    var out = list.filter(function (x) { return x.s !== leg.s; });
    if (isInt(leg.s) && isInt(leg.e) && leg.e > leg.s && leg.e - leg.s <= POMO_MAX) {
      out.push({ s: leg.s, e: leg.e, p: refId(leg.p) });
    }
    return out.sort(function (x, y) { return x.s - y.s; }).slice(-INBOX_MAX);
  }
  // A leg stopped by hand at `now`: it ends there, or goes when under a minute.
  function inboxEnd(list, s, now) {
    return list.filter(function (x) { return x.s !== s || now - s >= POMO_MIN; })
      .map(function (x) { return x.s === s && now < x.e ? { s: x.s, e: now, p: x.p } : x; });
  }
  function pomoId(s) { return hashId("pomo", String(s)); }
  // → { add (a model for mergeTimesheet), done: [s…] (legs to remove
  // from the inbox: logged now or earlier), n (new entries) }.
  function inboxDrain(data, list, now) {
    var have = {}, add = { entries: [], projects: [], clients: [] }, done = [];
    data.entries.forEach(function (x) { have[x.id] = true; });
    list.forEach(function (x) {
      if (x.e > now) return;                        // still running
      done.push(x.s);
      var id = pomoId(x.s);
      if (have[id]) return;
      have[id] = true;
      add.entries.push({ id: id, p: project(data, x.p) ? x.p : "", desc: "", s: x.s, e: x.e,
                         billed: 0, task: POMO_TASK, m: now });
    });
    return { add: add, done: done, n: add.entries.length };
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
    m = /^(?:(\d{1,3}(?:\.\d{1,2})?) ?(?:h|hr|hrs|ω|ώ|ωρ[α-ωάέήίόύώ]*|ώρ[α-ωάέήίόύώ]*))? ?(?:(\d{1,4}) ?(m|min|mins|λ|λεπ[α-ωάέήίόύώ]*|\x27)?)?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return NaN;
    if (!m[1] && !m[3]) return NaN;
    return Math.round((m[1] ? parseFloat(m[1]) : 0) * 60) + (m[2] ? +m[2] : 0);
  }
  // A budget in hours: "40", "40,5", "40.5", "40:30" → minutes; "" → 0;
  // NaN when not hours. Unlike parseDuration a bare number is always hours.
  function parseHours(text) {
    var s = String(text || "").trim().replace(/\s+/g, "").replace(/(h|ω|ώρες|ωρες|hours?)$/i, "");
    if (!s) return 0;
    var m = /^(\d{1,6}):([0-5]\d)$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    if (!/^\d{1,6}([.,]\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s.replace(",", ".")) * 60);
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
  // Words in exports (CSV head, Yes/No, a quote line without a
  // project). orOS pack "timesheet" (../i18n.js) for other languages;
  // under Node (tests) only en/el.
  var I18N = typeof window !== "undefined" && window.orosI18n ? window.orosI18n : null;
  var STRINGS = {
    en: {
      "exp.date": "Date", "exp.start": "Start", "exp.end": "End", "exp.duration": "Duration",
      "exp.hours": "Hours", "exp.client": "Client", "exp.project": "Project",
      "exp.desc": "Description", "exp.task": "Task", "exp.tags": "Tags", "exp.billable": "Billable",
      "exp.rate": "Rate", "exp.amount": "Amount", "exp.billed": "Billed",
      "exp.yes": "Yes", "exp.no": "No", "noProject": "No project",
      "exp.minimum": "Minimum charge", "exp.overtime": "Overtime", "exp.extra": "Extra charge"
    },
    el: {
      "exp.date": "Ημερομηνία", "exp.start": "Έναρξη", "exp.end": "Λήξη", "exp.duration": "Διάρκεια",
      "exp.hours": "Ώρες", "exp.client": "Πελάτης", "exp.project": "Έργο",
      "exp.desc": "Περιγραφή", "exp.task": "Εργασία", "exp.tags": "Ετικέτες", "exp.billable": "Χρεώσιμο",
      "exp.rate": "Χρέωση/ώρα", "exp.amount": "Ποσό", "exp.billed": "Τιμολογήθηκε",
      "exp.yes": "Ναι", "exp.no": "Όχι", "noProject": "Χωρίς έργο",
      "exp.minimum": "Ελάχιστη χρέωση", "exp.overtime": "Υπερωρία", "exp.extra": "Πρόσθετη χρέωση"
    }
  };
  if (I18N) I18N.table(STRINGS, "timesheet", I18N.lang());
  function words(lang) {
    if (!STRINGS[lang] && I18N && lang) I18N.table(STRINGS, "timesheet", lang);
    return STRINGS[lang] || STRINGS.en;
  }
  function locale(lang) {
    return I18N && lang ? I18N.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
  }
  // Decimal comma in exports and money inputs: el, and any language
  // whose numbers use one (de); English keeps the point.
  function comma(lang) {
    if (lang === "el") return true;
    if (!lang || lang === "en") return false;
    try { return new Intl.NumberFormat(locale(lang)).format(1.5).indexOf(",") >= 0; } catch (e) { return false; }
  }
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
    return dec ? whole + (comma(lang) ? "," : ".") + pad(dec) : String(whole);
  }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // ---------- 5b. Invoices link + unbilled time (T1, BR-TS-INV) ----------
  // "Create invoice" opens a prefilled invoice whose ref is
  // { app: "timesheet", id: <batch> }; Invoices keeps it on the saved
  // document as src "timesheet:<batch>" (Invoices wave 7). The ids of
  // that invoice's entries and extra charges wait in a DEVICE-LOCAL
  // list (PEND_KEY, never synced): once a document made from the batch
  // exists (a draft too, so the same hours are not invoiced twice),
  // they are marked invoiced with iv = the document's id, and that mark
  // syncs like any edit. A document that is deleted, cancelled or
  // credited in full takes its marks off again. An iv whose document
  // this device does not know yet (Invoices not synced here) is left
  // alone, so a slower device never undoes a mark.
  var PEND_KEY = "oros-timesheet-invpend", PEND_MAX = 20, PEND_MS = 30 * DAY, PEND_IDS = 2000;
  function pendIds(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && ID_RE.test(x); }).slice(0, PEND_IDS) : [];
  }
  // Pending batches: { <batch>: { at, ids, ex } }, at most PEND_MAX
  // (the newest), each dropped 30 days after it was made.
  function normPend(o, now) {
    var out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).filter(function (k) { return ID_RE.test(k); }).forEach(function (k) {
      var b = o[k];
      if (!b || typeof b !== "object" || !isInt(b.at) || now - b.at > PEND_MS || b.at > now + DAY) return;
      var ids = pendIds(b.ids), ex = pendIds(b.ex);
      if (ids.length || ex.length) out[k] = { at: b.at, ids: ids, ex: ex };
    });
    Object.keys(out).sort(function (a, b) { return out[b].at - out[a].at || cmpStr(a, b); })
      .slice(PEND_MAX).forEach(function (k) { delete out[k]; });
    return out;
  }
  function pendAdd(pend, batch, ids, exIds, now) {
    var o = normPend(pend, now);
    if (ID_RE.test(batch)) o[batch] = { at: now, ids: pendIds(ids), ex: pendIds(exIds) };
    return normPend(o, now);
  }
  // look.doc(batch) → the id of the document made from that batch, or "";
  // look.gone(docId) → true (deleted, cancelled or credited in full),
  // false (it stands), null (this device does not know it).
  // → { set: [{ id, iv }], clear: [id], done: [batch] }
  function invLink(data, pend, look, now) {
    var out = { set: [], clear: [], done: [] }, seen = {}, gone = {};
    var goneOf = function (id) { if (!(id in gone)) gone[id] = look.gone(id); return gone[id]; };
    var p = normPend(pend, now);
    Object.keys(p).sort(cmpStr).forEach(function (b) {
      var doc = linkId(look.doc(b));
      if (!doc || goneOf(doc) === true) return;
      out.done.push(b);
      p[b].ids.concat(p[b].ex).forEach(function (id) {
        var x = byId(data.entries, id) || byId(data.extras || [], id);
        if (!x || seen[id] || x.e === 0) return;
        if (x.billed && x.iv && x.iv !== doc && goneOf(x.iv) !== true) return;   // on another invoice already
        seen[id] = true;
        if (!(x.billed && x.iv === doc)) out.set.push({ id: id, iv: doc });
      });
    });
    live(data.entries).concat(live(data.extras || [])).forEach(function (x) {
      if (x.iv && x.billed && !seen[x.id] && goneOf(x.iv) === true) out.clear.push(x.id);
    });
    return out;
  }
  // Billable time and extra charges not invoiced yet, per client (all
  // time up to today, minimums and overtime as in Reports):
  // [{ cid, ms, amount, since, n }], the largest amount first; since =
  // the day of the oldest piece, n = entries + extra charges.
  function unbilled(data, todayKey, now) {
    var rep = report(data, "2000-01-01", todayKey, { bill: "bill", billed: "open", group: "client" }, now);
    var since = {}, n = {};
    var note = function (cid, day) {
      if (!since[cid] || day < since[cid]) since[cid] = day;
      n[cid] = (n[cid] || 0) + 1;
    };
    rep.ids.forEach(function (id) {
      var x = byId(data.entries, id), p = x ? project(data, x.p) : null;
      if (x) note(p ? p.client : "", dayKeyOf(x.s));
    });
    rep.exIds.forEach(function (id) {
      var x = byId(data.extras || [], id);
      if (x) note(extraClient(data, x), x.d);
    });
    return rep.rows.filter(function (r) { return r.billMs > 0 || r.amount > 0; }).map(function (r) {
      return { cid: r.key, ms: r.billMs, amount: r.amount, since: since[r.key] || "", n: n[r.key] || 0 };
    }).sort(function (a, b) { return b.amount - a.amount || b.ms - a.ms || cmpStr(a.cid, b.cid); });
  }

  // ---------- 5c. Time from tasks, cards and events (T2, BR-TS-SRC) ----------
  // Tracked time per source key: { "todo:<id>": ms, … } for the keys
  // that start with `prefix` ("" = every key). A running entry counts
  // up to now.
  function timeBySrc(data, prefix, now) {
    var out = {};
    data.entries.forEach(function (x) {
      if (x.del || !x.src || (prefix && x.src.indexOf(prefix) !== 0)) return;
      out[x.src] = (out[x.src] || 0) + (endOf(x, now) - x.s);
    });
    return out;
  }
  // Calendar events of a day that ended and have no time logged:
  // evs = [{ key, title, s, e }] (timed occurrences, ms); left out are
  // those not over yet, those dismissed (skip = { key: 1 }), those an
  // entry names (src) and those already covered for half their length
  // or more by entries (a timer started from the event, say).
  function calSuggest(data, evs, skip, now) {
    var named = timeBySrc(data, "cal:", now);
    return (evs || []).filter(function (v) {
      if (!v || !srcKey(v.key) || !isInt(v.s) || !isInt(v.e) || v.e <= v.s || v.e > now) return false;
      if ((skip && skip[v.key]) || named[v.key]) return false;
      var cov = 0;
      data.entries.forEach(function (x) {
        if (x.del) return;
        var a = Math.max(x.s, v.s), b = Math.min(endOf(x, now), v.e);
        if (b > a) cov += b - a;
      });
      return cov * 2 < v.e - v.s;
    }).sort(function (a, b) { return a.s - b.s || cmpStr(a.key, b.key); });
  }

  // ---------- 5d. Packages, fixed fees, mileage (T3) ----------
  // A retainer is a client's or project's minimum charge per week or
  // month (normBilling) with hours included (otH, else minH): the
  // period's fee covers them and overtime is charged after them.
  // → null, or { from, to, ms (this period, rounded as in reports),
  //   inclMs, pct, state: "ok" | "near" (80 % or more) | "over" }.
  function pkgUse(data, kind, id, todayKey, now) {
    var rec = kind === "c" ? client(data, id) : project(data, id);
    if (!rec || !hasBilling(rec) || rec.minPer === "d") return null;
    var incl = rec.otH || rec.minH || 0;
    if (!incl) return null;
    var from = periodOf(todayKey, rec.minPer), to = periodEnd(from, rec.minPer), key = kind + id, ms = 0;
    piecesIn(data, from, to, now).forEach(function (pc) {
      if (!billable(data, pc.x.p)) return;
      var b = billingOf(data, project(data, pc.x.p));
      if (b && b.key === key) ms += roundMs(pc.e - pc.s, data.prefs.round, data.prefs.rup);
    });
    var inclMs = incl * 60000, pct = Math.floor(ms / inclMs * 100);
    return { from: from, to: to, ms: ms, inclMs: inclMs, pct: pct,
             state: ms > inclMs ? "over" : (pct >= 80 ? "near" : "ok") };
  }
  // A fixed-fee project: the fee, its time (all time, exact) and the
  // hourly rate that makes: fee / hours. null without a fee.
  function effRate(data, pid, now) {
    var p = project(data, pid);
    if (!p || !p.fee) return null;
    var ms = 0;
    data.entries.forEach(function (x) { if (!x.del && x.p === pid) ms += endOf(x, now) - x.s; });
    return { fee: p.fee, ms: ms, rate: ms >= 60000 ? Math.round(p.fee * HOUR / ms) : 0 };
  }
  // The fixed fee already added as an extra charge (fee: 1), or null.
  function feeExtra(data, pid) {
    var hit = null;
    (data.extras || []).forEach(function (x) { if (!x.del && x.fee === 1 && x.p === pid && (!hit || x.d > hit.d)) hit = x; });
    return hit;
  }
  // Mileage: km (one decimal) × cents per km, rounded; NaN when out of range.
  function kmAmount(km, kmr) {
    if (!(typeof km === "number" && km >= LIM.km[0] && km <= LIM.km[1]) || !inRange(kmr, LIM.kmr)) return NaN;
    var a = Math.round(Math.round(km * 10) * kmr / 10);
    return inRange(a, LIM.amt) ? a : NaN;
  }
  // 12.5 → "12,5" (el, de…) or "12.5" (en).
  function fmtKm(km, lang) {
    var v = String(Math.round(km * 10) / 10);
    return comma(lang) ? v.replace(".", ",") : v;
  }
  // "12,5" / "12.5" / "120" → 12.5 (one decimal) or NaN.
  function parseKm(text) {
    var v = String(text || "").trim().replace(",", ".");
    if (!/^\d{1,6}(\.\d)?$/.test(v)) return NaN;
    var n = Math.round(parseFloat(v) * 10) / 10;
    return n >= LIM.km[0] && n <= LIM.km[1] ? n : NaN;
  }
  // What Budget gets for an extra charge (BR-B1 prefill, BR-TS-BUD):
  // an expense on its day with its description and client, travel when
  // it is mileage. → { k, a, d, n, c?, src }
  function budgetPrefill(data, x) {
    var c = client(data, extraClient(data, x));
    var n = cleanText([x.desc, c ? c.name : ""].filter(Boolean).join(" · "), 500);
    var out = { k: "o", a: x.amt, d: x.d, n: n };
    if (x.km) out.c = "o-trans";
    out.src = "timesheet";
    if (c && c.crm) out.crm = c.crm;
    return out;
  }

  // T5: the entries of a report (range and filter, ended ones) as an
  // iCalendar file: one event each, UTC times, the same UID every
  // time (the entry id), so a calendar app updates instead of doubling.
  function icsText(v) {
    return String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function icsFold(line) {
    var out = [], cur = "", n = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], b = unescape(encodeURIComponent(ch)).length;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function icsStamp(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function toIcs(data, fromKey, toKey, f, now, lang) {
    f = f || {};
    var w = words(lang), lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Timesheet//EN", "CALSCALE:GREGORIAN"];
    var a = dayStart(fromKey), b = dayStart(addDays(toKey, 1));
    data.entries.filter(function (x) {
      return !x.del && x.e !== 0 && x.s >= a && x.s < b && matches(data, x, f);
    }).sort(function (x, y) { return x.s - y.s || cmpStr(x.id, y.id); }).forEach(function (x) {
      var p = project(data, x.p), c = p ? projectClient(data, p) : null;
      var sum = [p ? p.name : "", x.desc].filter(Boolean).join(" · ") || w.noProject;
      var det = [c ? c.name : "", x.task || "", (x.tags || []).join(", ")].filter(Boolean).join("\n");
      lines.push("BEGIN:VEVENT", "UID:" + x.id + "@timesheet.useoros.online", "DTSTAMP:" + icsStamp(now),
                 "DTSTART:" + icsStamp(x.s), "DTEND:" + icsStamp(x.e), icsFold("SUMMARY:" + icsText(sum)));
      if (det) lines.push(icsFold("DESCRIPTION:" + icsText(det)));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  // ---------- 6. Export ----------
  // A text cell that Excel / LibreOffice would read as a formula gets
  // a leading apostrophe (CSV injection), then RFC 4180 quoting.
  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[\x22;\r\n]/.test(s) ? '"' + s.replace(/\x22/g, '""') + '"' : s;
  }
  // One row per piece (as in the report), `;` separated with a BOM so
  // spreadsheet apps read Greek right; decimals follow the language.
  function exportHead(lang) {
    var w = words(lang);
    return ["date", "start", "end", "duration", "hours", "client", "project", "desc", "task", "tags", "billable", "rate", "amount", "billed"]
      .map(function (k) { return w["exp." + k]; });
  }
  // A CSV date: YYYY-MM-DD (en), DD/MM/YYYY (el), else the language's
  // numeric date (de: DD.MM.YYYY).
  function csvDate(k, lang) {
    if (lang === "en" || !lang) return k;
    var d = keyDate(k);
    if (lang !== "el") {
      try { return new Intl.DateTimeFormat(locale(lang), { day: "2-digit", month: "2-digit", year: "numeric" }).format(d); } catch (e) {}
    }
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  // The report's pieces in the range and filter, oldest first.
  function exportPieces(data, fromKey, toKey, f, now) {
    return chargedPieces(data, fromKey, toKey, f || {}, now).pcs;
  }
  // The rows of the CSV and the sheet, oldest first: one per piece
  // (amount with overtime), then a "Minimum charge" row per top-up
  // (on its period's last day of work) and one per extra charge (no
  // times, no hours). → [{ k, s, e, ms, c, p, desc, task, tags, bill, rate, amount, billed }]
  function exportRows(data, fromKey, toKey, f, now, lang) {
    f = f || {};
    var w = words(lang), plan = chargedPieces(data, fromKey, toKey, f, now), out = [];
    var names = function (pid, cid) {
      var p = project(data, pid), c = p ? projectClient(data, p) : client(data, cid);
      return { p: p ? p.name : "", c: c ? c.name : "" };
    };
    plan.pcs.forEach(function (pc) {
      var x = pc.x, n = names(x.p, "");
      out.push({ k: pc.k, s: pc.s, e: pc.e, ms: pc.ms, c: n.c, p: n.p, desc: x.desc || "", task: x.task || "",
                 tags: (x.tags || []).join(", "), bill: pc.bill, rate: pc.rate, amount: pc.amount,
                 billed: x.billed, ot: pc.otMs });
    });
    plan.tops.forEach(function (tp) {
      var x = tp.pc.x, n = names(x.p, "");
      out.push({ k: tp.pc.k, s: 0, e: 0, ms: tp.ms, c: n.c, p: n.p, desc: w["exp.minimum"], task: "", tags: "",
                 bill: true, rate: tp.rate, amount: tp.amount, billed: x.billed, ot: 0, top: true, ex: !tp.ms });
    });
    extrasIn(data, fromKey, toKey, f).forEach(function (x) {
      var n = names(extraProject(data, x), extraClient(data, x));
      out.push({ k: x.d, s: 0, e: 0, ms: 0, c: n.c, p: n.p, desc: w["exp.extra"] + (x.desc ? ": " + x.desc : ""),
                 task: "", tags: "", bill: true, rate: 0, amount: x.amt, billed: x.billed, ot: 0, ex: true });
    });
    return out.sort(function (a, b) {
      return cmpStr(a.k, b.k) || (a.top ? 1 : a.ex ? 2 : 0) - (b.top ? 1 : b.ex ? 2 : 0) || a.s - b.s;
    });
  }
  function endText(r) { return r.e === dayStart(addDays(r.k, 1)) ? "24:00" : hhmm(r.e); }
  function toCsv(data, fromKey, toKey, f, now, lang) {
    var cm = comma(lang), w = words(lang);
    var dec = function (n, d) { var s = n.toFixed(d); return cm ? s.replace(".", ",") : s; };
    var yes = w["exp.yes"], no = w["exp.no"];
    var lines = [exportHead(lang).map(csvCell).join(";")];
    exportRows(data, fromKey, toKey, f, now, lang).forEach(function (r) {
      var timed = !r.ex && !r.top;
      lines.push([
        csvDate(r.k, lang), timed ? hhmm(r.s) : "", timed ? endText(r) : "",
        r.ex ? "" : fmtDur(r.ms), r.ex ? "" : dec(r.ms / HOUR, 2),
        r.c, r.p, r.desc, r.task, r.tags,
        r.bill ? yes : no, r.ex ? "" : dec(r.rate / 100, 2), dec(r.amount / 100, 2),
        r.billed ? yes : no
      ].map(csvCell).join(";"));
    });
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  }
  // The same rows as the CSV for "Open in Spreadsheet" (BR-S1): real
  // numbers for hours, rate and amount, dates as YYYY-MM-DD.
  // → [heading, ...rows]
  function toTable(data, fromKey, toKey, f, now, lang) {
    var w = words(lang);
    var yes = w["exp.yes"], no = w["exp.no"];
    return [exportHead(lang)].concat(exportRows(data, fromKey, toKey, f, now, lang).map(function (r) {
      var timed = !r.ex && !r.top;
      return [
        r.k, timed ? hhmm(r.s) : "", timed ? endText(r) : "",
        r.ex ? "" : fmtDur(r.ms), r.ex ? "" : Math.round(r.ms / HOUR * 100) / 100,
        r.c, r.p, r.desc, r.task, r.tags,
        r.bill ? yes : no, r.ex ? "" : r.rate / 100, r.amount / 100,
        r.billed ? yes : no
      ];
    }));
  }

  // Quote lines for "Create quote" (BR-Q1): one line per project of
  // the BILLABLE time in the range and filter (rounded as in reports),
  // hours as the quantity, the hourly rate as the unit price; then an
  // "Overtime" line per project with overtime at its own rate, a
  // "Minimum charge" line per client and rate, and one line per extra
  // charge (quantity 1). The client is named when every line belongs
  // to the same one.
  // → { items: [{ d, q, p }], client, ids, exIds } (the entries and extra charges counted).
  function quoteLines(data, fromKey, toKey, f, now, lang) {
    f = f || {};
    var ff = { client: f.client, project: f.project, bill: "bill", billed: f.billed, tag: f.tag, group: "project" };
    var plan = chargedPieces(data, fromKey, toKey, ff, now);
    var w = words(lang), range = fmtRange(fromKey, toKey, lang);
    var clients = {}, items = [], by = {}, ids = {};
    var nameOf = function (pid) { var p = project(data, pid); return p ? p.name : w.noProject; };
    var noteClient = function (cid) { var c = client(data, cid); clients[c ? c.id : ""] = c ? c.name : ""; };
    plan.pcs.forEach(function (pc) {
      if (!pc.bill) return;
      var pid = project(data, pc.x.p) ? pc.x.p : "";
      var r = by[pid] || (by[pid] = { pid: pid, ms: 0, ot: 0, otRate: 0 });
      r.ms += pc.ms - pc.otMs;
      r.ot += pc.otMs;
      if (pc.otMs) r.otRate = pc.otRate;
      ids[pc.x.id] = true;
    });
    var hrs = function (ms) { return Math.round(ms / HOUR * 100) / 100; };
    Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      return (b.ms + b.ot) - (a.ms + a.ot) || cmpStr(a.pid, b.pid);
    }).forEach(function (r) {
      var p = project(data, r.pid);
      noteClient(p ? p.client : "");
      var rate = chargeRate(data, r.pid), b = billingOf(data, p);
      // a day-rate project without an hourly rate: the minimum line says it all
      if (!(p && p.fee) && (rate || !(b && b.src.minAmt))) items.push({ d: nameOf(r.pid) + " · " + range, q: hrs(r.ms), p: rate / 100 });
      if (r.ot) items.push({ d: nameOf(r.pid) + " · " + w["exp.overtime"] + " · " + range, q: hrs(r.ot), p: r.otRate / 100 });
    });
    // Top-ups: hours at a rate (per owner and rate), or an amount per
    // period (per owner and amount, the quantity = periods).
    var tops = {}, topOrder = [];
    plan.tops.forEach(function (tp) {
      var k = tp.key + TASK_SEP + (tp.ms ? "h" + tp.rate : "a" + tp.amount);
      if (!tops[k]) { tops[k] = { tp: tp, ms: 0, n: 0 }; topOrder.push(k); }
      tops[k].ms += tp.ms;
      tops[k].n++;
    });
    topOrder.forEach(function (k) {
      var t = tops[k], tp = t.tp, c = client(data, tp.cid), p = project(data, tp.pid);
      noteClient(p ? p.client : tp.cid);
      var who = p ? p.name : (c ? c.name : "");
      var d = w["exp.minimum"] + (who ? " · " + who : "") + " · " + range;
      items.push(tp.ms ? { d: d, q: hrs(t.ms), p: tp.rate / 100 } : { d: d, q: t.n, p: tp.amount / 100 });
    });
    var exIds = [];
    extrasIn(data, fromKey, toKey, ff).forEach(function (x) {
      noteClient(extraClient(data, x));
      items.push({ d: (x.desc || w["exp.extra"]) + " · " + fmtRange(x.d, x.d, lang), q: 1, p: x.amt / 100 });
      exIds.push(x.id);
    });
    items = items.filter(function (it) { return it.q > 0; }).slice(0, 50);
    var ck = Object.keys(clients);
    return { items: items, client: ck.length === 1 ? clients[ck[0]] : "", ids: Object.keys(ids).sort(cmpStr),
             exIds: exIds.sort(cmpStr) };
  }
  // The period on a quote line: "05/10 – 11/10/2026" (el) or
  // "5 Oct – 11 Oct 2026" (en); the year once when both ends share it.
  function fmtRange(fromKey, toKey, lang) {
    var a = keyDate(fromKey), b = keyDate(toKey);
    var dm = function (d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); };
    if (lang !== "el" && lang && lang !== "en") {
      var fmt = null;
      try { fmt = new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short" }); } catch (e) {}
      if (fmt) dm = function (d) { return fmt.format(d); };
    } else if (lang !== "el") {
      dm = function (d) { return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]; };
    }
    var sep = lang === "el" ? "/" : " ";
    if (fromKey === toKey) return dm(a) + sep + a.getFullYear();
    var y = a.getFullYear() === b.getFullYear() ? "" : sep + a.getFullYear();
    return dm(a) + y + " – " + dm(b) + sep + b.getFullYear();
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

  // ---------- 7. Import: Toggl, Clockify, Harvest CSV (Wave 5) ----------
  // RFC 4180 reader: quotes, "" escapes, CRLF/LF, a BOM; the delimiter
  // (, ; or tab) is picked from the header line.
  function readCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/, 1)[0] || "";
    var cnt = function (ch) { return first.split(ch).length - 1; };
    var dl = ",";
    if (cnt(";") > cnt(dl)) dl = ";";
    if (cnt("\t") > cnt(dl)) dl = "\t";
    var rows = [], row = [], cell = "", q = false, i = 0, n = text.length;
    for (; i < n; i++) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === dl) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  // A 52-bit FNV-1a style hash in base 36: the same row always gets
  // the same id, so importing a file twice adds nothing new.
  function hashId(prefix, str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return prefix + h1.toString(36) + h2.toString(36);
  }

  var IMPORT_MAX_ROWS = 20000;
  var IMPORT_FIELDS = {
    project: ["project"], client: ["client"],
    desc: ["description", "notes", "note"], task: ["task"], tags: ["tags", "tag"],
    bill: ["billable", "billable?"], billed: ["invoiced?", "invoiced"],
    sd: ["start date"], st: ["start time"], ed: ["end date"], et: ["end time"],
    date: ["date", "spent date"], hours: ["hours", "duration (decimal)"],
    rate: ["billable rate"]
  };
  function headerMap(head) {
    var low = head.map(function (h) { return cleanText(h, 80).toLowerCase(); });
    var m = {};
    Object.keys(IMPORT_FIELDS).forEach(function (k) {
      IMPORT_FIELDS[k].forEach(function (name) {
        if (m[k] !== undefined) return;
        for (var i = 0; i < low.length; i++) {
          // "Billable Rate (EUR)" matches "billable rate"
          if (low[i] === name || (k === "rate" && low[i].indexOf(name) === 0)) { m[k] = i; return; }
        }
      });
    });
    return m;
  }
  function importSource(m, head) {
    var low = head.join("|").toLowerCase();
    if (m.sd !== undefined && m.st !== undefined) {
      return /duration \(decimal\)|duration \(h\)/.test(low) ? "clockify" : "toggl";
    }
    if (m.date !== undefined && m.hours !== undefined) return "harvest";
    return "";
  }
  // Dates: ISO (2026-10-05, 2026/10/05) or a/b/yyyy, a.b.yyyy, a-b-yyyy.
  // The order of a/b is "dmy" or "mdy", decided once for the file.
  var DMY_RE = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/;
  function dateParts(v, order) {
    v = String(v || "").trim();
    var p = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(v);
    if (p) return [+p[1], +p[2], +p[3]];
    p = DMY_RE.exec(v);
    if (!p) return null;
    return order === "mdy" ? [+p[3], +p[1], +p[2]] : [+p[3], +p[2], +p[1]];
  }
  // "dmy" | "mdy" when the file decides it, "" when every a/b date
  // could be both (the user picks; `fallback` is the default).
  function dateOrder(values) {
    var dmy = false, mdy = false;
    values.forEach(function (v) {
      var p = DMY_RE.exec(String(v || "").trim());
      if (!p) return;
      if (+p[1] > 12) dmy = true;
      if (+p[2] > 12) mdy = true;
    });
    if (dmy && !mdy) return "dmy";
    if (mdy && !dmy) return "mdy";
    return "";
  }
  function timeParts(v) {
    var p = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(String(v || "").trim());
    if (!p) return null;
    var h = +p[1], mi = +p[2], se = p[3] ? +p[3] : 0;
    if (p[4]) {
      var pm = /^p/i.test(p[4]);
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (pm ? 12 : 0);
    }
    if (h > 23 || mi > 59 || se > 59) return null;
    return [h, mi, se];
  }
  function localTs(d, tm) {
    if (!d || !tm) return NaN;
    var x = new Date(d[0], d[1] - 1, d[2], tm[0], tm[1], tm[2]);
    if (x.getFullYear() !== d[0] || x.getMonth() !== d[1] - 1 || x.getDate() !== d[2]) return NaN;
    return x.getTime();
  }
  function yesNo(v) {
    v = String(v || "").trim().toLowerCase();
    if (/^(yes|true|1|y|ναι)$/.test(v)) return 1;
    if (/^(no|false|0|n|όχι|οχι)$/.test(v)) return 0;
    return -1;
  }
  function decimal(v) {
    v = String(v || "").trim().replace(/[^\d.,\-]/g, "");
    if (!v) return NaN;
    if (v.indexOf(",") >= 0 && v.indexOf(".") >= 0) {
      v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
    } else v = v.replace(",", ".");
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }

  // Reads an export into a plan; nothing is changed. Returns null when
  // the file is not one of the three formats, else
  //   { source, order, ambiguous, rows, bad, add: {entries, projects,
  //     clients} (an "incoming" model for mergeTimesheet), fresh, dup,
  //     from, to }.
  // Ids are hashes of the row, so a second import of the same file
  // finds every entry already there; m = 1, so an entry the user
  // deleted (a newer tombstone) stays deleted. Names match existing
  // clients/projects case-insensitively; new ones get hashed ids too.
  // Harvest has hours, not times: a day's rows are laid one after the
  // other from 09:00.
  function importPlan(text, data, order) {
    var rows = readCsv(text);
    if (rows.length < 2) return null;
    var head = rows[0], m = headerMap(head), src = importSource(m, head);
    if (!src) return null;
    rows = rows.slice(1, IMPORT_MAX_ROWS + 1);
    var col = function (r, k) { return m[k] === undefined ? "" : (r[m[k]] || ""); };

    var dates = [];
    rows.forEach(function (r) {
      if (src === "harvest") dates.push(col(r, "date"));
      else { dates.push(col(r, "sd")); dates.push(col(r, "ed")); }
    });
    var found = dateOrder(dates), ambiguous = !found && dates.some(function (v) { return DMY_RE.test(String(v).trim()); });
    var ord = found || (order === "mdy" ? "mdy" : "dmy");

    var clientsByName = {}, projectsByKey = {};
    live(data.clients).forEach(function (c) { clientsByName[c.name.toLowerCase()] = c; });
    live(data.projects).forEach(function (p) {
      var c = client(data, p.client);
      projectsByKey[(c ? c.name.toLowerCase() : "") + "\u0001" + p.name.toLowerCase()] = p;
    });
    var have = {};
    data.entries.forEach(function (x) { have[x.id] = x; });

    var add = { entries: [], projects: [], clients: [] }, seen = {};
    var newClients = {}, newProjects = {}, color = live(data.projects).length;
    var bad = 0, dup = 0, fresh = 0, from = "", to = "", dayCursor = {};

    function clientId(name) {
      if (!name) return "";
      var k = name.toLowerCase();
      if (clientsByName[k]) return clientsByName[k].id;
      if (!newClients[k]) {
        newClients[k] = { id: hashId("impc", k), name: name, rate: 0, m: 1 };
        add.clients.push(newClients[k]);
      }
      return newClients[k].id;
    }
    function projectId(name, cname, bill, rate) {
      if (!name) return "";
      var k = (cname ? cname.toLowerCase() : "") + "\u0001" + name.toLowerCase();
      if (projectsByKey[k]) return projectsByKey[k].id;
      var p = newProjects[k];
      if (!p) {
        p = newProjects[k] = { id: hashId("impp", k), name: name, client: clientId(cname),
                               color: color++ % COLORS.length, rate: 0, bill: 0, arch: 0, m: 1, _any: false };
        add.projects.push(p);
      }
      if (bill !== 0) p._any = true;                 // billable or unknown → billable
      if (!p.rate && rate > 0) p.rate = rate;
      return p.id;
    }

    rows.forEach(function (r) {
      var s, e;
      var hkey = "";
      if (src === "harvest") {
        var d = dateParts(col(r, "date"), ord), h = decimal(col(r, "hours"));
        if (!d || !(h > 0) || h > 24) { bad++; return; }
        var dk = d[0] + "-" + pad(d[1]) + "-" + pad(d[2]);
        hkey = dk + "\u0001" + h;
        var base = localTs(d, [9, 0, 0]);
        if (!isFinite(base)) { bad++; return; }
        s = base + (dayCursor[dk] || 0);
        e = s + Math.round(h * HOUR);
        dayCursor[dk] = (dayCursor[dk] || 0) + (e - s);
      } else {
        var sd = dateParts(col(r, "sd"), ord), ed = dateParts(col(r, "ed") || col(r, "sd"), ord);
        s = localTs(sd, timeParts(col(r, "st")));
        e = localTs(ed, timeParts(col(r, "et")));
        if (isFinite(s) && isFinite(e) && e <= s && !col(r, "ed")) e += DAY;
      }
      if (!isFinite(s) || !isFinite(e) || e <= s || e - s > MAX_SPAN || s < MIN_TS || s > MAX_TS) { bad++; return; }
      var cname = cleanText(col(r, "client"), LIM.name), pname = cleanText(col(r, "project"), LIM.name);
      var task = cleanText(col(r, "task"), LIM.task), note = cleanText(col(r, "desc"), LIM.desc);
      var tags = parseTags(col(r, "tags"));
      // The id key keeps the text as Wave 5 joined it, so files imported
      // before tasks existed still match.
      var desc = [cleanText(col(r, "task"), LIM.desc), note].filter(Boolean).join(" · ").slice(0, LIM.desc);
      var rate = Math.round(decimal(col(r, "rate")) * 100);
      var pid = projectId(pname, cname, yesNo(col(r, "bill")), inRange(rate, LIM.rate) ? rate : 0);
      // Harvest rows have no times: their id comes from the day, hours
      // and text (+ how many such rows came before), not from where
      // they were laid, so a longer export of the same days still
      // matches. Toggl/Clockify rows are identified by their times.
      var key = [src, hkey || (s + "\u0001" + e), cname.toLowerCase(), pname.toLowerCase(), desc].join("\u0001");
      if (hkey) { seen[key] = (seen[key] || 0) + 1; key += "\u0001" + seen[key]; }
      else if (seen[key]) return;                    // the same row twice in one file
      else seen[key] = 1;
      var id = hashId("imp", key);
      var k1 = dayKeyOf(s), k2 = dayKeyOf(e - 1);
      if (!from || k1 < from) from = k1;
      if (!to || k2 > to) to = k2;
      if (have[id]) { dup++; return; }
      fresh++;
      var x = { id: id, p: pid, desc: note, s: s, e: e, billed: yesNo(col(r, "billed")) === 1 ? 1 : 0, m: 1 };
      if (task) x.task = task;
      if (tags.length) x.tags = tags;
      add.entries.push(x);
    });
    // Only projects that kept at least one new entry are created.
    var used = {};
    add.entries.forEach(function (x) { used[x.p] = true; });
    add.projects = add.projects.filter(function (p) { return used[p.id]; }).map(function (p) {
      var out = { id: p.id, name: p.name, client: p.client, color: p.color, rate: p.rate, bill: p._any ? 1 : 0, arch: 0, m: 1 };
      return out;
    });
    var usedC = {};
    add.projects.forEach(function (p) { usedC[p.client] = true; });
    add.clients = add.clients.filter(function (c) { return usedC[c.id]; });
    return {
      source: src, order: ord, ambiguous: ambiguous, rows: rows.length, bad: bad,
      fresh: fresh, dup: dup, from: from, to: to,
      add: { ver: DATA_VER, clients: add.clients, projects: add.projects, entries: add.entries, prefs: data.prefs, pm: 0 }
    };
  }

  // ---------- ActivityWatch (T5) ----------
  // An ActivityWatch export (Settings › Export all buckets as JSON):
  // { buckets: { "aw-watcher-afk_<host>": { events }, "aw-watcher-window_<host>": { events } } }.
  // The time at the computer (afk "not-afk" events, gaps under
  // AW_GAP merged) becomes suggested entries of AW_MIN or more, each
  // named after the window it spent the most time in ("App · title").
  // No project: the person sorts them out after the preview. The ids
  // come from the block's start and end, so the same export twice adds
  // nothing, and a deleted suggestion stays deleted (m = 1, Wave 5).
  // → the shape of importPlan, source "activitywatch", or null.
  var AW_GAP = 5 * 60000, AW_MIN = 15 * 60000, AW_MAX_EVENTS = 200000;
  function awEvents(b) {
    var out = [];
    (b && Array.isArray(b.events) ? b.events : []).slice(0, AW_MAX_EVENTS).forEach(function (ev) {
      var s = ev ? Date.parse(ev.timestamp) : NaN, d = ev ? +ev.duration : NaN;
      if (!isFinite(s) || !(d > 0)) return;
      out.push({ s: s, e: s + Math.round(d * 1000), data: ev.data && typeof ev.data === "object" ? ev.data : {} });
    });
    return out.sort(function (x, y) { return x.s - y.s; });
  }
  function awPlan(obj, data) {
    var bk = obj && typeof obj === "object" && obj.buckets && typeof obj.buckets === "object" ? obj.buckets : null;
    if (!bk) return null;
    var afk = [], win = [];
    Object.keys(bk).forEach(function (k) {
      var b = bk[k] || {}, type = String(b.type || "");
      if (type === "afkstatus" || /^aw-watcher-afk/.test(k)) afk = afk.concat(awEvents(b));
      else if (type === "currentwindow" || /^aw-watcher-window/.test(k)) win = win.concat(awEvents(b));
    });
    if (!afk.length && !win.length) return null;
    afk.sort(function (x, y) { return x.s - y.s; });
    win.sort(function (x, y) { return x.s - y.s; });
    var src = afk.length ? afk.filter(function (x) { return x.data.status === "not-afk"; }) : win;
    var blocks = [];
    src.forEach(function (x) {
      var last = blocks[blocks.length - 1];
      if (last && x.s - last.e <= AW_GAP && dayKeyOf(x.s) === dayKeyOf(last.s)) last.e = Math.max(last.e, x.e);
      else blocks.push({ s: x.s, e: x.e });
    });
    var have = {};
    data.entries.forEach(function (x) { have[x.id] = 1; });
    var add = [], dup = 0, fresh = 0, bad = 0, from = "", to = "", wi = 0;
    blocks.forEach(function (bl) {
      if (bl.e - bl.s < AW_MIN) return;
      if (bl.e - bl.s > MAX_SPAN || bl.s < MIN_TS || bl.s > MAX_TS) { bad++; return; }
      var by = {};
      while (wi < win.length && win[wi].e <= bl.s) wi++;
      for (var j = wi; j < win.length && win[j].s < bl.e; j++) {
        var w = win[j], ms = Math.min(w.e, bl.e) - Math.max(w.s, bl.s);
        if (ms <= 0) continue;
        var app = cleanText(w.data.app, 40), title = cleanText(w.data.title, 120);
        var k = app + "\u0001" + title;
        by[k] = (by[k] || 0) + ms;
      }
      var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a] || cmpStr(a, b); })[0] || "";
      var desc = top ? top.split("\u0001").filter(Boolean).join(" · ") : "";
      var id = hashId("aw", bl.s + "\u0001" + bl.e);
      var k1 = dayKeyOf(bl.s), k2 = dayKeyOf(bl.e - 1);
      if (!from || k1 < from) from = k1;
      if (!to || k2 > to) to = k2;
      if (have[id]) { dup++; return; }
      fresh++;
      add.push({ id: id, p: "", desc: cleanText(desc, LIM.desc), s: bl.s, e: bl.e, billed: 0, m: 1 });
    });
    return { source: "activitywatch", order: "dmy", ambiguous: false, rows: blocks.length, bad: bad,
             fresh: fresh, dup: dup, from: from, to: to,
             add: { ver: DATA_VER, clients: [], projects: [], entries: add, prefs: data.prefs, pm: 0 } };
  }

  // ---------- Time away (Wave 46, idle detection) ----------
  // The shell watches for time away while a timer runs (the Idle
  // Detection API in Chromium after the user allows it, and on every
  // browser a gap in its 1-second clock, i.e. the device slept) and
  // keeps each period in the device-local key IDLE_KEY (never synced):
  //   [{ id: running entry id, from, to }]   (ms, at most IDLE_MAX)
  // The user then keeps the time or takes it out (Timesheet's banner or
  // the shell's timer menu); only the app writes the synced data.
  // Prefs (device-local IDLE_PREFS_KEY): { on: 0|1, min: 5…240 }.
  var IDLE_KEY = "oros-timesheet-idle", IDLE_PREFS_KEY = "oros-timesheet-idleprefs";
  var IDLE_MAX = 20, IDLE_MIN_DEF = 10, IDLE_MIN = [5, 240];
  function idlePrefs(raw) {
    var p = null;
    try { p = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { p = null; }
    p = p && typeof p === "object" ? p : {};
    return { on: p.on === 1 || p.on === true ? 1 : 0, min: inRange(p.min, IDLE_MIN) ? p.min : IDLE_MIN_DEF };
  }
  function idleRead(raw) {
    var a = null;
    try { a = typeof raw === "string" && raw.length <= 8192 ? JSON.parse(raw) : (Array.isArray(raw) ? raw : null); } catch (e) { a = null; }
    if (!Array.isArray(a)) return [];
    var out = [];
    a.forEach(function (x) {
      if (!x || typeof x !== "object" || !ID_RE.test(String(x.id || "")) || !isInt(x.from) || !isInt(x.to)) return;
      if (x.from < MIN_TS || x.to > MAX_TS || x.to <= x.from || x.to - x.from > MAX_SPAN) return;
      out.push({ id: x.id, from: x.from, to: x.to });
    });
    return out.sort(function (x, y) { return x.from - y.from || cmpStr(x.id, y.id); }).slice(-IDLE_MAX);
  }
  // A period away while `run` (a running entry { id, s }) ran, or null
  // when it is shorter than minMs. It never starts before the entry.
  function idleRecord(run, from, to, minMs) {
    if (!run || !ID_RE.test(String(run.id || "")) || !isInt(from) || !isInt(to)) return null;
    from = Math.max(from, isInt(run.s) ? run.s : from);
    if (to - from < Math.max(60000, minMs || 0)) return null;
    return { id: run.id, from: from, to: to };
  }
  // Add a period; one that touches or overlaps another of the same
  // entry joins it.
  function idlePut(list, rec) {
    var out = [], cur = { id: rec.id, from: rec.from, to: rec.to };
    (list || []).forEach(function (x) {
      if (x.id === cur.id && x.from <= cur.to + 1000 && cur.from <= x.to + 1000) {
        cur.from = Math.min(cur.from, x.from);
        cur.to = Math.max(cur.to, x.to);
      } else out.push(x);
    });
    out.push(cur);
    return idleRead(out);
  }
  function idleDrop(list, rec) {
    return (list || []).filter(function (x) { return !(x.id === rec.id && x.from === rec.from && x.to === rec.to); });
  }
  // The periods that still apply: their entry exists and covers them.
  function idlePending(data, list) {
    return (list || []).filter(function (r) {
      var x = byId(data.entries, r.id);
      return !!x && !x.del && x.s <= r.from && (x.e === 0 || x.e >= r.to);
    });
  }
  // What a choice does to the data → a model for mergeTimesheet (only
  // the touched entries), or null when nothing changes:
  //   "keep"    nothing;
  //   "discard" the entry ends where the time away began and a copy of
  //             it (project, description, task, tags) starts where it
  //             ended: still running if it was, else ending as it did;
  //   "stop"    a running entry ends where the time away began.
  function idleApply(data, rec, mode, now, idFn) {
    if (mode !== "discard" && mode !== "stop") return null;
    var x = byId(data.entries, rec.id);
    if (!x || x.del || x.s > rec.from || (x.e !== 0 && x.e < rec.to)) return null;
    if (mode === "stop" && x.e !== 0) return null;
    var m = Math.max(now, x.m + 1);
    var a = JSON.parse(JSON.stringify(x));
    var oldE = x.e;
    a.e = Math.max(rec.from, a.s + 1000);
    a.m = m;
    var out = [a];
    if (mode === "discard" && (oldE === 0 || oldE > rec.to)) {
      var b = { id: idFn(), p: x.p, desc: x.desc, s: rec.to, e: oldE, billed: x.billed ? 1 : 0, m: m };
      if (x.task) b.task = x.task;
      if (x.tags && x.tags.length) b.tags = x.tags.slice();
      out.push(b);
    }
    return { ver: DATA_VER, clients: [], projects: [], entries: out, prefs: data.prefs, pm: 0 };
  }

  var API = {
    IDLE_KEY: IDLE_KEY, IDLE_PREFS_KEY: IDLE_PREFS_KEY, IDLE_MIN: IDLE_MIN, idlePrefs: idlePrefs, idleRead: idleRead,
    idleRecord: idleRecord, idlePut: idlePut, idleDrop: idleDrop, idlePending: idlePending, idleApply: idleApply,
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, FORGOT_MS: FORGOT_MS, DATA_VER: DATA_VER, HOUR: HOUR, DAY: DAY,
    normTags: normTags, parseTags: parseTags, parseHours: parseHours,
    INBOX_KEY: INBOX_KEY, POMO_TASK: POMO_TASK, inboxRead: inboxRead, inboxPut: inboxPut,
    inboxEnd: inboxEnd, inboxDrain: inboxDrain, pomoId: pomoId, hasTag: hasTag, budgetUse: budgetUse,
    taskList: taskList, tagList: tagList, splitTaskKey: splitTaskKey,
    LIM: LIM, ROUNDS: ROUNDS, CURRENCIES: CURRENCIES, DEFAULT_PREFS: DEFAULT_PREFS, COLORS: COLORS,
    ID_RE: ID_RE, MAX_SPAN: MAX_SPAN,
    isInt: isInt, inRange: inRange, cleanText: cleanText, newId: newId,
    dayKey: dayKey, dayKeyOf: dayKeyOf, keyDate: keyDate, addDays: addDays, validDay: validDay,
    dayStart: dayStart, weekStart: weekStart, monthStart: monthStart, monthEnd: monthEnd,
    normClient: normClient, normProject: normProject, normEntry: normEntry, normExtra: normExtra, normPrefs: normPrefs,
    MIN_PERS: MIN_PERS, hasBilling: hasBilling, billingPart: function (x) { return normBilling({}, x || {}); }, billingOf: billingOf, chargedPieces: chargedPieces, extrasIn: extrasIn, extraProject: extraProject,
    extraClient: extraClient, exportRows: exportRows,
    mergeTimesheet: mergeTimesheet, normalize: normalize, empty: empty, parse: parse,
    live: live, project: project, client: client, projectClient: projectClient,
    rateOf: rateOf, billable: billable, running: running, endOf: endOf,
    pieces: pieces, roundMs: roundMs, piecesIn: piecesIn, dayTotals: dayTotals,
    dayEntries: dayEntries, dayFeed: dayFeed, overlaps: overlaps, matches: matches, weekGrid: weekGrid, report: report,
    parseDuration: parseDuration, parseMoney: parseMoney, fmtDur: fmtDur, fmtHours: fmtHours,
    fmtMoney: fmtMoney, moneyInput: moneyInput, hhmm: hhmm,
    csvCell: csvCell, toCsv: toCsv, toTable: toTable, quoteLines: quoteLines, fmtRange: fmtRange, toBackup: toBackup, fromBackup: fromBackup,
    readCsv: readCsv, importPlan: importPlan,
    PEND_KEY: PEND_KEY, normPend: normPend, pendAdd: pendAdd, invLink: invLink, unbilled: unbilled, linkId: linkId,
    srcKey: srcKey, timeBySrc: timeBySrc, calSuggest: calSuggest,
    pkgUse: pkgUse, effRate: effRate, feeExtra: feeExtra, kmAmount: kmAmount, parseKm: parseKm, fmtKm: fmtKm,
    budgetPrefill: budgetPrefill, endText: endText, toIcs: toIcs, awPlan: awPlan
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.orosTimesheetCore = API;
})(typeof window !== "undefined" ? window : globalThis);
