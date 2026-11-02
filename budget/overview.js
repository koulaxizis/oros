// ============================================================
// orOS Budget — Overview core (budget/overview.js)
// Pure numbers behind the Overview tab (budget/overviewui.js):
//   - pace: what was spent day by day in a month, added up, next to
//     the month before and the average of the three months before
//   - safe to spend: what is left a day until the end of the month,
//     under the overall limit or, without one, out of the income
//     (recurring entries still to come in the month counted)
//   - upcoming: recurring entries in the next days
//   - top categories with the change against the month before
//   - the card order of the Overview (set.ov, synced)
// Reads Budget's data as it is ({ tx, rec, tombs }); never writes.
// Amounts are integer cents. Dates "YYYY-MM-DD", months "YYYY-MM".
// ============================================================
(function (root) {
  "use strict";

  var P = root.OrosBudgetPlan || (typeof require === "function" ? require("./plan.js") : null);

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function daysIn(mk) { return new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7), 0)).getUTCDate(); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // Expenses of month `mk` added up day by day: [day 1 total, day 1+2, …].
  function cumulative(txs, mk) {
    var n = daysIn(mk), per = [];
    for (var i = 0; i < n; i++) per.push(0);
    txs.forEach(function (x) {
      if (x.k !== "o" || x.d.slice(0, 7) !== mk) return;
      per[+x.d.slice(8, 10) - 1] += x.a;
    });
    for (var j = 1; j < n; j++) per[j] += per[j - 1];
    return per;
  }

  // The pace of month `mk`: { days, cur, prev, avg, upto }.
  //   cur  the month's cumulative expenses (to `upto` only: today in
  //        the current month, every day in a past one, none ahead)
  //   prev the month before, day by day (a shorter month holds its
  //        last value), avg the mean of the three months before
  //   avgN how many of those three months had any expense
  function pace(txs, mk, today) {
    var n = daysIn(mk), curMk = today.slice(0, 7);
    var upto = mk < curMk ? n : mk === curMk ? +today.slice(8, 10) : 0;
    var cur = cumulative(txs, mk).slice(0, upto);
    var past = [1, 2, 3].map(function (k) { return cumulative(txs, P.mkAdd(mk, -k)); });
    function at(arr, i) { return arr.length ? arr[Math.min(i, arr.length - 1)] : 0; }
    var prev = [], avg = [];
    var used = past.filter(function (arr) { return arr[arr.length - 1] > 0; });
    for (var i = 0; i < n; i++) {
      prev.push(at(past[0], i));
      if (used.length) {
        var s = 0;
        used.forEach(function (arr) { s += at(arr, i); });
        avg.push(Math.round(s / used.length));
      }
    }
    return { days: n, upto: upto, cur: cur, prev: prev, avg: avg, avgN: used.length };
  }

  // Occurrences of the live recurring entries from `from` to `to`
  // (both included), by date then name: [{ id, d, k, a, c, n }].
  function upcoming(d, from, to) {
    var out = [];
    (d.rec || []).forEach(function (r) {
      if (d.tombs && ("rec:" + r.id) in d.tombs) return;
      var at = from, guard = 0;
      while (guard++ < 60) {
        var nx = P.nextCharge(r, at);
        if (!nx || nx > to) break;
        out.push({ id: r.id, d: nx, k: r.k, a: r.a, c: r.c, n: r.n || "" });
        at = P.addDays(nx, 1);
      }
    });
    out.sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.n, y.n) || cmpStr(x.id, y.id); });
    return out;
  }

  // Safe to spend in month `mk` (today's view of it).
  //   tt     the month's totals { inc, out } (as budget.js totals())
  //   limit  the overall monthly limit in cents (0 = none)
  //   rest   the recurring entries still to come this month (after today)
  // → { when: "past" | "now" | "ahead", mode: "limit" | "income",
  //     left (may be < 0), days, perDay (≥ 0), upIn, upOut }
  function safe(tt, limit, rest, mk, today) {
    var curMk = today.slice(0, 7), n = daysIn(mk);
    var upIn = 0, upOut = 0;
    rest.forEach(function (o) { if (o.k === "i") upIn += o.a; else upOut += o.a; });
    var when = mk < curMk ? "past" : mk === curMk ? "now" : "ahead";
    var days = when === "now" ? n - +today.slice(8, 10) + 1 : when === "ahead" ? n : 0;
    var mode = limit > 0 ? "limit" : "income";
    var left = mode === "limit" ? limit - tt.out - upOut : tt.inc + upIn - tt.out - upOut;
    var perDay = days > 0 && left > 0 ? Math.floor(left / days) : 0;
    return { when: when, mode: mode, left: left, days: days, perDay: perDay, upIn: upIn, upOut: upOut };
  }

  // Expense categories of `mk`, biggest first, with last month's
  // amount: [{ c, a, prev, pct (change in %, null when new) }].
  function topCats(txs, mk, max) {
    var now = {}, before = {}, pm = P.mkAdd(mk, -1);
    txs.forEach(function (x) {
      if (x.k !== "o") return;
      var m = x.d.slice(0, 7);
      if (m === mk) now[x.c] = (now[x.c] || 0) + x.a;
      else if (m === pm) before[x.c] = (before[x.c] || 0) + x.a;
    });
    var out = Object.keys(now).map(function (c) {
      var p = before[c] || 0;
      return { c: c, a: now[c], prev: p, pct: p ? Math.round((now[c] - p) * 100 / p) : null };
    });
    out.sort(function (x, y) { return y.a - x.a || cmpStr(x.c, y.c); });
    return out.slice(0, max || 5);
  }

  // Income and expenses of month `mk` per account (main-currency
  // amounts, as every total): { by: { <account id>: { inc, out } },
  // none: { inc, out } (entries without an account, or of an account
  // that is gone) }. Transfers are neither, so they are not here.
  function perAccount(txs, mk, accIds) {
    var known = {}, by = {}, none = { inc: 0, out: 0 };
    (accIds || []).forEach(function (id) { known[id] = 1; by[id] = { inc: 0, out: 0 }; });
    txs.forEach(function (x) {
      if (x.d.slice(0, 7) !== mk) return;
      var r = x.ac && known[x.ac] ? by[x.ac] : none;
      if (x.k === "i") r.inc += x.a; else r.out += x.a;
    });
    return { by: by, none: none };
  }

  // Overview cards and their order. set.ov (synced) is a list such as
  // "pace,safe,-acc,lim": every known card once, "-" = hidden. Unknown
  // names are kept at their place (a newer Budget's cards), missing
  // known ones are added at the end, shown.
  var CARDS = ["safe", "pace", "acc", "lim", "up", "goal", "loan", "top"];   // loan since C5
  var OV_RE = /^-?[a-z]{2,8}$/;
  function cardList(ov) {
    var seen = {}, out = [];
    (typeof ov === "string" ? ov.split(",") : []).forEach(function (s) {
      if (!OV_RE.test(s)) return;
      var id = s.replace(/^-/, "");
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, on: s.charAt(0) !== "-", known: CARDS.indexOf(id) >= 0 });
    });
    CARDS.forEach(function (id) { if (!seen[id]) out.push({ id: id, on: true, known: true }); });
    return out;
  }
  function cardString(list) {
    return list.map(function (c) { return (c.on ? "" : "-") + c.id; }).join(",");
  }
  // A valid stored value (≤ 16 names, ≤ 150 characters), or "".
  function normOv(v) {
    if (typeof v !== "string" || !v || v.length > 150) return "";
    var parts = v.split(",");
    if (parts.length > 16 || !parts.every(function (s) { return OV_RE.test(s); })) return "";
    return v;
  }


  var api = {
    CARDS: CARDS, daysIn: daysIn, cumulative: cumulative, pace: pace, upcoming: upcoming, safe: safe,
    topCats: topCats, perAccount: perAccount, cardList: cardList, cardString: cardString, normOv: normOv
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetOverview = api;
})(typeof window !== "undefined" ? window : this);
