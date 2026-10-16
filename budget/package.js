// ============================================================
// orOS Budget — .orosbudget file (budget/package.js,
// window.OrosBudgetPackage). The descriptor of Budget for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every entry, category, limit, recurring entry, account, transfer,
// envelope, goal and import rule in one orOS bundle, the receipts in
// media/; opening one ADDS what this device lacks, with its ids. Pure
// (no DOM, no storage), so the app and `node --test` run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; budget.js then runs the
//                            result through its own commit, which is
//                            mergeBudget + save + sync dirty)
//   DESC.norm(data)          a file's data → the slice's shape with
//                            known fields only, typed and capped (the
//                            same checks as budget.js's normalisers)
//   DESC.strip(state)        the slice → { ver, tx, cats, bud, rec, acc,
//                            xfer, asg, goal, rule, set, rcs? }: no
//                            tombstones, no bank profiles (prof: how a
//                            bank's CSV reads and its account number /
//                            IBAN; they stay on the device)
//   DESC.tombIds(state)      the ids in state.tombs ("tx:<id>" → id)
//   DESC.previews(state, l)  entries.csv: the app's own CSV export
//                            (buildCsv, handed over by budget.js with
//                            useCsv; a byte-identical copy in Node)
//   rcs                      receipts: { "<file name>": "<sha256>.<ext>" },
//                            the media key of each receipt file an
//                            entry's `rc` names (Budget/Receipts on the
//                            orOS disk). Only names that carry their
//                            entry's own id are kept.
//   collOf(id, state)        the collections that hold a record id
//   COLLS, LIM, RC_DIR, RC_RE
// ============================================================
(function (root) {
  "use strict";

  var MAX_CENTS = 100000000000;
  var NOTE_LEN = 140, NAME_LEN = 30, GOAL_NAME = 40, RULE_Q = 60;
  var COLOR_SLOTS = 9;
  // per file; the app's own caps (60 categories, 20 accounts, 100
  // recurring entries) are kept when the records are added
  var LIM = { tx: 100000, cats: 200, bud: 300, rec: 300, acc: 100, xfer: 20000, asg: 20000, goal: 200, rule: 1000 };
  var COLLS = ["tx", "cats", "bud", "rec", "acc", "xfer", "asg", "goal", "rule"];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                    "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var RC_DIR = "/internal/Budget/Receipts";
  var RC_RE = /^\d{8}-[a-z0-9-]{1,64}-[a-z0-9]{4,12}\.(jpg|pdf)$/;
  var RC_MAX = 3;
  var KEY_RE = /^[0-9a-f]{64}\.(jpg|pdf)$/;

  var SEEDS = { "o-groc": "o", "o-eat": "o", "o-bills": "o", "o-home": "o", "o-trans": "o", "o-health": "o",
                "o-fun": "o", "o-cloth": "o", "o-gift": "o", "o-other": "o",
                "i-salary": "i", "i-free": "i", "i-gift": "i", "i-other": "i" };
  var SEED_COL = { "o-groc": 0, "o-eat": 1, "o-bills": 2, "o-home": 3, "o-trans": 4, "o-health": 5, "o-fun": 6,
                   "o-cloth": 7, "o-gift": 4, "o-other": 8, "i-salary": 2, "i-free": 0, "i-gift": 4, "i-other": 8 };
  var SEED_NAMES = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home",
          "o-trans": "Transport", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing",
          "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance",
          "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι",
          "o-trans": "Μεταφορές", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα",
          "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα",
          "i-gift": "Δώρα", "i-other": "Άλλα" }
  };
  // the CSV's words (budget.js "col.*", "k.*", "cat.none")
  var WORDS = {
    en: { date: "Date", type: "Type", cat: "Category", amount: "Amount", cur: "Currency", note: "Note", acc: "Account",
          out: "Expense", inc: "Income", none: "Uncategorized" },
    el: { date: "Ημερομηνία", type: "Τύπος", cat: "Κατηγορία", amount: "Ποσό", cur: "Νόμισμα", note: "Σημείωση",
          acc: "Λογαριασμός", out: "Έξοδο", inc: "Έσοδο", none: "Χωρίς κατηγορία" }
  };

  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var REC_ID_RE = /^[a-z0-9]{1,24}$/;
  var KINDS = { o: 1, i: 1 };
  var FREQS = { m: 1, w: 1, y: 1 };
  var CUR3_RE = /^[A-Z]{3}$/;
  var MK_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var SRC_TX_RE = /^[a-z0-9]{1,20}$/;
  var RC_STR_RE = /^[a-z0-9.-]+( [a-z0-9.-]+){0,2}$/;
  var XKEY_RE = /^[a-z][a-z0-9]{0,15}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hasId(x) { return isObj(x) && typeof x.id === "string" && ID_RE.test(x.id); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function okYmd(s) {
    var x = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!x) return false;
    var y = +x[1], m = +x[2], d = +x[3];
    return !(y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m));
  }
  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function okStamp(m) { return isInt(m) && m >= 0; }
  function okCents(a) { return isInt(a) && a > 0 && a <= MAX_CENTS; }
  function okCur3(c) { return typeof c === "string" && CUR3_RE.test(c); }
  function okRef(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }
  function colOr(v, d) { return isInt(v) && v >= 0 && v < COLOR_SLOTS ? v : d; }

  // Flat extras of a newer Budget, carried as budget.js carries them:
  // short lowercase names, small flat values, at most 16, in name order.
  function okExtra(v) {
    return (typeof v === "string" && v.length <= 500) || (typeof v === "number" && isFinite(v)) || typeof v === "boolean";
  }
  function withExtras(out, x, skip) {
    Object.keys(x).filter(function (k) {
      return !(k in out) && !(skip && skip[k]) && XKEY_RE.test(k) && okExtra(x[k]);
    }).sort(cmpStr).slice(0, 16).forEach(function (k) { out[k] = x[k]; });
    return out;
  }
  var AC_SKIP = { ac: 1 };
  function withAcc(out, x) {
    if (typeof x.ac === "string" && ID_RE.test(x.ac)) out.ac = x.ac;
    return out;
  }

  // ---------- the records (budget.js section 3) ----------
  // Receipt names of one entry: the ones that carry its own id
  // ("YYYYMMDD-<entry id>-<random>.jpg|pdf"), at most three.
  function rcOf(s, id) {
    var out = [];
    if (typeof s !== "string") return out;
    s.split(" ").forEach(function (n) {
      if (RC_RE.test(n) && n.slice(9, 10 + id.length) === id + "-" && out.indexOf(n) < 0 && out.length < RC_MAX) out.push(n);
    });
    return out.sort(cmpStr);
  }
  function normTx(x) {
    if (!hasId(x) || !okStamp(x.m) || !okYmd(x.d) || !okCents(x.a) || !KINDS[x.k]) return null;
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "__proto__") y[k] = x[k]; });
    if (!(typeof y.src === "string" && SRC_TX_RE.test(y.src))) delete y.src;
    var ot = normText(y.ot, NOTE_LEN);
    if (ot) y.ot = ot; else delete y.ot;
    var fit = normText(y.fit, 80);
    if (fit) y.fit = fit; else delete y.fit;
    if (!(okCur3(y.oc) && okCents(y.oa))) { delete y.oc; delete y.oa; }
    var rc = rcOf(y.rc, x.id).join(" ");
    if (rc && RC_STR_RE.test(rc)) y.rc = rc; else delete y.rc;
    return withExtras(withAcc({ id: x.id, m: x.m, d: x.d, a: x.a, k: x.k, c: okRef(x.c), n: normText(x.n, NOTE_LEN) }, x), y, AC_SKIP);
  }
  function normCat(x) {
    if (!hasId(x) || !okStamp(x.m) || !KINDS[x.k]) return null;
    var seed = SEEDS[x.id];
    if (seed && seed !== x.k) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name && !seed) return null;
    return withExtras({ id: x.id, m: x.m, k: x.k, name: name, col: colOr(x.col, seed ? SEED_COL[x.id] : 8) }, x);
  }
  function normBud(x) {
    if (!hasId(x) || !okStamp(x.m) || !isInt(x.a) || x.a < 0 || x.a > MAX_CENTS) return null;
    return withExtras({ id: x.id, m: x.m, a: x.a }, x);
  }
  function normRec(x) {
    if (!isObj(x) || typeof x.id !== "string" || !REC_ID_RE.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !KINDS[x.k] || !FREQS[x.f] || !okYmd(x.s)) return null;
    var e = okYmd(x.e) && x.e >= x.s ? x.e : "";
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "__proto__") y[k] = x[k]; });
    if (!(isInt(y.nd) && y.nd >= 0 && y.nd <= 30)) delete y.nd;
    return withExtras(withAcc({ id: x.id, m: x.m, k: x.k, a: x.a, c: okRef(x.c), n: normText(x.n, NOTE_LEN), f: x.f, s: x.s, e: e }, x), y, AC_SKIP);
  }
  function normAcc(x) {
    if (!hasId(x) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "__proto__") y[k] = x[k]; });
    if (!okCur3(y.cur)) delete y.cur;
    return withExtras({ id: x.id, m: x.m, n: n, o: isInt(x.o) && Math.abs(x.o) <= MAX_CENTS ? x.o : 0, col: colOr(x.col, 8) }, y);
  }
  function normXfer(x) {
    if (!hasId(x) || !okStamp(x.m) || !okYmd(x.d) || !okCents(x.a) || !okRef(x.f) || !okRef(x.t) || x.f === x.t) return null;
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "__proto__") y[k] = x[k]; });
    if (!okCents(y.ta)) delete y.ta;
    return withExtras({ id: x.id, m: x.m, d: x.d, a: x.a, f: x.f, t: x.t, n: normText(x.n, NOTE_LEN) }, y);
  }
  function normAsg(x) {
    if (!hasId(x) || !okStamp(x.m) || typeof x.mk !== "string" || !MK_RE.test(x.mk) || !isInt(x.a) || Math.abs(x.a) > MAX_CENTS) return null;
    var c = okRef(x.c);
    if (x.id !== x.mk.replace("-", "") + "-" + (c || "none")) return null;
    return withExtras({ id: x.id, m: x.m, a: x.a, c: c, mk: x.mk }, x);
  }
  function normGoal(x) {
    if (!hasId(x) || !okStamp(x.m) || !okCents(x.t)) return null;
    var n = normText(x.n, GOAL_NAME);
    if (!n) return null;
    return withExtras({ id: x.id, m: x.m, ac: okRef(x.ac), col: colOr(x.col, 2), d: okYmd(x.d) ? x.d : "", n: n,
      sv: isInt(x.sv) && x.sv >= 0 && x.sv <= MAX_CENTS ? x.sv : 0, t: x.t }, x);
  }
  // Import rule: plain user data ("bank text contains q → category c").
  function normRule(x) {
    if (!hasId(x) || !okStamp(x.m) || !KINDS[x.k] || !okRef(x.c)) return null;
    var q = normText(x.q, RULE_Q);
    var lo = isInt(x.lo) && x.lo > 0 && x.lo <= MAX_CENTS ? x.lo : 0;
    var hi = isInt(x.hi) && x.hi > 0 && x.hi <= MAX_CENTS ? x.hi : 0;
    if (lo && hi && hi < lo) hi = 0;
    if (!q && !lo && !hi) return null;
    return withExtras({ id: x.id, m: x.m, c: x.c, hi: hi, k: x.k, lo: lo, nt: normText(x.nt, 80), py: normText(x.py, RULE_Q), q: q }, x);
  }
  function normSet(x) {
    if (!isObj(x) || !okStamp(x.m)) return { m: 0, cur: "EUR" };
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "__proto__") y[k] = x[k]; });
    if (y.env !== true) delete y.env;
    if (!(typeof y.envs === "string" && MK_RE.test(y.envs))) delete y.envs;
    return withExtras({ m: x.m, cur: CURRENCIES.indexOf(x.cur) >= 0 ? x.cur : "EUR" }, y);
  }
  var NORM = { tx: normTx, cats: normCat, bud: normBud, rec: normRec, acc: normAcc, xfer: normXfer,
               asg: normAsg, goal: normGoal, rule: normRule };

  // receipts map: names some entry of `tx` names → a hash key of the same type
  function normRcs(rcs, tx) {
    var out = {}, used = {};
    if (!isObj(rcs)) return out;
    (tx || []).forEach(function (x) {
      if (x && typeof x.rc === "string") x.rc.split(" ").forEach(function (n) { used[n] = 1; });
    });
    Object.keys(rcs).sort(cmpStr).forEach(function (n) {
      var k = rcs[n];
      if (!used[n] || !RC_RE.test(n) || typeof k !== "string" || !KEY_RE.test(k)) return;
      if (n.split(".").pop() !== k.split(".").pop()) return;
      out[n] = k;
    });
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 1 };
    COLLS.forEach(function (c) {
      var seen = {};
      out[c] = [];
      (Array.isArray(data[c]) ? data[c] : []).slice(0, LIM[c] * 2).forEach(function (raw) {
        if (out[c].length >= LIM[c]) return;
        var x = NORM[c](raw);
        if (!x || seen[x.id]) return;
        seen[x.id] = 1;
        out[c].push(x);
      });
    });
    out.set = normSet(data.set);
    var rcs = normRcs(data.rcs, out.tx);
    if (Object.keys(rcs).length) out.rcs = rcs;
    if (isObj(data.tombs)) out.tombs = data.tombs;          // tombIds sees it, then strip drops it
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: 1 };
    COLLS.forEach(function (c) { out[c] = Array.isArray(s[c]) ? s[c] : []; });
    out.set = isObj(s.set) ? s.set : { m: 0, cur: "EUR" };
    var rcs = normRcs(s.rcs, out.tx);
    if (Object.keys(rcs).length) out.rcs = rcs;
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && isObj(state.tombs)) Object.keys(state.tombs).forEach(function (k) {
      var i = k.indexOf(":");
      if (i > 0) out.push(k.slice(i + 1));
    });
    return out;
  }

  // ---------- the CSV (budget.js section 5, the app's Export) ----------
  // A copy of budget.js's csvCell / centsPlain / buildCsv for Node;
  // budget.js hands over its own with useCsv (tests check they agree).
  function csvCell(v, sep) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function centsPlain(c, decSep) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? "-" : "") + Math.floor(a / 100) + decSep + pad2(a % 100);
  }
  function buildCsv(rows, fmt, cur, head, kindName) {
    var sep = fmt === "excel" ? ";" : ",", dec = fmt === "excel" ? "," : ".";
    var lines = [head.map(function (h) { return csvCell(h, sep); }).join(sep)];
    rows.forEach(function (r) {
      var cells = [r.d, csvCell(kindName(r.k), sep), csvCell(r.cat, sep),
                   centsPlain(r.k === "i" ? r.a : -r.a, dec), cur, csvCell(r.n, sep)];
      if (head.length > 6) cells.push(csvCell(r.acc || "", sep));
      lines.push(cells.join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  var csvFn = buildCsv;
  function useCsv(fn) { csvFn = typeof fn === "function" ? fn : buildCsv; }

  // entries.csv: every entry, as the app's Export → CSV → All writes it
  // (Greek: the Excel layout, ";" and "12,50"; English: "," and "12.50")
  function previews(state, lang) {
    var el = lang === "el", W = WORDS[el ? "el" : "en"], names = SEED_NAMES[el ? "el" : "en"];
    var s = isObj(state) ? state : {}, cats = {}, accs = {};
    (s.cats || []).forEach(function (c) { cats[c.id] = c.name || names[c.id] || c.id; });
    (s.acc || []).forEach(function (a) { accs[a.id] = a.n; });
    function catName(id) { return !id ? W.none : (cats[id] || names[id] || W.none); }
    var tx = (s.tx || []).slice().sort(function (a, b) { return cmpStr(a.d, b.d) || a.m - b.m || cmpStr(a.id, b.id); });
    if (!tx.length) return {};
    var rows = tx.map(function (x) { return { d: x.d, k: x.k, cat: catName(x.c), a: x.a, n: x.n, c: x.c, acc: x.ac ? accs[x.ac] || "" : "" }; });
    var head = [W.date, W.type, W.cat, W.amount, W.cur, W.note];
    if ((s.acc || []).length) head.push(W.acc);
    var cur = isObj(s.set) && typeof s.set.cur === "string" ? s.set.cur : "EUR";
    return { "entries.csv": csvFn(rows, el ? "excel" : "std", cur, head, function (k) { return k === "i" ? W.inc : W.out; }) };
  }

  // The collections of a state that hold a record with this id.
  function collOf(id, state) {
    var s = isObj(state) ? state : {};
    return COLLS.filter(function (c) {
      return Array.isArray(s[c]) && s[c].some(function (x) { return x && x.id === id; });
    });
  }

  var DESC = {
    app: "budget", title: "Budget", slice: "budget", ext: ".orosbudget", mime: "application/x-oros-budget",
    colls: {
      tx: { shape: "array", id: "id", stamp: "m" },
      cats: { shape: "array", id: "id", stamp: "m" },
      bud: { shape: "array", id: "id", stamp: "m" },
      rec: { shape: "array", id: "id", stamp: "m" },
      acc: { shape: "array", id: "id", stamp: "m" },
      xfer: { shape: "array", id: "id", stamp: "m" },
      asg: { shape: "array", id: "id", stamp: "m" },
      goal: { shape: "array", id: "id", stamp: "m" },
      rule: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, COLLS: COLLS, LIM: LIM, RC_DIR: RC_DIR, RC_RE: RC_RE, KEY_RE: KEY_RE,
              collOf: collOf, rcOf: rcOf, buildCsv: buildCsv, useCsv: useCsv };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosBudgetPackage = api;
})(this);
