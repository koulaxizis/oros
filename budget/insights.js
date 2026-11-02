// ============================================================
// orOS Budget — Charts core (budget/insights.js)
// Pure numbers behind the period view of the Charts tab
// (budget/insightsui.js):
//   - periods: a month, a quarter, a year or your own dates, and the
//     period of the same length just before it
//   - totals of a period (income, expenses, per category, per day)
//   - what changed per category against the period before
//   - where the money went by name (payee), from the entry text
//   - the month as a calendar, each day with a shade of what it cost
// Reads Budget's entries as they are; never writes. Amounts are
// integer cents; dates "YYYY-MM-DD", months "YYYY-MM".
// ============================================================
(function (root) {
  "use strict";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function utcMs(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
  function ymdUTC(ms) { var x = new Date(ms); return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate()); }
  function addDays(ymd, n) { return ymdUTC(utcMs(ymd) + n * 86400000); }
  function dayCount(from, to) { return Math.round((utcMs(to) - utcMs(from)) / 86400000) + 1; }
  function mkAdd(mk, n) {
    var t = +mk.slice(0, 4) * 12 + (+mk.slice(5, 7) - 1) + n;
    return Math.floor(t / 12) + "-" + pad2(t % 12 + 1);
  }
  function first(mk) { return mk + "-01"; }
  function last(mk) { return mk + "-" + pad2(daysIn(+mk.slice(0, 4), +mk.slice(5, 7))); }
  var YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function okYmd(s) { return typeof s === "string" && YMD_RE.test(s) && ymdUTC(utcMs(s)) === s; }

  // The period of kind "m" (month), "q" (quarter), "y" (year) around
  // month `mk`, or "c" (custom, `from`–`to`, swapped if reversed, at
  // most 3 years), with the period just before it:
  // { kind, from, to, days, pFrom, pTo }. A bad custom range falls
  // back to the month.
  var MAX_DAYS = 3 * 366;
  function period(kind, mk, from, to) {
    var f, t, pf, pt;
    if (kind === "c" && okYmd(from) && okYmd(to)) {
      if (from > to) { var s = from; from = to; to = s; }
      if (dayCount(from, to) > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
      f = from; t = to;
      var n = dayCount(f, t);
      pt = addDays(f, -1); pf = addDays(pt, -(n - 1));
    } else if (kind === "q") {
      var q0 = mk.slice(0, 5) + pad2(Math.floor((+mk.slice(5, 7) - 1) / 3) * 3 + 1);
      f = first(q0); t = last(mkAdd(q0, 2));
      pf = first(mkAdd(q0, -3)); pt = last(mkAdd(q0, -1));
    } else if (kind === "y") {
      var y = mk.slice(0, 4);
      f = y + "-01-01"; t = y + "-12-31";
      pf = (+y - 1) + "-01-01"; pt = (+y - 1) + "-12-31";
    } else {
      kind = "m";
      f = first(mk); t = last(mk);
      pf = first(mkAdd(mk, -1)); pt = last(mkAdd(mk, -1));
    }
    return { kind: kind, from: f, to: t, days: dayCount(f, t), pFrom: pf, pTo: pt };
  }

  // Totals of the entries from `from` to `to` (both included):
  // { inc, out, n, byCat { "o:<cat>" | "i:<cat>": cents }, byDay { ymd: expenses } }.
  function sum(txs, from, to) {
    var r = { inc: 0, out: 0, n: 0, byCat: {}, byDay: {} };
    txs.forEach(function (x) {
      if (x.d < from || x.d > to) return;
      r.n++;
      if (x.k === "i") r.inc += x.a;
      else { r.out += x.a; r.byDay[x.d] = (r.byDay[x.d] || 0) + x.a; }
      var key = x.k + ":" + x.c;
      r.byCat[key] = (r.byCat[key] || 0) + x.a;
    });
    return r;
  }

  // Change in % from `b` to `a` (null when b is 0).
  function pct(a, b) { return b ? Math.round((a - b) * 100 / b) : null; }

  // The categories of kind `k` ("o" | "i") in either period, with the
  // amount now and before, biggest change first:
  // [{ c, a, p, d (a − p), pct }].
  function compare(cur, prev, k) {
    var keys = {};
    [cur.byCat, prev.byCat].forEach(function (m) {
      Object.keys(m).forEach(function (key) { if (key.charAt(0) === k) keys[key.slice(2)] = 1; });
    });
    var out = Object.keys(keys).map(function (c) {
      var a = cur.byCat[k + ":" + c] || 0, p = prev.byCat[k + ":" + c] || 0;
      return { c: c, a: a, p: p, d: a - p, pct: pct(a, p) };
    });
    out.sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d) || y.a - x.a || cmpStr(x.c, y.c); });
    return out;
  }

  // The name an expense goes by: the bank's own text or the note, with
  // case, accents, digits and punctuation folded away, so "LIDL 1234"
  // and "Lidl" are one. "" when nothing is left.
  function payeeKey(s) {
    var t = String(s || "").toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/[^a-zα-ως\s]/g, " ").replace(/\s+/g, " ").trim();
    var words = t.split(" ").filter(function (w) { return w.length > 1; }).slice(0, 3);
    var key = words.join(" ");
    return key.length >= 3 ? key : "";
  }
  // Expenses of the period by payee, biggest first:
  // [{ key, name (the most recent text), a, n }].
  function payees(txs, from, to, max) {
    var by = {};
    txs.forEach(function (x) {
      if (x.k !== "o" || x.d < from || x.d > to) return;
      var text = x.n || x.ot || "";
      var key = payeeKey(text);
      if (!key) return;
      var e = by[key] || (by[key] = { key: key, name: "", d: "", a: 0, n: 0 });
      e.a += x.a;
      e.n++;
      if (x.d >= e.d) { e.d = x.d; e.name = text.trim(); }
    });
    var out = Object.keys(by).map(function (k) { var e = by[k]; return { key: e.key, name: e.name, a: e.a, n: e.n }; });
    out.sort(function (x, y) { return y.a - x.a || cmpStr(x.key, y.key); });
    return out.slice(0, max || 5);
  }

  // Month `mk` as weeks, Monday first: [[null | { d, a, lvl }] × 7].
  // lvl 0 (nothing) to 4, against the dearest day of the month.
  function calendar(byDay, mk) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7), n = daysIn(y, m), max = 0, i;
    for (i = 1; i <= n; i++) max = Math.max(max, byDay[mk + "-" + pad2(i)] || 0);
    var lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    var cells = [];
    for (i = 0; i < lead; i++) cells.push(null);
    for (i = 1; i <= n; i++) {
      var d = mk + "-" + pad2(i), a = byDay[d] || 0;
      cells.push({ d: d, a: a, lvl: a && max ? Math.max(1, Math.min(4, Math.ceil(a * 4 / max))) : 0 });
    }
    while (cells.length % 7) cells.push(null);
    var weeks = [];
    for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks: weeks, max: max };
  }

  var api = {
    period: period, sum: sum, pct: pct, compare: compare, payeeKey: payeeKey, payees: payees,
    calendar: calendar, okYmd: okYmd, dayCount: dayCount, addDays: addDays
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetInsights = api;
})(typeof window !== "undefined" ? window : this);
