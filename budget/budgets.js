// ============================================================
// orOS Budget — Flexible budgets core (budget/budgets.js)
// A budget is an amount for a stretch of time that repeats (every
// week, every month from any day, every N days) or happens once (a
// trip, the holidays), over all expenses or chosen categories and
// accounts. Monthly limits stay as they are; budgets sit next to them.
// Pure: reads a budget and the entries, never writes.
// Entries may carry sc (their subcategory when c is its main one).
//   budget = { id, m, a (cents > 0), as (account ids, space-separated,
//     "" = all), col 0–8, cs (category ids, space-separated, "" = every
//     expense), e (last day, "once" only, else ""), n (name ≤ 40),
//     nd (days, "every N days" only, else 0), p "w" | "m" | "d" | "o",
//     s (first day) }
// Amounts are integer cents; dates "YYYY-MM-DD".
// ============================================================
(function (root) {
  "use strict";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function utcMs(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
  function ymdUTC(ms) { var x = new Date(ms); return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate()); }
  function addDays(ymd, n) { return ymdUTC(utcMs(ymd) + n * 86400000); }
  function dayDiff(a, b) { return Math.round((utcMs(b) - utcMs(a)) / 86400000); }
  var YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function okYmd(s) { return typeof s === "string" && YMD_RE.test(s) && ymdUTC(utcMs(s)) === s; }
  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var MAX_CENTS = 100000000000;

  // The day `k` months after the first day's month, on the first day's
  // day of the month (clamped: the 31st is the 30th in April).
  function monthDay(s, k) {
    var t = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + k, y = Math.floor(t / 12), m = t % 12 + 1;
    return y + "-" + pad2(m) + "-" + pad2(Math.min(+s.slice(8, 10), daysIn(y, m)));
  }

  // The period number `i` of budget `b` (0 = the one starting on s):
  // { i, from, to }. "o" has only period 0.
  function nth(b, i) {
    if (b.p === "o") return { i: 0, from: b.s, to: b.e || b.s };
    if (b.p === "m") return { i: i, from: monthDay(b.s, i), to: addDays(monthDay(b.s, i + 1), -1) };
    var len = b.p === "w" ? 7 : b.nd;
    return { i: i, from: addDays(b.s, i * len), to: addDays(b.s, i * len + len - 1) };
  }
  // The period that holds `day` (before the first day: the first one).
  function periodAt(b, day) {
    if (b.p === "o" || day <= b.s) return nth(b, 0);
    var i;
    if (b.p === "m") {
      i = (+day.slice(0, 4) - +b.s.slice(0, 4)) * 12 + (+day.slice(5, 7) - +b.s.slice(5, 7));
      if (monthDay(b.s, i) > day) i--;
    } else {
      i = Math.floor(dayDiff(b.s, day) / (b.p === "w" ? 7 : b.nd));
    }
    return nth(b, Math.max(0, i));
  }

  function idSet(s) {
    var out = {};
    (s || "").split(" ").forEach(function (x) { if (x) out[x] = 1; });
    return out;
  }
  // Expenses of the entries that count for `b` from `from` to `to`.
  function spent(b, txs, from, to) {
    var cs = b.cs ? idSet(b.cs) : null, as = b.as ? idSet(b.as) : null, sum = 0;
    txs.forEach(function (x) {
      if (x.k !== "o" || x.d < from || x.d > to) return;
      if (cs && !cs[x.c] && !(x.sc && cs[x.sc])) return;
      if (as && !as[x.ac || ""]) return;
      sum += x.a;
    });
    return sum;
  }

  // Where budget `b` stands on `today`:
  // { from, to, spent, left, pct, state "ok"|"warn"|"over"|"ahead"|"done",
  //   days (left, today included), perDay, ideal (what an even pace
  //   would have spent by today), pace (cumulative spend per day to today) }
  function status(b, txs, today) {
    var p = periodAt(b, today);
    var n = dayDiff(p.from, p.to) + 1;
    var sp = spent(b, txs, p.from, p.to);
    var when = today < p.from ? "ahead" : today > p.to ? "done" : "now";
    var days = when === "now" ? dayDiff(today, p.to) + 1 : when === "ahead" ? n : 0;
    var left = b.a - sp;
    var gone = when === "now" ? dayDiff(p.from, today) + 1 : when === "done" ? n : 0;
    var state = sp > b.a ? "over" : sp * 10 >= b.a * 8 ? "warn" : "ok";
    var pace = [], run = 0, byDay = {};
    txs.forEach(function (x) { if (x.k === "o" && x.d >= p.from && x.d <= p.to) byDay[x.d] = 1; });
    for (var i = 0; i < gone; i++) {
      var d = addDays(p.from, i);
      if (byDay[d]) run += spent(b, txs, d, d);
      pace.push(run);
    }
    return {
      i: p.i, from: p.from, to: p.to, len: n, spent: sp, left: left, when: when,
      pct: Math.round(sp * 100 / b.a), state: state, days: days,
      perDay: days > 0 && left > 0 ? Math.floor(left / days) : 0,
      ideal: Math.round(b.a * gone / n), pace: pace
    };
  }

  // The last `count` periods that ended before the current one, oldest
  // first: [{ from, to, spent, over }]. Never before the first day.
  function history(b, txs, today, count) {
    if (b.p === "o") return [];
    var cur = periodAt(b, today), out = [];
    for (var i = Math.max(0, cur.i - count); i < cur.i; i++) {
      var p = nth(b, i), sp = spent(b, txs, p.from, p.to);
      out.push({ from: p.from, to: p.to, spent: sp, over: sp > b.a });
    }
    return out;
  }

  // A stored budget, cleaned; null when it can't be one. Every field is
  // always written, in name order after id and m (what an older Budget
  // writes for a collection it does not know), so old and new devices
  // keep the same canonical JSON.
  var P_OK = { w: 1, m: 1, d: 1, o: 1 };
  function ids(s) {
    if (typeof s !== "string") return "";
    var seen = {}, out = "";
    s.split(" ").forEach(function (x) {
      if (!ID_RE.test(x) || seen[x] || (out ? out.length + 1 : 0) + x.length > 500) return;
      seen[x] = 1;
      out += (out ? " " : "") + x;
    });
    return out;
  }
  function norm(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    if (!isInt(x.a) || x.a <= 0 || x.a > MAX_CENTS || !P_OK[x.p] || !okYmd(x.s)) return null;
    var e = x.p === "o" && okYmd(x.e) && x.e >= x.s ? x.e : "";
    if (x.p === "o" && !e) return null;
    var nd = x.p === "d" && isInt(x.nd) && x.nd >= 1 && x.nd <= 366 ? x.nd : 0;
    if (x.p === "d" && !nd) return null;
    var n = typeof x.n === "string" ? x.n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
    if (!n) return null;
    return { id: x.id, m: x.m, a: x.a, as: ids(x.as), col: isInt(x.col) && x.col >= 0 && x.col <= 8 ? x.col : 3,
             cs: ids(x.cs), e: e, n: n, nd: nd, p: x.p, s: x.s };
  }

  var api = { nth: nth, periodAt: periodAt, spent: spent, status: status, history: history, norm: norm, okYmd: okYmd, addDays: addDays, dayDiff: dayDiff };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetBudgets = api;
})(typeof window !== "undefined" ? window : this);
