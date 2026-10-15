// ============================================================
// orOS Habits — import.js ("Import from another app", v1.0.0)
// Reads a file the user exported from another habit tracker and turns
// it into Habits rows. Pure: no DOM, no storage; habits.js runs the
// picker, the preview dialog, the one write and the Undo.
//
// Sources (detected from zip entry names, JSON keys, CSV headers):
//   loop      Loop Habit Tracker, Settings › Export as CSV (a ZIP):
//             Habits.csv (name, frequency, colour, unit, target,
//             archived) + "001 Name/Checkmarks.csv" (Date,Value) per
//             habit and / or the wide root Checkmarks.csv (Date,
//             <habit>…). Values: 2 done, 3 skipped, 1 auto (Loop's
//             "not needed today", not a check-in), 0 / -1 nothing;
//             numeric habits ×1000. Habits.csv alone → habits only.
//   habitica  Habitica data export (JSON user object: tasks.habits /
//             tasks.dailys with history) or habitica-tasks-history.csv
//             (Task Name, Task ID, Task Type, Date, Value). A daily's
//             history row is written at the next day's cron, so it
//             counts for the day before; a habit's row on its own day.
//   streaks   Streaks (iOS) CSV: title + entry date + entry type.
//   habitify  Habitify CSV: habit name + date + status / value.
//   generic   any CSV with a date column and a habit name column
//             (+ optional status / value), or wide: Date, habitA, habitB…
//
// parse({ name, bytes }) → Promise<result | null>; parseText(text,
// name) → result | null (CSV / JSON, synchronous). Result:
//   { source, habits: [{ key, name, color?, days?, per?, num?,
//                        archived?, checks: { ymd: { d | s | v } } }],
//     checks: total }   d: done · s: skipped · v: a measurable value
// apply(data, result, opts) → { data, added, updated, comps, undo }
//   merges into a COPY of the Habits data (v2 shape, core.js):
//     habit id "imp-" + hash(source|key): re-importing the same file
//       adds what is missing, never a second copy; a living row is
//       kept as the user left it; a deleted one comes back.
//     comp "<id>|<ymd>": a day that already has a row (tick, value,
//       skip, note, or an un-tick) is the user's and is kept; only new
//       days are added (and the emptied days of a habit that comes
//       back). Values go in the device share "import".
// undo(data, undoInfo, now) → data: every touched row back to what it
//   was (a new habit or day becomes a tombstone, so a sync that
//   already uploaded the import cannot bring it back).
// UMD: window.OrosHabitsImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function model() { return NODE ? require("./model.js") : root.OrosHabitsModel; }

  var MAX_HABITS = 300;              // habits read from one file
  var MAX_CHECKS = 200000;           // check-ins read from one file
  var MAX_ENTRY = 40 * 1024 * 1024;  // inflated bytes per zip entry
  var MAX_ZIP_CSV = 400;             // per-habit files read from a zip
  var NAME_LEN = 200, UNIT_LEN = 16;
  var DEV = "import";                // value share of imported amounts
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // ---------- small helpers ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function addDays(ymd, n) {
    var m = YMD_RE.exec(ymd);
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  // a day key, or "" (YYYYMMDD as Streaks writes it, then importkit)
  function dayOf(v, hint) {
    var s = kit().clean(v, 80), m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) s = m[1] + "-" + m[2] + "-" + m[3];
    var y = kit().ymd(s, hint);
    if (!y || y < "1970-01-01" || y > addDays(todayYmd(), 1)) return "";
    return y;
  }
  function cleanName(v) { return kit().clean(v, NAME_LEN); }
  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function round2(v) { return Math.round(v * 100) / 100; }

  // A collector: habits in file order, check-ins capped.
  function Out(source) {
    this.source = source;
    this.list = [];
    this.byKey = {};
    this.total = 0;
  }
  Out.prototype.habit = function (key, name) {
    key = low(key || name);
    if (!key || !name) return null;
    if (this.byKey[key]) return this.byKey[key];
    if (this.list.length >= MAX_HABITS) return null;
    var h = { key: key, name: name, checks: {} };
    this.byKey[key] = h;
    this.list.push(h);
    return h;
  };
  // kind: "d" done · "s" skipped · "v" value (summed per day)
  Out.prototype.check = function (h, ymd, kind, val) {
    if (!h || !ymd) return;
    var c = h.checks[ymd];
    if (!c) {
      if (this.total >= MAX_CHECKS) return;
      c = h.checks[ymd] = {};
      this.total++;
    }
    if (kind === "v") {
      if (typeof val === "number" && isFinite(val) && val > 0) c.v = round2((c.v || 0) + val);
      if (c.v === undefined && Object.keys(c).length === 0) { delete h.checks[ymd]; this.total--; }
    } else if (kind === "d") { c.d = true; delete c.s; }
    else if (kind === "s" && !c.d) c.s = true;
  };
  Out.prototype.done = function () {
    var self = this;
    // a habit with no check-ins and no schedule info is still a habit
    // (Loop's Habits.csv alone) — keep it
    return self.list.length ? { source: self.source, habits: self.list, checks: self.total } : null;
  };

  // Status text / number → "d", "s" or "" (nothing)
  var DONE_RE = /^(y|yes|true|done|ok|x|✓|✔|☑|v|check(ed)?|complete(d)?|completed?_?(manually|auto|automatically)?|success(ful)?|achieved|finished|ναι|έγινε)$/i;
  var SKIP_RE = /^(s|skip(ped)?|skipped_?(manually|auto)?|frozen|freeze|pause(d)?|paused_?\w*|rest|vacation|off|excused|παράλειψη)$/i;
  function statusOf(v) {
    var s = kit().clean(v, 60);
    if (!s) return "";
    if (DONE_RE.test(s)) return "d";
    if (SKIP_RE.test(s)) return "s";
    var n = kit().num(s);
    if (/^[+\-]?[\d.,]+$/.test(s) && !isNaN(n)) return n > 0 ? "d" : "";
    if (/skip|pause|frozen|freeze|vacation/i.test(s)) return "s";
    if (/complet|done|success/i.test(s) && !/incomplet|not|partial|uncomplet|fail|miss/i.test(s)) return "d";
    return "";
  }

  // ---------- frequency / colour ----------
  // Loop: X times in Y days → every day, X per week or X per month
  function loopFreq(h, num, den) {
    num = Math.round(num); den = Math.round(den);
    if (!(num >= 1 && den >= 1)) return;
    if (num >= den) { h.days = [0, 1, 2, 3, 4, 5, 6]; return; }
    if (den >= 28) { h.per = ["m", Math.max(1, Math.min(31, Math.round(num * 30 / den)))]; return; }
    var w = Math.max(1, Math.min(7, Math.round(num * 7 / den)));
    if (w >= 7) h.days = [0, 1, 2, 3, 4, 5, 6]; else h.per = ["w", w];
  }
  function hexColor(v) {
    var s = kit().clean(v, 20);
    if (/^#?[0-9a-f]{6}$/i.test(s)) return "#" + s.replace("#", "").toLowerCase();
    if (/^-?\d+$/.test(s)) {                       // Android ARGB int
      var n = (+s) >>> 0;
      return "#" + ("00000" + (n & 0xffffff).toString(16)).slice(-6);
    }
    return "";
  }
  function nearest(hex, palette) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "";
    var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16), best = "", bd = Infinity;
    palette.forEach(function (p) {
      var q = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(p);
      if (!q) return;
      var d = Math.pow(r - parseInt(q[1], 16), 2) + Math.pow(g - parseInt(q[2], 16), 2) + Math.pow(b - parseInt(q[3], 16), 2);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }
  function median(list) {
    var a = list.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  }

  // ---------- Loop Habit Tracker ----------
  var FREQ_NUM = ["FrequencyNumerator", "Frequency Numerator", "NumRepetitions", "Repetitions"];
  var FREQ_DEN = ["FrequencyDenominator", "Frequency Denominator", "Interval"];
  var LOOP_HABITS = [{ id: "loop", need: ["Name", FREQ_NUM] }];
  function loopHabitRows(out, text) {
    var K = kit(), r = K.records(text);
    r.rows.forEach(function (rec, i) {
      var name = cleanName(K.get(rec, ["Name", "Habit"]));
      if (!name) return;
      var h = out.habit(name, name);
      if (!h) return;
      var pos = K.num(K.get(rec, ["Position", "Pos"]));
      h._pos = isNaN(pos) ? i + 1 : pos;
      loopFreq(h, K.num(K.get(rec, FREQ_NUM)), K.num(K.get(rec, FREQ_DEN)));
      var col = hexColor(K.get(rec, ["Color", "Colour"]));
      if (col) h.color = col;
      // Type: YES_NO / NUMERICAL (or 0 / 1); older files have none,
      // then a unit (or the values themselves, below) says "amount"
      var type = low(K.get(rec, ["Type", "Habit Type"]));
      var unit = K.clean(K.get(rec, ["Unit"]), UNIT_LEN);
      var tv = K.num(K.get(rec, ["Target Value", "TargetValue", "Target"]));
      var tt = low(K.get(rec, ["Target Type", "TargetType"]));
      h._t = { u: unit, t: tv > 0 ? round2(tv) : 1, c: (tt === "at_most" || tt === "1" || tt === "atmost") ? "le" : "ge" };
      h._kind = /^(numerical|numeric|number|1)$/.test(type) ? "num" : (/^(yes_no|boolean|0)$/.test(type) ? "bool" : (unit ? "num" : ""));
      var arch = low(K.get(rec, ["Archived?", "Archived"]));
      if (arch === "true" || arch === "1" || arch === "yes") h.archived = true;
    });
  }
  // raw values are kept first: an older file without a Type column
  // shows an amount habit only by its values (×1000)
  function loopRaw(h, ymd, raw) {
    var v = kit().num(raw);
    if (!ymd || isNaN(v)) return;
    (h._raw = h._raw || []).push([ymd, v]);
  }
  function loopFinish(out) {
    out.list.forEach(function (h) {
      var raw = h._raw || [];
      var kind = h._kind || (raw.some(function (x) { return x[1] > 3 || x[1] !== Math.round(x[1]); }) ? "num" : "bool");
      if (kind === "num") h.num = h._t || { u: "", t: 1, c: "ge" };
      raw.forEach(function (x) {
        if (h.num) { if (x[1] > 0) out.check(h, x[0], "v", x[1] / 1000); }
        else if (x[1] === 2) out.check(h, x[0], "d");
        else if (x[1] === 3) out.check(h, x[0], "s");
      });
      delete h._raw; delete h._kind; delete h._t; delete h._pos; delete h._file;
    });
    return out.done();
  }
  function loopChecks(h, text) {
    var K = kit(), t = K.csv(text);
    var di = K.col(t.head, ["Date", "Day"]);
    var vi = K.col(t.head, ["Value", "Checkmark", "Check"]);
    if (di === -1) di = 0;
    if (vi === -1) vi = di === 0 ? 1 : 0;
    t.rows.forEach(function (row) { loopRaw(h, dayOf(row[di]), row[vi]); });
  }
  function loopWide(out, text, mustExist) {
    var K = kit(), t = K.csv(text), di = K.col(t.head, ["Date", "Day"]);
    if (di === -1) di = 0;
    var cols = [];
    t.head.forEach(function (name, j) {
      if (j === di) return;
      name = cleanName(name);
      if (!name) return;
      var h = out.byKey[low(name)];
      if (!h && !mustExist) h = out.habit(name, name);
      if (h && !h._file) cols.push({ j: j, h: h });    // a per-habit file wins
    });
    t.rows.forEach(function (row) {
      var ymd = dayOf(row[di]);
      if (!ymd) return;
      cols.forEach(function (c) { loopRaw(c.h, ymd, row[c.j]); });
    });
  }
  function parseLoopZip(z) {
    var out = new Out("loop");
    var hPath = "", rootCk = "", per = [];
    z.names.forEach(function (n) {
      var parts = n.split("/"), base = parts[parts.length - 1].toLowerCase();
      if (base === "habits.csv" && (!hPath || parts.length < hPath.split("/").length)) hPath = n;
      else if (base === "checkmarks.csv") {
        var parent = parts.length > 1 ? parts[parts.length - 2] : "";
        if (/^\d+\s+\S/.test(parent)) per.push({ path: n, folder: parent });
        else if (!rootCk || parts.length < rootCk.split("/").length) rootCk = n;
      }
    });
    var chain = Promise.resolve();
    if (hPath) chain = chain.then(function () { return z.text(hPath, MAX_ENTRY); }).then(function (txt) { if (txt) loopHabitRows(out, txt); });
    chain = chain.then(function () {
      var steps = Promise.resolve();
      per.slice(0, MAX_ZIP_CSV).forEach(function (p) {
        steps = steps.then(function () {
          // "001 Name": the name first (Loop may shorten it), then the
          // position (Habits.csv counts from 1, older files from 0)
          var m = /^(\d+)\s+(.*)$/.exec(p.folder), pos = +m[1], nm = cleanName(m[2]);
          var h = out.byKey[low(nm)] || null;
          out.list.forEach(function (x) { if (!h && x._pos === pos) h = x; });
          if (!h && !hPath) h = out.habit(nm, nm);
          if (!h || h._file) return;
          return z.text(p.path, MAX_ENTRY).then(function (txt) { if (txt) { h._file = true; loopChecks(h, txt); } });
        });
      });
      return steps;
    });
    chain = chain.then(function () {
      if (rootCk) return z.text(rootCk, MAX_ENTRY).then(function (txt) { if (txt) loopWide(out, txt, !!hPath); });
    });
    return chain.then(function () { return loopFinish(out); });
  }

  // ---------- Habitica ----------
  var HB_DAYS = [["m", "monday"], ["t", "tuesday"], ["w", "wednesday"], ["th", "thursday"],
                 ["f", "friday"], ["s", "saturday"], ["su", "sunday"]];
  function habiticaTasks(obj) {
    if (!obj || typeof obj !== "object") return null;
    var src = obj.tasks || (obj.user && obj.user.tasks) || (obj.data && (obj.data.tasks || obj.data)) || obj;
    var res = { habits: [], dailys: [] };
    if (Array.isArray(src)) {
      src.forEach(function (x) {
        if (x && x.type === "habit") res.habits.push(x);
        else if (x && x.type === "daily") res.dailys.push(x);
      });
    } else if (src && typeof src === "object") {
      if (Array.isArray(src.habits)) res.habits = src.habits;
      if (Array.isArray(src.dailys)) res.dailys = src.dailys;
    }
    return res.habits.length || res.dailys.length ? res : null;
  }
  function habiticaSchedule(h, t) {
    var f = low(t.frequency), every = Math.max(1, Math.round(+t.everyX || 1));
    if (f === "weekly" || (!f && t.repeat)) {
      var rep = t.repeat || {}, days = [];
      HB_DAYS.forEach(function (d, i) { if (rep[d[0]] === true || rep[d[1]] === true) days.push(i); });
      if (days.length && every === 1) h.days = days;
      else if (days.length) h.per = ["w", Math.max(1, Math.round(days.length / every)) || 1];
    } else if (f === "daily" || !f) {
      if (every === 1) h.days = [0, 1, 2, 3, 4, 5, 6];
      else if (every <= 7) h.per = ["w", Math.max(1, Math.round(7 / every))];
      else h.per = ["m", Math.max(1, Math.round(30 / every))];
    } else if (f === "monthly") {
      h.per = ["m", 1];
    }
    // yearly and anything else: any day (flexible)
  }
  // a history row → done or not; prev = the previous row's value
  function hbDone(e, prev, isHabit) {
    if (isHabit) {
      if (typeof e.scoredUp === "number") return e.scoredUp > 0;
      if (typeof e.scoredDown === "number" && e.scoredUp === undefined) return false;
    } else if (typeof e.completed === "boolean") return e.completed;
    if (typeof e.value !== "number") return false;
    return prev === null ? e.value > 0 : e.value > prev;
  }
  function parseHabiticaJson(obj) {
    var tasks = habiticaTasks(obj);
    if (!tasks) return null;
    var out = new Out("habitica");
    function add(t, isHabit) {
      if (!t || typeof t !== "object") return;
      if (isHabit && t.up === false && t.down === true) return;   // a "bad" habit only
      var name = cleanName(t.text);
      var h = out.habit(t.id || t._id || name, name);
      if (!h) return;
      if (!isHabit) habiticaSchedule(h, t);
      var hist = Array.isArray(t.history) ? t.history.slice(0, MAX_CHECKS) : [];
      hist.sort(function (a, b) { return (+(a && a.date) || 0) - (+(b && b.date) || 0); });
      var prev = null;
      hist.forEach(function (e) {
        if (!e || typeof e !== "object") return;
        var ymd = dayOf(typeof e.date === "number" ? e.date : String(e.date || ""));
        if (ymd && !isHabit) ymd = addDays(ymd, -1);      // written at the next cron
        if (ymd && hbDone(e, prev, isHabit)) out.check(h, ymd, "d");
        if (typeof e.value === "number") prev = e.value;
      });
    }
    tasks.dailys.forEach(function (t) { add(t, false); });
    tasks.habits.forEach(function (t) { add(t, true); });
    return out.done();
  }
  function parseHabiticaCsv(text) {
    var K = kit(), r = K.records(text), out = new Out("habitica"), by = {};
    r.rows.forEach(function (rec) {
      var type = low(K.get(rec, ["Task Type", "Type"]));
      if (type !== "habit" && type !== "daily") return;
      var name = cleanName(K.get(rec, ["Task Name", "Name"]));
      var id = K.clean(K.get(rec, ["Task ID", "ID"]), 80) || name;
      var at = K.parseDate(K.get(rec, ["Date"]));
      if (!name || isNaN(at)) return;
      var k = id + "\u0000" + type;
      (by[k] = by[k] || { id: id, name: name, type: type, rows: [] }).rows.push({ at: at, value: K.num(K.get(rec, ["Value"])) });
    });
    Object.keys(by).forEach(function (k) {
      var t = by[k], h = out.habit(t.id, t.name), prev = null;
      if (!h) return;
      t.rows.sort(function (a, b) { return a.at - b.at; });
      t.rows.slice(0, MAX_CHECKS).forEach(function (e) {
        var ymd = dayOf(e.at);
        if (ymd && t.type === "daily") ymd = addDays(ymd, -1);
        if (ymd && !isNaN(e.value) && (prev === null ? e.value > 0 : e.value > prev)) out.check(h, ymd, "d");
        if (!isNaN(e.value)) prev = e.value;
      });
    });
    return out.done();
  }

  // ---------- long CSV (Streaks, Habitify, generic) ----------
  var NAME_COLS = ["Habit Name", "Habit", "Task Name", "Task", "Title", "Name", "Activity", "Item", "Goal", "Συνήθεια"];
  var DATE_COLS = ["Date", "Day", "Entry Date", "entry_date", "Completed Date", "Completion Date", "Completed At",
                   "Timestamp", "entry_timestamp", "Datetime", "Date Time", "Time", "Created At", "Ημερομηνία"];
  var STATUS_COLS = ["Status", "entry_type", "Entry Type", "State", "Result", "Done", "Completed", "Check", "Log Type"];
  var VALUE_COLS = ["Value", "Quantity", "Amount", "Count", "Progress", "Log Value", "Ποσότητα", "Τιμή"];
  var UNIT_COLS = ["Unit", "Unit Type", "Units", "Goal Unit", "Μονάδα"];
  function parseLong(text, source, hint) {
    var K = kit(), t = K.csv(text);
    var ni = K.col(t.head, NAME_COLS), di = K.col(t.head, DATE_COLS);
    if (ni === -1 || di === -1 || ni === di) return null;
    var si = K.col(t.head, STATUS_COLS), vi = K.col(t.head, VALUE_COLS), ui = K.col(t.head, UNIT_COLS);
    if (si === ni || si === di) si = -1;
    if (vi === ni || vi === di || vi === si) vi = -1;
    var out = new Out(source), vals = {}, units = {};
    t.rows.forEach(function (row) {
      var name = cleanName(row[ni]), ymd = dayOf(row[di], hint);
      if (!name || !ymd) return;
      var h = out.habit(name, name);
      if (!h) return;
      var st = si !== -1 ? statusOf(row[si]) : "";
      var v = vi !== -1 ? K.num(row[vi]) : NaN;
      if (si !== -1 && /miss|fail|no|false|^0$/i.test(K.clean(row[si], 40)) && !st) return;
      if (st === "s") { out.check(h, ymd, "s"); return; }
      if (!isNaN(v) && v > 0) (vals[h.key] = vals[h.key] || []).push({ ymd: ymd, v: v });
      if (ui !== -1 && row[ui]) units[h.key] = K.clean(row[ui], UNIT_LEN);
      if (st === "d" || (si === -1 && (vi === -1 || isNaN(v) || v > 0))) out.check(h, ymd, "d");
    });
    numericFrom(out, vals, units);
    return out.done();
  }
  // a habit whose values are not all 0 / 1 becomes an amount habit
  // (target: the usual day's value), its days the values
  function numericFrom(out, vals, units) {
    out.list.forEach(function (h) {
      var list = vals[h.key];
      if (!list || !list.length) return;
      var nonBin = list.some(function (x) { return x.v !== 1; });
      if (!nonBin) return;
      var perDay = {};
      list.forEach(function (x) { perDay[x.ymd] = round2((perDay[x.ymd] || 0) + x.v); });
      h.num = { u: units[h.key] || "", t: round2(median(Object.keys(perDay).map(function (k) { return perDay[k]; }))) || 1, c: "ge" };
      Object.keys(h.checks).forEach(function (k) {
        var c = h.checks[k];
        if (c.d) { delete c.d; if (!perDay[k] && !c.s) { delete h.checks[k]; out.total--; } }
      });
      Object.keys(perDay).forEach(function (k) {
        if (!h.checks[k]) { if (out.total >= MAX_CHECKS) return; h.checks[k] = {}; out.total++; }
        h.checks[k].v = perDay[k];
        delete h.checks[k].s;
      });
    });
  }
  // wide CSV: Date, habitA, habitB… (a bare Loop Checkmarks.csv too)
  function parseWide(text, hint) {
    var K = kit(), t = K.csv(text), di = K.col(t.head, DATE_COLS);
    if (di === -1 || t.head.length < 2) return null;
    // Loop's encoding: only -1 / 0 / 1 / 2 / 3, with a 2 or a -1
    var loopish = t.rows.length > 0, seen2 = false;
    t.rows.slice(0, 2000).forEach(function (row) {
      row.forEach(function (c, j) {
        if (j === di || c === "") return;
        if (!/^-?[0-3]$/.test(String(c).trim())) loopish = false;
        else if (c.trim() === "2" || c.trim() === "-1") seen2 = true;
      });
    });
    if (loopish && seen2) {
      var lo = new Out("loop");
      loopWide(lo, text, false);
      return loopFinish(lo);
    }
    var out = new Out("generic"), cols = [], vals = {};
    t.head.forEach(function (name, j) {
      if (j === di) return;
      name = cleanName(name);
      var h = name && out.habit(name, name);
      if (h) cols.push({ j: j, h: h });
    });
    t.rows.forEach(function (row) {
      var ymd = dayOf(row[di], hint);
      if (!ymd) return;
      cols.forEach(function (c) {
        var cell = K.clean(row[c.j], 60);
        if (!cell) return;
        var st = statusOf(cell), v = /^[+\-]?[\d.,]+$/.test(cell) ? K.num(cell) : NaN;
        if (st === "s") out.check(c.h, ymd, "s");
        else if (!isNaN(v) && v > 0) { (vals[c.h.key] = vals[c.h.key] || []).push({ ymd: ymd, v: v }); out.check(c.h, ymd, "d"); }
        else if (st === "d") out.check(c.h, ymd, "d");
      });
    });
    numericFrom(out, vals, {});
    out.list = out.list.filter(function (h) { return Object.keys(h.checks).length; });
    return out.done();
  }

  // ---------- detection ----------
  // dd/mm vs mm/dd: decided once per file from the dates themselves
  function dateHint(t, di) {
    var dmy = 0, mdy = 0;
    t.rows.slice(0, 3000).forEach(function (row) {
      var m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(kit().clean(row[di], 40));
      if (!m) return;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    });
    return mdy > dmy ? "mdy" : "dmy";
  }
  function parseCsv(text, name) {
    var K = kit(), t = K.csv(text, { maxRows: 5 }), head = t.head, fname = low(name);
    if (!head.length) return null;
    if (K.detect(head, LOOP_HABITS) === "loop") {
      var out = new Out("loop");
      loopHabitRows(out, text);
      return loopFinish(out);
    }
    if (K.col(head, ["Task Type"]) !== -1 && K.col(head, ["Task Name"]) !== -1 && K.col(head, ["Date"]) !== -1) return parseHabiticaCsv(text);
    var full = K.csv(text), di = K.col(head, DATE_COLS), hint = di === -1 ? "" : dateHint(full, di);
    var source = "generic";
    if (K.col(head, ["entry_type", "entry_date", "task_id"]) !== -1 || /streaks/.test(fname)) source = "streaks";
    else if (/habitify/.test(fname) || (K.col(head, ["Habit Name"]) !== -1 && K.col(head, ["Status"]) !== -1)) source = "habitify";
    var res = parseLong(text, source, hint);
    if (res) return res;
    if (/^checkmarks/.test(fname)) {
      var lo = new Out("loop");
      loopWide(lo, text, false);
      return loopFinish(lo);
    }
    return parseWide(text, hint);
  }
  function parseText(text, name) {
    var s = String(text == null ? "" : text).replace(/^﻿/, "");
    var lead = s.replace(/^\s+/, "").charAt(0);
    if (lead === "{" || lead === "[") {
      var obj = kit().json(s);
      return obj ? parseHabiticaJson(obj) : null;
    }
    return parseCsv(s, name);
  }
  // input: { name, bytes: Uint8Array } (importkit.readFile) or a string
  function parse(input) {
    var K = kit();
    try {
      if (typeof input === "string") return Promise.resolve(parseText(input, ""));
      var bytes = input && input.bytes, name = String((input && input.name) || "");
      if (!bytes) return Promise.resolve(null);
      if (!K.isZip(bytes)) return Promise.resolve(parseText(K.text(bytes), name));
      var z = K.unzip(bytes);
      var lowNames = z.names.map(function (n) { return n.toLowerCase(); });
      var isLoop = lowNames.some(function (n) { return /(^|\/)(habits|checkmarks)\.csv$/.test(n); });
      if (isLoop) return parseLoopZip(z);
      // another zip: the first JSON or CSV inside that reads as habits
      var cands = z.names.filter(function (n) { return /\.(json|csv)$/i.test(n) && !/(^|\/)(__macosx|\.)/i.test(n); }).slice(0, 20);
      var res = null, chain = Promise.resolve();
      cands.forEach(function (n) {
        chain = chain.then(function () {
          if (res) return;
          return z.text(n, MAX_ENTRY).then(function (txt) { res = txt ? parseText(txt, n.split("/").pop()) : null; });
        });
      });
      return chain.then(function () { return res; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ---------- merge into the Habits data ----------
  function idOf(source, key) { return "imp-" + kit().hash(source + "|" + key); }
  function compHas(c) {
    return !!c && (!c.del || !!(c.v && Object.keys(c.v).length) || !!(c.sk && c.sk[0] === 1) || !!(c.nt && c.nt[0]));
  }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function stamp(old, now) { return Math.max(now, (old || 0) + 1); }

  // opts: { keys: [habit keys to import] (all when absent), now }
  function apply(data, res, opts) {
    var M = model();
    opts = opts || {};
    var now = opts.now || Date.now();
    var want = opts.keys ? {} : null;
    if (opts.keys) opts.keys.forEach(function (k) { want[k] = true; });
    var d = copy(data || { ver: M.DATA_VER, habits: [], comps: [] });
    var hById = {}, cById = {};
    d.habits.forEach(function (h, i) { hById[h.id] = i; });
    d.comps.forEach(function (c, i) { cById[c.id] = i; });
    var undo = { habits: {}, comps: {}, at: now }, added = 0, updated = 0, comps = 0, n = 0;
    (res && res.habits || []).forEach(function (src) {
      if (want && !want[src.key]) return;
      var id = idOf(res.source, src.key), at = hById[id], cur = at === undefined ? null : d.habits[at];
      var back = !!(cur && cur.del);                       // a deleted import comes back whole
      if (!cur || cur.del) {
        var row = M.normHabit({
          id: id, name: src.name, icon: "check",
          color: nearest(src.color, M.COLORS) || M.COLORS[n % M.COLORS.length],
          days: src.days || [], per: src.per, num: src.num,
          mtime: stamp(cur && cur.mtime, now), del: false
        });
        if (!row) return;
        undo.habits[id] = cur ? copy(cur) : null;
        if (cur) { d.habits[at] = row; updated++; }
        else { hById[id] = d.habits.length; d.habits.push(row); added++; }
        cur = row;
      } else updated++;
      n++;
      var num = !!(cur.num && cur.num.t > 0);
      Object.keys(src.checks).sort().forEach(function (ymd) {
        var ch = src.checks[ymd], cid = id + "|" + ymd, ci = cById[cid], old = ci === undefined ? null : d.comps[ci];
        // the user's day wins: anything on it, or (habit kept alive)
        // even an un-tick; a deleted habit's emptied days refill
        if (old && (compHas(old) || !back)) return;
        var c = { id: cid, habitId: id, date: ymd, mtime: stamp(old && old.mtime, now), del: true };
        if (num && ch.v > 0) c.v = { import: [round2(ch.v), stamp(old && old.v && old.v[DEV] && old.v[DEV][1], now)] };
        else if (!num && (ch.d || ch.v > 0)) c.del = false;
        if (ch.s && c.del && !c.v) c.sk = [1, stamp(old && old.sk && old.sk[1], now)];
        if (c.del && !c.v && !c.sk) return;
        if (old && old.nt) c.nt = old.nt;
        var nc = M.normComp(c);
        if (!nc) return;
        undo.comps[cid] = old ? copy(old) : null;
        if (old) d.comps[ci] = nc; else { cById[cid] = d.comps.length; d.comps.push(nc); }
        comps++;
      });
    });
    return { data: d, added: added, updated: updated, comps: comps, undo: undo };
  }

  // Every row the import touched goes back to what it was; restored
  // rows get a fresh stamp so they also win over a synced copy of the
  // import. A new habit becomes a tombstone and a new day an empty
  // tombstone (tick and skip off; the canonical form prunes it after
  // 30 days), so a sync that already uploaded the import cannot bring
  // either back. An imported amount share is dropped here; a synced
  // copy of it can only return under a deleted habit, where nothing
  // shows it.
  function undo(data, info, now) {
    var d = copy(data);
    now = now || Date.now();
    var hIdx = {};
    d.habits.forEach(function (h, i) { hIdx[h.id] = i; });
    Object.keys(info.habits).forEach(function (id) {
      var before = info.habits[id], i = hIdx[id];
      if (i === undefined) { if (before) { hIdx[id] = d.habits.length; d.habits.push(copy(before)); } return; }
      var cur = d.habits[i];
      if (before) { d.habits[i] = copy(before); d.habits[i].mtime = stamp(cur.mtime, now); }
      else { cur.del = true; cur.mtime = stamp(cur.mtime, now); }
    });
    d.comps = d.comps.map(function (c) {
      if (!Object.prototype.hasOwnProperty.call(info.comps, c.id)) return c;
      var before = info.comps[c.id];
      if (before) { var b = copy(before); b.mtime = stamp(c.mtime, now); return b; }
      var t = { id: c.id, habitId: c.habitId, date: c.date, mtime: stamp(c.mtime, now), del: true };
      if (c.sk) t.sk = [0, stamp(c.sk[1], now)];
      return t;
    });
    return d;
  }

  var API = {
    parse: parse, parseText: parseText, apply: apply, undo: undo, idOf: idOf,
    MAX_HABITS: MAX_HABITS, MAX_CHECKS: MAX_CHECKS,
    ACCEPT: ".zip,.csv,.json,.txt,application/zip,text/csv,application/json"
  };
  if (NODE) module.exports = API;
  else root.OrosHabitsImport = API;
})(typeof window !== "undefined" ? window : this);
