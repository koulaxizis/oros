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
    color: [0, 7],
    task: 80, tag: 30, tags: 10,     // per entry (Wave 6)
    budget: [0, 6000000]             // minutes per project (100.000 h), 0 = no budget
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

  // Forward compatibility (as in Budget): a flat field this version
  // does not know rides along on its record, sorted by name, so a
  // newer version can add fields without this one stripping them
  // (stripping would make two versions re-upload forever).
  var EXTRA_RE = /^[a-z][a-z0-9]{0,15}$/, EXTRA_MAX = 16;
  var KNOWN = {
    client:  ["id", "name", "rate", "m", "del"],
    project: ["id", "name", "client", "color", "rate", "bill", "arch", "budget", "m", "del"],
    entry:   ["id", "p", "desc", "s", "e", "billed", "task", "tags", "m", "del"]
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
    return withExtras({ id: x.id, name: name, rate: inRange(x.rate, LIM.rate) ? x.rate : 0, m: x.m },
                      x, KNOWN.client);
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
    out.m = x.m;
    return withExtras(out, x, KNOWN.project);
  }
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
    out.m = x.m;
    return withExtras(out, x, KNOWN.entry);
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

  // Report over a day range. f = { client, project, bill: "all"|"bill"|"non",
  // group: "project"|"client"|"day"|"task"|"tag", billed: "all"|"open"|"done",
  // tag: ""|"-" (untagged)|a tag }.
  // Rounding works per piece (an entry, or each day of one that
  // crosses midnight), so the three groupings always add up alike.
  function report(data, fromKey, toKey, f, now) {
    f = f || {};
    var prefs = data.prefs, groups = {}, tot = { ms: 0, billMs: 0, amount: 0, n: 0 }, ids = {};
    piecesIn(data, fromKey, toKey, now).forEach(function (pc) {
      var x = pc.x;
      if (!matches(data, x, f)) return;
      var isBill = billable(data, x.p);
      var ms = roundMs(pc.e - pc.s, prefs.round, prefs.rup);
      var rate = isBill ? rateOf(data, x.p) : 0;
      var amount = isBill ? Math.round(ms * rate / HOUR) : 0;
      groupKeys(data, x, pc.k, f).forEach(function (kl) {
        var gk = kl[0];
        var g = groups[gk] || (groups[gk] = { key: gk, label: kl[1], ms: 0, billMs: 0, amount: 0, n: 0 });
        g.ms += ms;
        if (isBill) g.billMs += ms;
        g.amount += amount;
        g.n++;
      });
      tot.ms += ms;
      if (isBill) tot.billMs += ms;
      tot.amount += amount;
      tot.n++;
      ids[x.id] = true;
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; });
    if (f.group === "day") rows.sort(function (x, y) { return cmpStr(x.key, y.key); });
    else rows.sort(function (x, y) { return y.ms - x.ms || cmpStr(x.key, y.key); });
    return { rows: rows, total: tot, ids: Object.keys(ids).sort(cmpStr) };
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
    m = /^(?:(\d{1,3}(?:\.\d{1,2})?) ?(?:h|hr|hrs|ω|ώ|ωρ[α-ωάέήίόύώ]*|ώρ[α-ωάέήίόύώ]*))? ?(?:(\d{1,4}) ?(m|min|mins|λ|λεπ[α-ωάέήίόύώ]*|')?)?$/.exec(s);
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
      ? ["Ημερομηνία", "Έναρξη", "Λήξη", "Διάρκεια", "Ώρες", "Πελάτης", "Έργο", "Περιγραφή", "Εργασία", "Ετικέτες", "Χρεώσιμο", "Χρέωση/ώρα", "Ποσό", "Τιμολογήθηκε"]
      : ["Date", "Start", "End", "Duration", "Hours", "Client", "Project", "Description", "Task", "Tags", "Billable", "Rate", "Amount", "Billed"];
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
        c ? c.name : "", p ? p.name : "", x.desc, x.task || "", (x.tags || []).join(", "),
        b ? yes : no, dec(rate / 100, 2), dec(b ? Math.round(ms * rate / HOUR) / 100 : 0, 2),
        x.billed ? yes : no
      ].map(csvCell).join(";"));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // Quote lines for "Create quote" (BR-Q1): one line per project of
  // the BILLABLE time in the range and filter (rounded as in reports),
  // hours as the quantity, the hourly rate as the unit price. The
  // client is named when every line belongs to the same one.
  // → { items: [{ d, q, p }], client, ids } (ids = the entries counted).
  function quoteLines(data, fromKey, toKey, f, now, lang) {
    f = f || {};
    var rep = report(data, fromKey, toKey,
      { client: f.client, project: f.project, bill: "bill", billed: f.billed, tag: f.tag, group: "project" }, now);
    var range = fmtRange(fromKey, toKey, lang);
    var clients = {}, items = [];
    rep.rows.forEach(function (r) {
      if (!r.billMs) return;
      var p = project(data, r.key), c = projectClient(data, p);
      clients[c ? c.id : ""] = c ? c.name : "";
      var name = p ? p.name : (lang === "el" ? "Χωρίς έργο" : "No project");
      items.push({
        d: name + " · " + range,
        q: Math.round(r.billMs / HOUR * 100) / 100,
        p: rateOf(data, r.key) / 100
      });
    });
    items = items.filter(function (it) { return it.q > 0; }).slice(0, 50);
    var ck = Object.keys(clients);
    return { items: items, client: ck.length === 1 ? clients[ck[0]] : "", ids: rep.ids };
  }
  // The period on a quote line: "05/10 – 11/10/2026" (el) or
  // "5 Oct – 11 Oct 2026" (en); the year once when both ends share it.
  function fmtRange(fromKey, toKey, lang) {
    var a = keyDate(fromKey), b = keyDate(toKey);
    var dm = function (d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); };
    if (lang !== "el") {
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

  var API = {
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
    normClient: normClient, normProject: normProject, normEntry: normEntry, normPrefs: normPrefs,
    mergeTimesheet: mergeTimesheet, normalize: normalize, empty: empty, parse: parse,
    live: live, project: project, client: client, projectClient: projectClient,
    rateOf: rateOf, billable: billable, running: running, endOf: endOf,
    pieces: pieces, roundMs: roundMs, piecesIn: piecesIn, dayTotals: dayTotals,
    dayEntries: dayEntries, dayFeed: dayFeed, overlaps: overlaps, matches: matches, weekGrid: weekGrid, report: report,
    parseDuration: parseDuration, parseMoney: parseMoney, fmtDur: fmtDur, fmtHours: fmtHours,
    fmtMoney: fmtMoney, moneyInput: moneyInput, hhmm: hhmm,
    csvCell: csvCell, toCsv: toCsv, quoteLines: quoteLines, fmtRange: fmtRange, toBackup: toBackup, fromBackup: fromBackup,
    readCsv: readCsv, importPlan: importPlan
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.orosTimesheetCore = API;
})(typeof window !== "undefined" ? window : globalThis);
