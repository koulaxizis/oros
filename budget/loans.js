// ============================================================
// orOS Budget — Loans and debts core (budget/loans.js)
// Money you lent to someone or borrowed from someone, and what has
// been paid back so far. A loan moves money between you and the
// person, like a transfer: it is neither income nor expense. With an
// account it changes that account's balance (lent: out, borrowed: in;
// repayments the other way). Writing a loan off (or having it
// forgiven) is a one-time entry the UI adds; the loan then closes.
// Pure: reads and cleans, never writes.
//   loan = { id, m, a (cents > 0), ac (account id | ""), crm (CRM
//     partner | ""), d (day lent/borrowed), due ("" | day), k "l" (I
//     lent) | "b" (I borrowed), n (person ≤ 60), nt (note ≤ 200),
//     wo (true = written off / forgiven, closed),
//     LN-I (2026-11-04, a bank loan): nm (number of monthly
//     installments 1…600), r (yearly interest in hundredths of a
//     percent, 0…10000: 4.75 % = 475), ins (the installment in cents,
//     0 = worked out as a fixed (annuity) installment); the three are
//     written only together, when nm > 0 }
//   lpay = { id, m, a (cents > 0), ac (account id | ""), d (day),
//     l (loan id), n (note ≤ 80) }
// Every field is always written, in name order after id and m (what
// an older Budget writes for collections it does not know).
// ============================================================
(function (root) {
  "use strict";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function utcMs(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
  function ymdUTC(ms) { var x = new Date(ms); return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate()); }
  var YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function okYmd(s) { return typeof s === "string" && YMD_RE.test(s) && ymdUTC(utcMs(s)) === s; }
  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var CRM_RE = /^[A-Za-z0-9_-]{1,60}$/;
  var MAX_CENTS = 100000000000;
  function text(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function head(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) && isInt(x.m) && x.m >= 0 &&
           isInt(x.a) && x.a > 0 && x.a <= MAX_CENTS && okYmd(x.d);
  }
  function acOf(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }

  // A stored loan, cleaned; null when it can't be one.
  function normLoan(x) {
    if (!head(x) || (x.k !== "l" && x.k !== "b")) return null;
    var n = text(x.n, 60);
    if (!n) return null;
    var plan = isInt(x.nm) && x.nm > 0 && x.nm <= 600;
    var out = { id: x.id, m: x.m, a: x.a, ac: acOf(x.ac), crm: typeof x.crm === "string" && CRM_RE.test(x.crm) ? x.crm : "",
                d: x.d, due: okYmd(x.due) && x.due >= x.d ? x.due : "" };
    if (plan) out.ins = isInt(x.ins) && x.ins > 0 && x.ins <= MAX_CENTS ? x.ins : 0;
    out.k = x.k;
    out.n = n;
    if (plan) out.nm = x.nm;
    out.nt = text(x.nt, 200);
    if (plan) out.r = isInt(x.r) && x.r >= 0 && x.r <= 10000 ? x.r : 0;
    out.wo = x.wo === true;
    return out;
  }
  // A stored repayment, cleaned; null when it can't be one.
  function normPay(x) {
    if (!head(x) || typeof x.l !== "string" || !ID_RE.test(x.l)) return null;
    return { id: x.id, m: x.m, a: x.a, ac: acOf(x.ac), d: x.d, l: x.l, n: text(x.n, 80) };
  }

  // Repayments of each loan: { loanId: [pay…] } (by day).
  function paysBy(pays) {
    var by = {};
    (pays || []).forEach(function (p) { (by[p.l] = by[p.l] || []).push(p); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : (x.id < y.id ? -1 : 1); }); });
    return by;
  }
  // ---------- LN-I: interest and installments ----------
  function hasPlan(l) { return !!l && isInt(l.nm) && l.nm > 0; }
  function monthly(l) { return hasPlan(l) ? (l.r || 0) / 10000 / 12 : 0; }
  // The monthly installment: the one typed, else a fixed (annuity)
  // installment over nm months; 0 without a plan.
  function installment(l) {
    if (!hasPlan(l)) return 0;
    if (l.ins) return l.ins;
    var i = monthly(l);
    if (!i) return Math.ceil(l.a / l.nm);
    return Math.round(l.a * i / (1 - Math.pow(1 + i, -l.nm)));
  }
  function monthNo(ymd) { return +ymd.slice(0, 4) * 12 + (+ymd.slice(5, 7) - 1); }
  // Each repayment split into interest and principal, in day order.
  // Interest is charged once per calendar month on what is still owed:
  // a repayment pays the interest of every month since the last one
  // that paid interest (the loan's own month counts as paid), the rest
  // goes to the principal. A second repayment in the same month is all
  // principal. → { rows: [{ p, int, prin, bal }], bal, int, prin }
  function split(l, pays) {
    var i = monthly(l), bal = l.a, last = monthNo(l.d), tInt = 0, tPrin = 0, rows = [];
    (pays || []).slice().sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : (x.id < y.id ? -1 : 1); }).forEach(function (p) {
      var mo = monthNo(p.d), it = 0;
      if (i && mo > last && bal > 0) { it = Math.min(p.a, Math.round(bal * (Math.pow(1 + i, mo - last) - 1))); last = mo; }
      else if (mo > last) last = mo;
      var pr = Math.min(bal, p.a - it);
      bal -= pr; tInt += it; tPrin += pr;
      rows.push({ p: p, int: it, prin: pr, bal: bal });
    });
    return { rows: rows, bal: bal, int: tInt, prin: tPrin };
  }
  function addMonths(ymd, n, day) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + "-" + pad2(m + 1) + "-" + pad2(Math.min(day, dim));
  }
  // What is still to come: one row a month on the loan's day of the
  // month, from the month after the last repayment (or after the loan),
  // the fixed installment, interest on what is owed, the rest
  // principal, the last row whatever is left. → { rows: [{ d, pay,
  // int, prin, bal }], end ("" none), never (the installment does not
  // even cover the interest) }
  function schedule(l, pays) {
    var out = { rows: [], end: "", never: false };
    if (!hasPlan(l)) return out;
    var sp = split(l, pays), bal = sp.bal, i = monthly(l), ins = installment(l);
    if (bal <= 0) return out;
    var lastD = sp.rows.length ? sp.rows[sp.rows.length - 1].p.d : l.d;
    var day = +l.d.slice(8, 10);
    for (var k = 1; k <= 600 && bal > 0; k++) {
      var it = Math.round(bal * i);
      var pay = Math.min(ins, bal + it);
      if (pay <= it && bal > 0) { out.never = true; break; }
      var pr = pay - it;
      bal -= pr;
      out.rows.push({ d: addMonths(lastD, k, day), pay: pay, int: it, prin: pr, bal: bal });
    }
    if (!out.never && out.rows.length) out.end = out.rows[out.rows.length - 1].d;
    return out;
  }

  // Where loan `l` stands on `today`, given its repayments:
  // { paid, left (≥ 0), over (paid beyond the amount), pct (0–100),
  //   state "open" | "paid" | "off" (written off) | "late" (past due),
  //   last (day of the last repayment | "") }
  // With a plan (LN-I): left = the principal still owed, int = the
  // interest paid so far, prin = the principal paid, pct by principal.
  function status(l, pays, today) {
    var paid = 0, last = "";
    (pays || []).forEach(function (p) { paid += p.a; if (p.d > last) last = p.d; });
    var left, over, int = 0, prin = paid;
    if (hasPlan(l)) {
      var sp = split(l, pays);
      left = sp.bal; int = sp.int; prin = sp.prin;
      over = Math.max(0, paid - int - l.a);
    } else {
      left = Math.max(0, l.a - paid);
      over = Math.max(0, paid - l.a);
    }
    var state = l.wo ? "off" : left === 0 ? "paid" : l.due && today > l.due ? "late" : "open";
    return { paid: paid, left: left, over: over, pct: Math.min(100, Math.round(prin * 100 / l.a)), state: state, last: last, int: int, prin: prin };
  }
  // What is still owed, both ways, over open loans (not written off):
  // { toMe, byMe, nToMe, nByMe }.
  function summary(loans, pays, today) {
    var by = paysBy(pays), r = { toMe: 0, byMe: 0, nToMe: 0, nByMe: 0 };
    (loans || []).forEach(function (l) {
      var s = status(l, by[l.id], today);
      if (s.state === "off" || !s.left) return;
      if (l.k === "l") { r.toMe += s.left; r.nToMe++; } else { r.byMe += s.left; r.nByMe++; }
    });
    return r;
  }
  // How loans move account balances up to `upto` (included):
  // { accountId: cents }. Lent: −a on its day, +each repayment;
  // borrowed: +a, −each repayment. Repayments of a deleted loan, or
  // without an account, move nothing.
  function balanceMoves(loans, pays, upto) {
    var mv = {}, kind = {};
    function add(ac, v) { if (ac) mv[ac] = (mv[ac] || 0) + v; }
    (loans || []).forEach(function (l) {
      kind[l.id] = l.k;
      if (l.d <= upto) add(l.ac, l.k === "l" ? -l.a : l.a);
    });
    (pays || []).forEach(function (p) {
      if (!kind[p.l] || p.d > upto) return;
      add(p.ac, kind[p.l] === "l" ? p.a : -p.a);
    });
    return mv;
  }

  var api = { normLoan: normLoan, normPay: normPay, paysBy: paysBy, status: status, summary: summary,
              balanceMoves: balanceMoves, okYmd: okYmd,
              hasPlan: hasPlan, installment: installment, split: split, schedule: schedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetLoans = api;
})(typeof window !== "undefined" ? window : this);
