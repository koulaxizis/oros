// ============================================================
// orOS Habits — core.js (shared rules, v2.0.0)
// One copy of "is this habit due on this day, and was it done", read
// by every page that needs it:
//   - the Habits app (habits/index.html loads it before habits.js)
//   - the Calendar's Habits feed (calendar/index.html)
//   - the Today summary (habits/today.js, through apps.json "today")
//   - the shell (index.html): the per-habit reminder engine and the
//     phone bridge (phone.js reminderRows)
//   - the tests (tests/today-wave3.test.js, tests/habits-core.test.js)
// Pure functions, no DOM, no storage, no language. Read-only.
//
// Data (synced slice "habits", key oros-habits-data), v2:
//   { ver, habits: [habit], comps: [comp], set: { st, sg, m } | absent }
//   habit = { id, name, icon, color, days: [0..6], mtime, del,
//             num?: { u: unit, t: target > 0, c: "ge" | "le", s: step > 0 },
//             per?: ["w" | "m", n],      X times per week / month
//             rem?: minute 0..1439 }     daily reminder time
//     no num = yes / no habit. per set → days is [] and ignored.
//     days [] and no per = flexible ("any day").
//   comp  = { id: "<habitId>|<ymd>", habitId, date, mtime, del,
//             v?:  { <device>: [number, m] },   measurable: the day's
//                  value is the SUM of the devices' shares (concurrent
//                  +1 on two devices both count)
//             sk?: [0 | 1, m],                  skipped / frozen day
//             nt?: [text, m] }                  short note
//     mtime / del is the yes / no tick (del = not ticked), as in v1.
//
// API (window.OrosHabitsCore):
//   schedIdx(ymd)               weekday 0..6, MONDAY = 0
//   isScheduledOn(habit, ymd)   fixed weekdays only (flexible and
//                               X-per-period habits: false)
//   isDone(data, habitId, ymd)  yes / no: ticked; measurable: the
//                               day's value meets the target
//   living(data), dueOn(data, ymd)
//   index(data)                 lookups built once; every function
//                               that takes `data` also takes an index
//   perOf, isNum, isFlexible, valueOn, isSkipped, noteOn, progress,
//   periodStart, periodEnd, periodCount, periodMet,
//   streaks(data, habit, today) → { cur, best, unit: "d" | "w" | "m" }
//   scoreSeries(data, habit, today) → [{ d, s }]  (s 0..1, Loop-style)
//   score(data, habit, today) → 0..100
//   needsReminder(data, habit, ymd), dueReminders(data, nowMs), remKey
// ============================================================
(function (root) {
  "use strict";
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var REM_WINDOW = 4 * 3600000;          // a reminder stays due for 4 hours (Health rule)

  // ---------- day keys (UTC maths on the key: DST-proof) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function keyUTC(ymd) {
    var m = YMD_RE.exec(String(ymd || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function fromUTC(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(ymd, n) { return fromUTC(keyUTC(ymd) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((keyUTC(b) - keyUTC(a)) / 86400000); }
  function ymdLocal(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function schedIdx(ymd) {
    var t = keyUTC(ymd);
    if (isNaN(t)) return -1;
    return (new Date(t).getUTCDay() + 6) % 7;
  }

  // ---------- habit shape ----------
  function isNum(h) {
    return !!(h && h.num && typeof h.num === "object" && typeof h.num.t === "number" && h.num.t > 0);
  }
  function perOf(h) {
    var p = h && h.per;
    if (!Array.isArray(p) || (p[0] !== "w" && p[0] !== "m")) return null;
    var n = p[1], max = p[0] === "w" ? 7 : 31;
    if (typeof n !== "number" || n < 1 || n > max || Math.floor(n) !== n) return null;
    return { p: p[0], n: n };
  }
  function isFixed(h) { return !perOf(h) && !!(h && Array.isArray(h.days) && h.days.length); }
  function isFlexible(h) { return !perOf(h) && !isFixed(h); }
  function isScheduledOn(habit, ymd) {
    if (!habit || perOf(habit) || !Array.isArray(habit.days) || !habit.days.length) return false;   // flexible ≠ scheduled
    return habit.days.indexOf(schedIdx(ymd)) !== -1;
  }

  // ---------- lookups ----------
  function living(data) {
    if (data && data._ix === true) data = data.data;
    var list = data && Array.isArray(data.habits) ? data.habits : [];
    return list.filter(function (h) {
      return h && !h.del && typeof h.id === "string" && h.id && typeof h.name === "string" && h.name;
    });
  }
  // Built once per render / per tick; every reader below accepts the
  // raw data too (then it builds one on the fly).
  function index(data) {
    if (data && data._ix === true) return data;
    var hs = {}, cs = {}, first = {};
    var hl = data && Array.isArray(data.habits) ? data.habits : [];
    var cl = data && Array.isArray(data.comps) ? data.comps : [];
    for (var i = 0; i < hl.length; i++) if (hl[i] && typeof hl[i].id === "string") hs[hl[i].id] = hl[i];
    for (var j = 0; j < cl.length; j++) {
      var c = cl[j];
      if (!c || typeof c.id !== "string") continue;
      cs[c.id] = c;
      if (hasContent(c) && typeof c.date === "string" && (!first[c.habitId] || c.date < first[c.habitId])) first[c.habitId] = c.date;
    }
    return { _ix: true, data: data, habits: hs, comps: cs, first: first };
  }
  function compOf(ix, habitId, ymd) { return ix.comps[habitId + "|" + ymd] || null; }
  function compValue(c) {
    if (!c || !c.v || typeof c.v !== "object") return null;
    var sum = 0, any = false;
    for (var k in c.v) {
      if (!Object.prototype.hasOwnProperty.call(c.v, k)) continue;
      var e = c.v[k];
      if (Array.isArray(e) && typeof e[0] === "number" && isFinite(e[0])) { sum += e[0]; any = true; }
    }
    return any ? Math.round(sum * 100) / 100 : null;
  }
  function hasContent(c) {
    return !!c && (!c.del || compValue(c) !== null || !!(c.sk && c.sk[0] === 1));
  }
  function valueOn(data, habitId, ymd) { return compValue(compOf(index(data), habitId, ymd)); }
  function isSkipped(data, habitId, ymd) {
    var c = compOf(index(data), habitId, ymd);
    return !!(c && Array.isArray(c.sk) && c.sk[0] === 1);
  }
  function noteOn(data, habitId, ymd) {
    var c = compOf(index(data), habitId, ymd);
    return c && Array.isArray(c.nt) && typeof c.nt[0] === "string" ? c.nt[0] : "";
  }
  function meets(h, v) {
    if (v === null) return false;
    return h.num.c === "le" ? v <= h.num.t : v >= h.num.t;
  }
  function isDone(data, habitId, ymd) {
    var ix = index(data), c = compOf(ix, habitId, ymd), h = ix.habits[habitId];
    if (h && isNum(h)) return meets(h, compValue(c));
    return !!(c && !c.del);
  }
  // 0..1: how much of the day's target was reached
  function progress(data, h, ymd) {
    var ix = index(data);
    if (!isNum(h)) return isDone(ix, h.id, ymd) ? 1 : 0;
    var v = compValue(compOf(ix, h.id, ymd)), t = h.num.t;
    if (v === null) return 0;
    if (h.num.c === "le") return v <= t ? 1 : Math.max(0, t / v);
    return Math.max(0, Math.min(1, v / t));
  }

  // ---------- periods (X times per week / month) ----------
  function periodStart(ymd, p) {
    if (p === "w") return addDays(ymd, -schedIdx(ymd));
    return String(ymd).slice(0, 8) + "01";
  }
  function periodEnd(ymd, p) {
    if (p === "w") return addDays(periodStart(ymd, "w"), 6);
    var s = periodStart(ymd, "m"), y = +s.slice(0, 4), mo = +s.slice(5, 7);
    return fromUTC(Date.UTC(y, mo, 0));
  }
  // done and skipped days inside the period of `ymd` (up to `upTo`)
  function periodCount(data, h, ymd, upTo) {
    var ix = index(data), pr = perOf(h) || { p: "w" };
    var d = periodStart(ymd, pr.p), end = periodEnd(ymd, pr.p), done = 0, skip = 0;
    if (upTo && upTo < end) end = upTo;
    for (var g = 0; d <= end && g < 32; g++, d = addDays(d, 1)) {
      if (isDone(ix, h.id, d)) done++;
      else if (isSkipped(ix, h.id, d)) skip++;
    }
    return { done: done, skip: skip };
  }
  function periodMet(data, h, ymd) {
    var pr = perOf(h);
    if (!pr) return false;
    var c = periodCount(data, h, ymd);
    return c.done + c.skip >= pr.n;
  }

  // ---------- due today (Today summary) ----------
  function dueOn(data, ymd) {
    if (!YMD_RE.test(String(ymd || ""))) return [];
    var ix = index(data);
    return living(data).filter(function (h) {
      if (isDone(ix, h.id, ymd) || isSkipped(ix, h.id, ymd)) return false;
      if (perOf(h)) return !periodMet(ix, h, ymd);
      return isScheduledOn(h, ymd);
    });
  }

  // ---------- streaks ----------
  // Days: walking back, a done day extends, a skipped or unscheduled
  // day is transparent, a scheduled missed day breaks (today not done
  // yet is not a break). Flexible habits have no scheduled days, so
  // every completion counts (v1 rule, unchanged).
  // X per period: whole periods; a met period extends, the current
  // one counts only once met.
  function streaks(data, h, today) {
    var ix = index(data), first = ix.first[h.id], pr = perOf(h);
    if (!first || first > today) return { cur: 0, best: 0, unit: pr ? pr.p : "d" };
    var best = 0, run = 0, d, g;
    if (pr) {
      var ps = periodStart(first, pr.p), cur = periodStart(today, pr.p);
      for (d = ps, g = 0; d <= cur && g < 2000; g++, d = addDays(periodEnd(d, pr.p), 1)) {
        var met = periodMet(ix, h, d);
        if (met) { run++; if (run > best) best = run; }
        else if (d !== cur) run = 0;
      }
      return { cur: run, best: best, unit: pr.p };
    }
    var span = daysBetween(first, today);
    for (d = first, g = 0; g <= span; g++, d = addDays(d, 1)) {
      if (isDone(ix, h.id, d)) { run++; if (run > best) best = run; }
      else if (isSkipped(ix, h.id, d) || !isScheduledOn(h, d)) continue;
      else if (d !== today) run = 0;
    }
    return { cur: run, best: best, unit: "d" };
  }

  // ---------- habit strength (Loop Habit Tracker style) ----------
  // An exponential moving average of the check-ins: score = score × M
  // + value × (1 − M), M = 0.5^(√freq / 13) (Loop's constant: about 13
  // missed days halve a daily habit). One missed day costs a few
  // points, never the whole score.
  //   fixed days: one step per scheduled day (freq 1); value = the
  //     day's progress (a measurable day can count in part)
  //   X per week / month: one step per day; value = (progress of the
  //     last 7 / 30 days + skipped days) / X, capped at 1; freq = X/7
  //     or X/30. Flexible habits score as once a week.
  //   Skipped days freeze the score; today counts only once it helps.
  function scoreSeries(data, h, today) {
    var ix = index(data), first = ix.first[h.id], out = [];
    if (!first || first > today) return out;
    var pr = perOf(h), fixed = isFixed(h);
    if (!pr && !fixed) pr = { p: "w", n: 1 };
    var L = pr ? (pr.p === "w" ? 7 : 30) : 1;
    var freq = pr ? pr.n / L : 1;
    var M = Math.pow(0.5, Math.sqrt(freq) / 13);
    var s = 0, win = [], span = daysBetween(first, today);
    for (var g = 0, d = first; g <= span && g < 20000; g++, d = addDays(d, 1)) {
      var sk = isSkipped(ix, h.id, d) && !isDone(ix, h.id, d);
      var x = progress(ix, h, d);
      if (pr) {
        win.push(sk ? 1 : x);
        if (win.length > L) win.shift();
        if (!sk && !(d === today && x === 0)) {
          var sum = 0;
          for (var i = 0; i < win.length; i++) sum += win[i];
          s = s * M + Math.min(1, sum / pr.n) * (1 - M);
        }
      } else if (isScheduledOn(h, d) && !sk && !(d === today && x === 0)) {
        s = s * M + x * (1 - M);
      }
      out.push({ d: d, s: s });
    }
    return out;
  }
  function score(data, h, today) {
    var ser = scoreSeries(data, h, today);
    return ser.length ? Math.round(ser[ser.length - 1].s * 100) : 0;
  }

  // ---------- reminders ----------
  // A habit with a reminder time asks on a day it still needs: not
  // done, not skipped; fixed days only on its days; X per period only
  // while the period is not met yet; flexible any day.
  function remKey(habitId, ymd) { return "r-" + habitId + "-" + ymd; }
  function needsReminder(data, h, ymd) {
    if (!h || typeof h.rem !== "number" || h.rem < 0 || h.rem > 1439) return false;
    var ix = index(data);
    if (isDone(ix, h.id, ymd) || isSkipped(ix, h.id, ymd)) return false;
    if (perOf(h)) return !periodMet(ix, h, ymd);
    if (isFixed(h)) return isScheduledOn(h, ymd);
    return true;
  }
  // The shell engine: due from the time on for 4 hours (orOS closed
  // longer = dropped, not caught up). Same key on every device.
  function dueReminders(data, nowMs) {
    var ix = index(data), out = [], now = new Date(nowMs), ymd = ymdLocal(nowMs);
    living(data).forEach(function (h) {
      if (typeof h.rem !== "number") return;
      var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(h.rem / 60), h.rem % 60).getTime();
      if (nowMs < at || nowMs - at >= REM_WINDOW) return;
      if (needsReminder(ix, h, ymd)) out.push({ id: h.id, name: h.name, min: h.rem, key: remKey(h.id, ymd) });
    });
    return out;
  }

  var API = {
    schedIdx: schedIdx, isScheduledOn: isScheduledOn, isDone: isDone, living: living, dueOn: dueOn,
    index: index, addDays: addDays, daysBetween: daysBetween, ymdLocal: ymdLocal,
    isNum: isNum, perOf: perOf, isFixed: isFixed, isFlexible: isFlexible,
    compValue: compValue, valueOn: valueOn, isSkipped: isSkipped, noteOn: noteOn, progress: progress,
    periodStart: periodStart, periodEnd: periodEnd, periodCount: periodCount, periodMet: periodMet,
    streaks: streaks, scoreSeries: scoreSeries, score: score,
    remKey: remKey, needsReminder: needsReminder, dueReminders: dueReminders, REM_WINDOW: REM_WINDOW
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosHabitsCore = API;
})(typeof window !== "undefined" ? window : globalThis);
