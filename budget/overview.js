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

  // PL-2: the same per area: { by: { <area id>: { inc, out } }, none }
  // (none = no area, or one that is gone).
  function perArea(txs, mk, areaIds) {
    var known = {}, by = {}, none = { inc: 0, out: 0 };
    (areaIds || []).forEach(function (id) { known[id] = 1; by[id] = { inc: 0, out: 0 }; });
    txs.forEach(function (x) {
      if (x.d.slice(0, 7) !== mk) return;
      var r = x.dm && known[x.dm] ? by[x.dm] : none;
      if (x.k === "i") r.inc += x.a; else r.out += x.a;
    });
    return { by: by, none: none };
  }

  // AR-INV (6.01.00): the year up to a month per area, with the shared
  // costs split by the areas' shares. areas = [{ id, pc?, sh? }] (the
  // shared one: sh 1, lowest id). → { from, to, rows: [{ id, inc, out,
  // net, share, after }], shared: { id, inc, out, cost } | null, left
  // (shared cost no share takes), none: { inc, out } }. Cents; a share
  // is the shared net cost × pc / 100, rounded half away from zero; a
  // shared area with more income than costs gives a negative cost
  // (the areas then get money back). Nothing is written.
  function areaYear(txs, mk, areas) {
    var y = String(mk).slice(0, 4), from = y + "-01", to = String(mk).slice(0, 7);
    var list = (areas || []).filter(function (a) { return a && typeof a.id === "string"; });
    var sh = list.filter(function (a) { return a.sh === 1; }).sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })[0] || null;
    var by = {}, none = { inc: 0, out: 0 };
    list.forEach(function (a) { by[a.id] = { inc: 0, out: 0 }; });
    (txs || []).forEach(function (x) {
      var m = x.d.slice(0, 7);
      if (m < from || m > to) return;
      var r = x.dm && by[x.dm] ? by[x.dm] : none;
      if (x.k === "i") r.inc += x.a; else r.out += x.a;
    });
    var cost = sh ? by[sh.id].out - by[sh.id].inc : 0, taken = 0;
    var rows = list.filter(function (a) { return !sh || a.id !== sh.id; }).map(function (a) {
      var f = by[a.id], pc = typeof a.pc === "number" && a.pc > 0 && a.pc <= 100 ? a.pc : 0;
      var share = pc && cost ? (cost < 0 ? -1 : 1) * Math.round(Math.abs(cost) * pc / 100) : 0;
      taken += share;
      return { id: a.id, inc: f.inc, out: f.out, net: f.inc - f.out, share: share, after: f.inc - f.out - share };
    });
    return { from: from, to: to, rows: rows, shared: sh ? { id: sh.id, inc: by[sh.id].inc, out: by[sh.id].out, cost: cost } : null,
             left: cost - taken, none: none };
  }

  // AR-VIEW (6.03.00, Chris 2026-11-09 «Ενιαία οικονομικά στο Budget»):
  // the whole picture for the year up to a month. Business = every area
  // that is neither personal (ps 1) nor the shared one, less all of the
  // shared costs; personal = the personal areas; none = entries without
  // an area. total = all income − all expenses (= business.after +
  // personal.net + none.net). draws = transfers from an account of a
  // business area (or the shared one) to an account of a personal area,
  // back = the other way (accs = [{ id, dm? }]); they move money only,
  // so they are in no total. Cents; nothing is written.
  function wholeYear(txs, xfers, accs, mk, areas) {
    var Y = areaYear(txs, mk, areas), list = (areas || []).filter(function (a) { return a && typeof a.id === "string"; });
    var kind = {};
    list.forEach(function (a) { kind[a.id] = Y.shared && a.id === Y.shared.id ? "b" : a.ps === 1 ? "p" : "b"; });
    var bus = { inc: 0, out: 0, net: 0, shared: Y.shared ? Y.shared.cost : 0, after: 0 }, per = { inc: 0, out: 0, net: 0 };
    Y.rows.forEach(function (r) {
      var to = kind[r.id] === "p" ? per : bus;
      to.inc += r.inc; to.out += r.out; to.net += r.net;
    });
    if (Y.shared) { bus.inc += Y.shared.inc; bus.out += Y.shared.out; }
    bus.after = bus.net - bus.shared;
    var none = { inc: Y.none.inc, out: Y.none.out, net: Y.none.inc - Y.none.out };
    var accArea = {};
    (accs || []).forEach(function (a) { if (a && a.dm && kind[a.dm]) accArea[a.id] = kind[a.dm]; });
    var draws = 0, back = 0;
    (xfers || []).forEach(function (x) {
      var m = typeof x.d === "string" ? x.d.slice(0, 7) : "";
      if (m < Y.from || m > Y.to) return;
      var f = accArea[x.f], t = accArea[x.t];
      if (f === "b" && t === "p") draws += x.a;
      else if (f === "p" && t === "b") back += x.ta || x.a;
    });
    return { from: Y.from, to: Y.to, business: bus, personal: per, none: none,
             total: bus.after + per.net + none.net, draws: draws, back: back };
  }

  // Overview cards and their order. set.ov (synced) is a list such as
  // "pace,safe,-acc,lim": every known card once, "-" = hidden. Unknown
  // names are kept at their place (a newer Budget's cards), missing
  // known ones are added at the end, shown.
  var CARDS = ["safe", "pace", "acc", "lim", "up", "goal", "loan", "top", "area"];   // loan since C5, area since PL-2
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

  // AC-1: account groups on the Overview. "inv" an investment or a thing
  // of value (ivk), "card" a credit card (its cycle, or a credit limit
  // typed at the bank that fills it), "cash" the rest (bank, cash,
  // wallets). bnk = the bank rows (collection bnk).
  var GROUPS = ["cash", "card", "inv"];
  function accGroup(a, bnk) {
    if (!a) return "cash";
    if (a.ivk) return "inv";
    // a card: a cycle, a bank row with a credit limit, or one the person
    // marked as a credit card (CD-1, ck 1) or the bank calls CARD
    if (a.cys || (bnk || []).some(function (r) { return r && r.ac === a.id && ((typeof r.cl === "number" && r.cl > 0) || r.ck === 1 || (r.ty === "CARD" && r.ck !== 2)); })) return "card";
    return "cash";
  }
  // What you have and what you owe: the sums of the positive and the
  // negative values (main currency, null = no rate, left out).
  function haveOwe(vals) {
    var have = 0, owe = 0;
    (vals || []).forEach(function (v) { if (typeof v !== "number" || !isFinite(v)) return; if (v >= 0) have += v; else owe -= v; });
    return { have: have, owe: owe };
  }

  var api = {
    CARDS: CARDS, daysIn: daysIn, cumulative: cumulative, pace: pace, upcoming: upcoming, safe: safe,
    topCats: topCats, perAccount: perAccount, perArea: perArea, areaYear: areaYear, wholeYear: wholeYear, cardList: cardList, cardString: cardString, normOv: normOv,
    GROUPS: GROUPS, accGroup: accGroup, haveOwe: haveOwe
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetOverview = api;
})(typeof window !== "undefined" ? window : this);
