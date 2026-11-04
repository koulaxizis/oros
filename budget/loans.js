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

  // ---------- CC-1: a credit card's monthly cycle ----------
  // An account may carry cys (statement day 1…31), cyd (due day 1…31)
  // and cyr (yearly interest in hundredths of a percent, 0…10000).
  function cardCfg(a) {
    if (!a || !isInt(a.cys) || a.cys < 1 || a.cys > 31 || !isInt(a.cyd) || a.cyd < 1 || a.cyd > 31) return null;
    return { s: a.cys, d: a.cyd, r: isInt(a.cyr) && a.cyr >= 0 && a.cyr <= 10000 ? a.cyr : 0 };
  }
  function dayIn(y, m0, day) {            // a day of a month, clamped to its end
    y += Math.floor(m0 / 12); m0 = ((m0 % 12) + 12) % 12;
    var dim = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    return y + "-" + pad2(m0 + 1) + "-" + pad2(Math.min(day, dim));
  }
  function daysBetween(a, b) {
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
                       Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
  }
  // The cycle as of `today`: the last statement (on or before today),
  // its due date, the next statement; what the statement asked for (the
  // debt on the statement day), what came into the account since, what
  // is left, and an estimate of the interest if that is not paid by the
  // due date (left × rate × the cycle's days / 365). balAt(ymd) → the
  // account's signed balance at the end of that day; inflow(from, to)
  // → money in after `from`, up to `to`. → null without a cycle, else
  // { s, due, next, stmt, paid, left, est, days (to the due date),
  //   state "none" | "paid" | "open" | "late" }
  function cardCycle(a, today, balAt, inflow) {
    var c = cardCfg(a);
    if (!c || !okYmd(today)) return null;
    var y = +today.slice(0, 4), m0 = +today.slice(5, 7) - 1;
    var s = dayIn(y, m0, c.s);
    if (s > today) { m0 -= 1; s = dayIn(y, m0, c.s); }
    var due = dayIn(y, m0, c.d);
    if (due <= s) due = dayIn(y, m0 + 1, c.d);
    var next = dayIn(y, m0 + 1, c.s);
    var b = balAt(s);
    var stmt = isInt(b) && b < 0 ? -b : 0;
    var paid = stmt ? Math.max(0, inflow(s, today) || 0) : 0;
    var left = Math.max(0, stmt - paid);
    var est = left && c.r ? Math.round(left * c.r / 10000 * daysBetween(s, next) / 365) : 0;
    var state = !stmt ? "none" : !left ? "paid" : today > due ? "late" : "open";
    return { s: s, due: due, next: next, stmt: stmt, paid: Math.min(paid, stmt), left: left, est: est,
             days: daysBetween(today, due), state: state };
  }

  // ---------- LN-F: numbers the person may not know ----------
  // The yearly rate (hundredths of a percent) that makes `ins` pay `a`
  // off in `nm` months; null when that is impossible or over 100 %.
  function solveRate(a, ins, nm) {
    if (!(a > 0 && ins > 0 && nm >= 1 && nm <= 600)) return null;
    if (ins * nm < a) return null;
    if (Math.abs(ins * nm - a) <= nm) return 0;            // within a cent per month: no interest
    var lo = 0, hi = 100 / 12 / 100, pay = function (i) { return a * i / (1 - Math.pow(1 + i, -nm)); };
    if (pay(hi) < ins) return null;
    for (var k = 0; k < 80; k++) { var mid = (lo + hi) / 2; if (pay(mid) < ins) lo = mid; else hi = mid; }
    return Math.round((lo + hi) / 2 * 12 * 10000);
  }
  // How many months `ins` takes to pay `a` off at `r`; null when it never does.
  function solveMonths(a, ins, r) {
    if (!(a > 0 && ins > 0)) return null;
    var i = (r || 0) / 10000 / 12;
    if (!i) return Math.ceil(a / ins);
    if (ins <= a * i) return null;
    var n = Math.ceil(-Math.log(1 - a * i / ins) / Math.log(1 + i) - 1e-9);
    return n >= 1 && n <= 600 ? n : null;
  }
  function noteKey(n) {
    return String(n || "").toLowerCase().replace(/[0-9]+/g, " ").replace(/[^a-z\u0370-\u03ff\u1f00-\u1fff]+/g, " ").trim().replace(/\s+/g, " ");
  }
  // Monthly series among expenses: the same note (digits left out) and
  // about the same amount (±3 %), 25–35 days apart, at least twice.
  // → [{ key, n (a note as written), a (the latest amount), count, first,
  //      last, day (usual day of the month), ac, loanish }] best first.
  var LOANISH = /(δανει|δάνει|δοσ|δόσ|loan|install|mortgage|στεγαστ|καταναλωτ|kredit|rate)/i;
  function findSeries(tx) {
    var groups = {};
    (tx || []).forEach(function (x) {
      if (!x || x.k !== "o" || !okYmd(x.d) || !(x.a > 0)) return;
      var k = noteKey(x.n);
      if (!k) return;
      (groups[k] = groups[k] || []).push(x);
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var list = groups[k].slice().sort(function (p, q) { return p.d < q.d ? -1 : p.d > q.d ? 1 : 0; });
      // the longest run from the end backwards: monthly, similar amounts
      var run = [list[list.length - 1]];
      for (var j = list.length - 2; j >= 0; j--) {
        var prev = run[0], x = list[j], gap = daysApart(x.d, prev.d);
        if (gap < 25) continue;                                // a second entry in the same month
        if (gap > 35 || Math.abs(x.a - prev.a) > prev.a * 0.03) break;
        run.unshift(x);
      }
      if (run.length < 2) return;
      var days = {}, best = 0, day = +run[run.length - 1].d.slice(8, 10);
      run.forEach(function (x) { var dd = +x.d.slice(8, 10); days[dd] = (days[dd] || 0) + 1; if (days[dd] > best) { best = days[dd]; day = dd; } });
      var last = run[run.length - 1];
      out.push({ key: k, n: last.n, a: last.a, count: run.length, first: run[0].d, last: last.d, day: day,
                 ac: last.ac || "", loanish: LOANISH.test(last.n || "") });
    });
    out.sort(function (p, q) { return (q.loanish - p.loanish) || (q.count - p.count) || (q.a - p.a) || (p.key < q.key ? -1 : 1); });
    return out;
  }
  function daysApart(a, b) { return Math.abs(daysBetween(a, b)); }
  // A card's cycle from what the account shows: the due day = the usual
  // day of the month money came in (payments), the statement day about
  // three weeks before it (Greek cards: 20–25 days), the rate from the
  // latest interest entry on the card over the debt the day before it.
  // inflows: [{ d, a }], interest: [{ d, a }] (expenses whose note says
  // interest), balAt(ymd) → signed balance. → { cyd, cys, cyr, from: { due, rate } } | null
  var INTEREST = /(τοκ|τόκ|interest|zins|finance charge)/i;
  function guessCycle(inflows, interest, balAt) {
    var out = { cyd: 0, cys: 0, cyr: 0, from: { due: 0, rate: "" } };
    var days = {}, best = 0;
    (inflows || []).forEach(function (x) {
      if (!x || !okYmd(x.d)) return;
      var dd = +x.d.slice(8, 10);
      days[dd] = (days[dd] || 0) + 1;
      if (days[dd] > best || (days[dd] === best && dd < out.cyd)) { best = days[dd]; out.cyd = dd; }
    });
    if (best) { out.from.due = best; out.cys = ((out.cyd - 21 - 1 + 31) % 31) + 1; }
    var last = null;
    (interest || []).forEach(function (x) { if (x && okYmd(x.d) && x.a > 0 && (!last || x.d > last.d)) last = x; });
    if (last && balAt) {
      var y = +last.d.slice(0, 4), m0 = +last.d.slice(5, 7) - 1, dd0 = +last.d.slice(8, 10);
      var before = dayIn(y, m0, dd0 - 1 >= 1 ? dd0 - 1 : 1);
      if (dd0 === 1) before = dayIn(y, m0 - 1, 31);
      var debt = -(balAt(before) || 0);
      if (debt > 0) {
        var r = Math.round(last.a / debt * 12 * 10000);
        if (r > 0 && r <= 10000) { out.cyr = r; out.from.rate = last.d; }
      }
    }
    return out.cyd || out.cyr ? out : null;
  }

  // ---------- RM-1: reminders the shell sends with Budget closed ----------
  // What falls due in the next `lead` days (default 3, today counts):
  // a loan's next scheduled installment and a card's unpaid statement.
  // raw = the stored Budget data; P = budget/plan.js (balances).
  // → [{ key, kind "loan" | "card", id, n, a (cents), next, days }]
  function remindersDue(raw, today, P, lead) {
    var out = [];
    lead = isInt(lead) ? lead : 3;
    if (!raw || !okYmd(today)) return out;
    var byLoan = paysBy(Array.isArray(raw.lpay) ? raw.lpay : []);
    (Array.isArray(raw.loan) ? raw.loan : []).forEach(function (x) {
      var l = normLoan(x);
      if (!l || l.wo || !hasPlan(l)) return;
      var sc = schedule(l, byLoan[l.id]);
      var r = sc.rows[0];
      if (!r) return;
      var dd = daysBetween(today, r.d);
      if (dd >= 0 && dd <= lead) out.push({ key: "loan:" + l.id + ":" + r.d, kind: "loan", id: l.id, n: l.n, a: r.pay, next: r.d, days: dd });
    });
    if (P && typeof P.balancesFx === "function") {
      var main = raw.set && typeof raw.set.cur === "string" ? raw.set.cur : "EUR";
      (Array.isArray(raw.acc) ? raw.acc : []).forEach(function (a) {
        if (!cardCfg(a)) return;
        var c = cardCycle(a, today, function (d) { var b = P.balancesFx(raw, d, main, null)[a.id]; return isInt(b) ? b : 0; },
          function (from, to) {
            var sum = 0;
            (raw.tx || []).forEach(function (t) { if (t && t.ac === a.id && t.k === "i" && t.d > from && t.d <= to) sum += t.a; });
            (raw.xfer || []).forEach(function (t) { if (t && t.t === a.id && t.d > from && t.d <= to) sum += isInt(t.ta) && t.ta > 0 ? t.ta : t.a; });
            return sum;
          });
        if (c && c.state === "open" && c.days >= 0 && c.days <= lead)
          out.push({ key: "card:" + a.id + ":" + c.due, kind: "card", id: a.id, n: a.n, a: c.left, next: c.due, days: c.days });
      });
    }
    return out;
  }

  // For Calendar: on `ymd` (today or later), each loan's scheduled
  // installment and each card's due day. → [{ kind, id, n, a (0 = unknown) }]
  function duesOn(raw, ymd, today) {
    var out = [];
    if (!raw || !okYmd(ymd) || (okYmd(today) && ymd < today)) return out;
    var byLoan = paysBy(Array.isArray(raw.lpay) ? raw.lpay : []);
    (Array.isArray(raw.loan) ? raw.loan : []).forEach(function (x) {
      var l = normLoan(x);
      if (!l || l.wo || !hasPlan(l)) return;
      schedule(l, byLoan[l.id]).rows.forEach(function (r) { if (r.d === ymd) out.push({ kind: "loan", id: l.id, n: l.n, a: r.pay }); });
    });
    (Array.isArray(raw.acc) ? raw.acc : []).forEach(function (a) {
      var c = cardCfg(a);
      if (c && dayIn(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, c.d) === ymd) out.push({ kind: "card", id: a.id, n: a.n, a: 0 });
    });
    return out;
  }

  var api = { normLoan: normLoan, normPay: normPay, paysBy: paysBy, status: status, summary: summary,
              balanceMoves: balanceMoves, okYmd: okYmd,
              hasPlan: hasPlan, installment: installment, split: split, schedule: schedule,
              cardCfg: cardCfg, cardCycle: cardCycle,
              solveRate: solveRate, solveMonths: solveMonths, findSeries: findSeries, guessCycle: guessCycle, INTEREST: INTEREST,
              remindersDue: remindersDue, duesOn: duesOn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetLoans = api;
})(typeof window !== "undefined" ? window : this);
