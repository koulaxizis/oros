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
//     wo (true = written off / forgiven, closed) }
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
    return { id: x.id, m: x.m, a: x.a, ac: acOf(x.ac), crm: typeof x.crm === "string" && CRM_RE.test(x.crm) ? x.crm : "",
             d: x.d, due: okYmd(x.due) && x.due >= x.d ? x.due : "", k: x.k, n: n, nt: text(x.nt, 200), wo: x.wo === true };
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
  // Where loan `l` stands on `today`, given its repayments:
  // { paid, left (≥ 0), over (paid beyond the amount), pct (0–100),
  //   state "open" | "paid" | "off" (written off) | "late" (past due),
  //   last (day of the last repayment | "") }
  function status(l, pays, today) {
    var paid = 0, last = "";
    (pays || []).forEach(function (p) { paid += p.a; if (p.d > last) last = p.d; });
    var left = Math.max(0, l.a - paid);
    var state = l.wo ? "off" : left === 0 ? "paid" : l.due && today > l.due ? "late" : "open";
    return { paid: paid, left: left, over: Math.max(0, paid - l.a), pct: Math.min(100, Math.round(paid * 100 / l.a)), state: state, last: last };
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
              balanceMoves: balanceMoves, okYmd: okYmd };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetLoans = api;
})(typeof window !== "undefined" ? window : this);
