// ============================================================
// orOS Budget — planning core (budget/plan.js)
// Pure logic, no DOM, no storage: loaded by budget/index.html as
// window.OrosBudgetPlan, by the shell (subscription reminders, it
// reads oros-budget-data with Budget closed) and by
// tests/budget-plan.test.js in Node.
//   1. Envelopes (zero-based, optional): assigned / spent /
//      available per expense category and month, leftovers and
//      overspending roll into the next month, "To be assigned"
//   2. Savings goals: progress, months left, amount a month
//   3. Subscriptions: monthly / yearly cost, next charge, the
//      reminders that are due (N days before the charge)
//   4. Reports: a year per category per month, net worth at each
//      month end (account balances in their own currency,
//      converted to the main one)
//   5. Currencies (rates are Unit Converter's cache, units/core.js)
//   6. Receipts: file names on the orOS disk, the total read from
//      pasted receipt text
// Amounts are integer cents everywhere.
// ============================================================
(function (root) {
  "use strict";

  var MAX_CENTS = 100000000000;
  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var MK_RE = /^(\d{4})-(\d{2})$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function okMk(s) {
    var x = typeof s === "string" ? MK_RE.exec(s) : null;
    return !!x && +x[1] >= 1900 && +x[1] <= 2200 && +x[2] >= 1 && +x[2] <= 12;
  }
  function okYmd(s) {
    var x = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!x) return false;
    var y = +x[1], m = +x[2], d = +x[3];
    return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
  }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function mkAdd(mk, n) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + pad2(m + 1);
  }
  function mkDiff(a, b) {   // months from a to b
    return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  }
  function utcMs(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
  function ymdUTC(ms) {
    var x = new Date(ms);
    return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate());
  }
  function addDays(ymd, n) { return ymdUTC(utcMs(ymd) + n * 86400000); }
  function dayDiff(a, b) { return Math.round((utcMs(b) - utcMs(a)) / 86400000); }
  function lastDay(mk) { return mk + "-" + pad2(daysIn(+mk.slice(0, 4), +mk.slice(5, 7))); }

  // ---------- 1. Envelopes ----------
  // An assignment = { id "<yyyymm>-<category id | none>", m, a (signed
  // cents: a move can take more out than was put in that month), c
  // (category id, "" = uncategorised), mk "YYYY-MM" } (normalised in
  // budget.js). One item per envelope and month, so two devices that
  // assign the same envelope converge on one value (LWW), never a sum.
  function asgId(mk, c) { return mk.replace("-", "") + "-" + (c || "none"); }
  // The month `mk` of envelope budgeting started in `start` ("YYYY-MM").
  // live = the expense categories that exist (ids); an entry of a
  // deleted category (or none) counts under "" (Uncategorised).
  // startCash = what the accounts held when it started (≥ 0).
  // → { before: true } for a month before the start, else
  //   { mk, rows: [{ c, asg, spent, carry, avail }], tba, income,
  //     assigned, spent, overspent: [c…] }
  // Leftovers AND overspending roll into the same envelope next month.
  function envMonth(d, mk, start, live, startCash) {
    if (!okMk(start) || !okMk(mk)) return { before: true };
    if (mk < start) return { before: true };
    var isLive = {};
    (live || []).forEach(function (c) { isLive[c] = 1; });
    var spentBy = {}, incomeBy = {}, asgBy = {}, used = {};
    (d.tx || []).forEach(function (x) {
      var m = x.d.slice(0, 7);
      if (m < start || m > mk) return;
      if (x.k === "i") { incomeBy[m] = (incomeBy[m] || 0) + x.a; return; }
      var c = isLive[x.c] ? x.c : "";
      var k = m + "|" + c;
      spentBy[k] = (spentBy[k] || 0) + x.a;
      if (!c) used[""] = 1;
    });
    (d.asg || []).forEach(function (g) {
      if (g.mk < start || g.mk > mk) return;
      var c = isLive[g.c] ? g.c : (g.c ? null : "");
      if (c === null) return;   // a deleted category's money goes back to "To be assigned"
      asgBy[g.mk + "|" + c] = (asgBy[g.mk + "|" + c] || 0) + g.a;
      if (!c && g.a) used[""] = 1;
    });
    var cats = (live || []).slice();
    if (used[""]) cats.push("");
    var carry = {}, rows = [], income = 0, assigned = 0, spentAll = 0;
    cats.forEach(function (c) { carry[c] = 0; });
    for (var m = start, guard = 0; m <= mk && guard < 2400; m = mkAdd(m, 1), guard++) {
      income += incomeBy[m] || 0;
      cats.forEach(function (c) {
        var a = asgBy[m + "|" + c] || 0, s = spentBy[m + "|" + c] || 0;
        assigned += a;
        if (m === mk) {
          rows.push({ c: c, asg: a, spent: s, carry: carry[c], avail: carry[c] + a - s });
          spentAll += s;
        }
        carry[c] = carry[c] + a - s;
      });
    }
    var cash = isInt(startCash) && startCash > 0 ? startCash : 0;
    return {
      mk: mk, rows: rows, income: income, assigned: assigned, spent: spentAll, startCash: cash,
      tba: cash + income - assigned,
      overspent: rows.filter(function (r) { return r.avail < 0; }).map(function (r) { return r.c; })
    };
  }
  // Moving money: the new assignment values of the two envelopes
  // ("" from/to = "To be assigned", nothing to write for it).
  // → [{ c, a }] (a = the envelope's new assignment for the month).
  function moveMoney(asgOf, from, to, cents) {
    var out = [];
    if (!isInt(cents) || cents <= 0 || from === to) return out;
    if (from !== null) out.push({ c: from, a: asgOf(from) - cents });
    if (to !== null) out.push({ c: to, a: asgOf(to) + cents });
    return out;
  }

  // ---------- 2. Savings goals ----------
  // goal = { id, m, ac (account id | ""), col 0–8, d (target date |
  // ""), n (name), sv (saved by hand, cents ≥ 0), t (target, cents) }
  // (normalised in budget.js). With an account, progress = that
  // account's balance (in the main currency); without, what you put
  // in by hand.
  // → { saved, left, pct (0–100), done, months (left, incl. this one;
  //     0 = no date), perMonth (cents a month to make it; 0 = done or
  //     no date), late (the date has passed, not reached) }
  function goalStatus(g, saved, today) {
    var s = isInt(saved) ? saved : 0;
    var left = Math.max(0, g.t - s);
    var out = { saved: s, left: left, pct: Math.max(0, Math.min(100, Math.floor(s * 100 / g.t))), done: left === 0,
                months: 0, perMonth: 0, late: false };
    if (!g.d || out.done) return out;
    if (g.d < today) { out.late = true; out.perMonth = left; return out; }
    out.months = mkDiff(today.slice(0, 7), g.d.slice(0, 7)) + 1;
    out.perMonth = Math.ceil(left / out.months);
    return out;
  }

  // ---------- 3. Subscriptions ----------
  // Occurrences of a recurring entry: the same rule as budget.js
  // (monthly/yearly keep the first date's day, clamped; weekly every
  // 7 days). Only the next one is needed here.
  function nextCharge(r, from) {
    if (!okYmd(r.s)) return "";
    var f = from < r.s ? r.s : from;
    if (r.e && f > r.e) return "";
    var out = "";
    if (r.f === "w") {
      var k = Math.max(0, Math.ceil((utcMs(f) - utcMs(r.s)) / 604800000));
      out = ymdUTC(utcMs(r.s) + k * 604800000);
    } else if (r.f === "y") {
      var sm = +r.s.slice(5, 7), sd = +r.s.slice(8, 10);
      for (var y = +f.slice(0, 4), g = 0; g < 3; y++, g++) {
        var oy = y + "-" + pad2(sm) + "-" + pad2(Math.min(sd, daysIn(y, sm)));
        if (oy >= f) { out = oy; break; }
      }
    } else {
      var dd = +r.s.slice(8, 10);
      for (var mk = f.slice(0, 7), h = 0; h < 3; mk = mkAdd(mk, 1), h++) {
        var om = mk + "-" + pad2(Math.min(dd, daysIn(+mk.slice(0, 4), +mk.slice(5, 7))));
        if (om >= f) { out = om; break; }
      }
    }
    return out && (!r.e || out <= r.e) ? out : "";
  }
  function monthlyCost(r) { return r.f === "w" ? Math.round(r.a * 52 / 12) : r.f === "y" ? Math.round(r.a / 12) : r.a; }
  function yearlyCost(r) { return r.f === "w" ? r.a * 52 : r.f === "y" ? r.a : r.a * 12; }
  // Reminder lead (days before the charge) of a recurring entry:
  // nd 0–30 (0 = on the day), absent = no reminder.
  function normNd(v) { return isInt(v) && v >= 0 && v <= 30 ? v : -1; }
  // Recurring expenses still running, by next charge.
  // → [{ r, next, monthly, yearly }] and the totals.
  function subscriptions(d, today) {
    var tombs = d.tombs || {};
    var list = [];
    (d.rec || []).forEach(function (r) {
      if (r.k !== "o" || ("rec:" + r.id) in tombs) return;
      var next = nextCharge(r, today);
      if (!next) return;
      list.push({ r: r, next: next, monthly: monthlyCost(r), yearly: yearlyCost(r) });
    });
    list.sort(function (a, b) { return cmpStr(a.next, b.next) || b.r.a - a.r.a || cmpStr(a.r.id, b.r.id); });
    var m = 0, y = 0;
    list.forEach(function (s) { m += s.monthly; y += s.yearly; });
    return { list: list, monthly: m, yearly: y };
  }
  // Reminders due today: a subscription with nd ≥ 0 whose next charge
  // is nd days away or closer (but not past). The key names the
  // charge, so each charge is announced once (orosNotifs dedups).
  // → [{ id, key, next, days, a, n, c }]
  function subsDue(d, today) {
    var out = [];
    subscriptions(d, today).list.forEach(function (s) {
      var nd = normNd(s.r.nd);
      if (nd < 0) return;
      var days = dayDiff(today, s.next);
      if (days < 0 || days > nd) return;
      out.push({ id: s.r.id, key: "sub-" + s.r.id + "-" + s.next.replace(/-/g, ""), next: s.next, days: days,
                 a: s.r.a, n: s.r.n || "", c: s.r.c || "" });
    });
    return out;
  }

  // ---------- 4. Reports ----------
  // A year of expenses per category per month. live = expense
  // category ids that exist; others count under "".
  // → { year, months [12 "YYYY-MM"], rows [{ c, by [12], tot }] (by
  //    total, largest first), out [12], inc [12], totOut, totInc }
  function yearReport(d, year, live) {
    var y = String(year), months = [], idx = {};
    for (var i = 0; i < 12; i++) { months.push(y + "-" + pad2(i + 1)); idx[months[i]] = i; }
    var isLive = {};
    (live || []).forEach(function (c) { isLive[c] = 1; });
    var by = {}, out = [], inc = [];
    for (var j = 0; j < 12; j++) { out.push(0); inc.push(0); }
    (d.tx || []).forEach(function (x) {
      if (x.d.slice(0, 4) !== y) return;
      var mi = idx[x.d.slice(0, 7)];
      if (x.k === "i") { inc[mi] += x.a; return; }
      out[mi] += x.a;
      var c = isLive[x.c] ? x.c : "";
      if (!by[c]) { by[c] = []; for (var z = 0; z < 12; z++) by[c].push(0); }
      by[c][mi] += x.a;
    });
    var rows = Object.keys(by).map(function (c) {
      var tot = 0;
      by[c].forEach(function (v) { tot += v; });
      return { c: c, by: by[c], tot: tot };
    }).sort(function (a, b) { return b.tot - a.tot || cmpStr(a.c, b.c); });
    var to = 0, ti = 0;
    out.forEach(function (v) { to += v; });
    inc.forEach(function (v) { ti += v; });
    return { year: y, months: months, rows: rows, out: out, inc: inc, totOut: to, totInc: ti };
  }

  // Account balances in each account's own currency at the end of
  // `upto` ("YYYY-MM-DD"). An account's currency is acc.cur, else the
  // main one. An entry counts in the account's currency: its original
  // amount when it was typed in that currency, its main amount when
  // the account is in the main currency, else converted (fx). A
  // transfer takes `a` (the from-account's currency) and gives `ta`
  // when set (the to-account's), else `a` converted.
  // fx(cents, from, to) → cents | null. → { id: cents }
  function accCur(a, main) { return a.cur || main; }
  function entryIn(x, cur, main, fx) {
    if (x.oc && x.oc === cur && isInt(x.oa)) return x.oa;
    if (cur === main) return x.a;
    var v = fx ? fx(x.a, main, cur) : null;
    return v === null ? x.a : v;
  }
  function balancesFx(d, upto, main, fx) {
    var bal = {}, curOf = {};
    (d.acc || []).forEach(function (a) { bal[a.id] = a.o; curOf[a.id] = accCur(a, main); });
    (d.tx || []).forEach(function (x) {
      if (!x.ac || bal[x.ac] === undefined || x.d > upto) return;
      var v = entryIn(x, curOf[x.ac], main, fx);
      bal[x.ac] += x.k === "i" ? v : -v;
    });
    (d.xfer || []).forEach(function (x) {
      if (x.d > upto) return;
      if (bal[x.f] !== undefined) bal[x.f] -= x.a;
      if (bal[x.t] !== undefined) {
        var fc = curOf[x.f] || main, tc = curOf[x.t];
        var v = isInt(x.ta) && x.ta > 0 ? x.ta : (fc === tc ? x.a : (fx ? fx(x.a, fc, tc) : null));
        bal[x.t] += v === null ? x.a : v;
      }
    });
    return bal;
  }
  // Sum of the balances in the main currency. missing = accounts whose
  // currency has no rate (left out).
  function netWorth(d, upto, main, fx) {
    var bal = balancesFx(d, upto, main, fx), tot = 0, missing = [];
    (d.acc || []).forEach(function (a) {
      var c = accCur(a, main);
      var v = c === main ? bal[a.id] : (fx ? fx(bal[a.id], c, main) : null);
      if (v === null) missing.push(a.id); else tot += v;
    });
    return { tot: tot, bal: bal, missing: missing };
  }
  // Net worth at the end of each month in `months` (ascending);
  // today's month ends today.
  function netWorthSeries(d, months, today, main, fx) {
    return months.map(function (mk) {
      var end = lastDay(mk);
      if (end > today) end = today;
      var r = netWorth(d, end, main, fx);
      return { mk: mk, tot: r.tot, missing: r.missing.length };
    });
  }

  // ---------- 5. Currencies ----------
  // Entry fields: oc (original currency, ≠ main) and oa (original
  // cents); `a` stays the amount in the main currency, so totals,
  // limits and envelopes (and older devices) read it unchanged.
  var CUR_RE = /^[A-Z]{3}$/;
  function okCur(c) { return typeof c === "string" && CUR_RE.test(c); }

  // ---------- 6. Receipts ----------
  // Names "YYYYMMDD-<entry id>-<random>.jpg|pdf" under RC_DIR on the
  // orOS disk; the entry keeps them in `rc` as ONE string (names
  // separated by a space, at most RC_MAX): a flat field, which an
  // older Budget carries along untouched.
  var RC_DIR = "/internal/Budget/Receipts";
  var RC_RE = /^\d{8}-[a-z0-9-]{1,64}-[a-z0-9]{4,12}\.(jpg|pdf)$/;
  var RC_MAX = 3;
  function rcList(s) {
    var out = [];
    if (typeof s !== "string") return out;
    s.split(" ").forEach(function (n) { if (RC_RE.test(n) && out.indexOf(n) < 0 && out.length < RC_MAX) out.push(n); });
    return out.sort(cmpStr);
  }
  function rcJoin(list) { return rcList((list || []).join(" ")).join(" "); }
  function rcName(ymd, id, rnd, ext) {
    if (!okYmd(ymd) || typeof id !== "string" || !ID_RE.test(id)) return null;
    var r = typeof rnd === "string" ? rnd.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) : "";
    if (r.length < 4 || (ext !== "jpg" && ext !== "pdf")) return null;
    var n = ymd.replace(/-/g, "") + "-" + id + "-" + r + "." + ext;
    return RC_RE.test(n) ? n : null;
  }
  function rcPath(name) { return typeof name === "string" && RC_RE.test(name) ? RC_DIR + "/" + name : null; }
  function rcAll(d) {
    var all = [];
    (d.tx || []).forEach(function (x) { rcList(x.rc).forEach(function (n) { all.push(n); }); });
    return all;
  }
  // A PDF starts with "%PDF-" (bytes 25 50 44 46 2D).
  function isPdfHead(bytes) {
    return !!bytes && bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2D;
  }
  // The total of a receipt from its text (pasted, or from a phone's
  // "copy text from photo"): the amount on the last line that says
  // total / to pay (ΣΥΝΟΛΟ, ΠΛΗΡΩΤΕΟ, TOTAL, AMOUNT DUE…), never a VAT
  // line; else the largest amount with two decimals. → cents | null.
  var TOTAL_RE = /(πληρωτ|συνολ|σύνολ|συν\.|total|amount due|to pay|gesamt|totale|montant|summe)/i;
  var VAT_RE = /(φ\.?π\.?α|vat|tax|mwst|iva|tva|καθαρ|net\b|subtotal|υποσυν)/i;
  var AMT_RE = /(\d{1,3}(?:[.,\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})(?!\d)/g;
  function amountOf(s) {
    var t = s.replace(/\s/g, "");
    var dec = t.charAt(t.length - 3);
    var int = t.slice(0, -3).replace(/[.,]/g, "");
    if (dec !== "." && dec !== ",") return null;
    var c = Number(int) * 100 + Number(t.slice(-2));
    return isInt(c) && c > 0 && c <= MAX_CENTS ? c : null;
  }
  function amountFromText(text) {
    if (typeof text !== "string" || !text) return null;
    var lines = text.slice(0, 20000).split(/\r?\n/);
    var best = null, biggest = null;
    lines.forEach(function (ln, i) {
      var found = [], m;
      AMT_RE.lastIndex = 0;
      while ((m = AMT_RE.exec(ln))) { var v = amountOf(m[1]); if (v !== null) found.push(v); }
      found.forEach(function (v) { if (biggest === null || v > biggest) biggest = v; });
      var low = ln.toLowerCase();
      if (!TOTAL_RE.test(low) || (VAT_RE.test(low) && !/πληρωτ|to pay|amount due/i.test(low))) return;
      if (!found.length && i + 1 < lines.length) {   // "TOTAL" on one line, the amount on the next
        AMT_RE.lastIndex = 0;
        while ((m = AMT_RE.exec(lines[i + 1]))) { var w = amountOf(m[1]); if (w !== null) found.push(w); }
      }
      if (found.length) best = found[found.length - 1];
    });
    return best !== null ? best : biggest;
  }

  var api = {
    MAX_CENTS: MAX_CENTS, RC_DIR: RC_DIR, RC_RE: RC_RE, RC_MAX: RC_MAX,
    okMk: okMk, mkAdd: mkAdd, mkDiff: mkDiff, addDays: addDays, dayDiff: dayDiff, lastDay: lastDay,
    asgId: asgId, envMonth: envMonth, moveMoney: moveMoney, goalStatus: goalStatus,
    nextCharge: nextCharge, monthlyCost: monthlyCost, yearlyCost: yearlyCost, normNd: normNd,
    subscriptions: subscriptions, subsDue: subsDue,
    yearReport: yearReport, balancesFx: balancesFx, netWorth: netWorth, netWorthSeries: netWorthSeries, entryIn: entryIn,
    okCur: okCur, rcList: rcList, rcJoin: rcJoin, rcName: rcName, rcPath: rcPath, rcAll: rcAll, isPdfHead: isPdfHead,
    amountFromText: amountFromText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetPlan = api;
})(typeof window !== "undefined" ? window : this);
