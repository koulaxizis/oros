// ============================================================
// orOS Budget — linked entries (budget/links.js, v1.1.0, BR-B3)
// Entries that another app keeps in Budget for you, with no form:
// Invoices ("a payment recorded in Invoices is income here") and,
// since 1.1.0, a shop's Production Ledger records (budget/shop.js
// reads them from the shop, "pl"). Budget READS the source app's synced data (never
// writes it) and makes, changes or removes its own entries to match,
// keyed by the source record, so:
//   - the id is fixed per source record ("l-<src>-<key>") and m is the
//     source record's own m: two devices that both do it write the
//     very same entry (no duplicate, no endless upload; as recurring
//     entries do with recTxId + utcMs);
//   - your own changes in Budget win: an entry you edited after the
//     source last changed (tx.m ≥ source m) is left as it is, and an
//     entry you deleted never comes back;
//   - a change at the source (amount, date) updates the amount and
//     date only (your category, note and account stay); a source
//     record that is gone removes the entry unless you edited it
//     afterwards.
// A source row: { key, m, a, d, n, k?, c?, crm? } or { key, m, del: 1 };
// k "o" makes an expense (default "i", income), c is the category a
// new entry gets (default i-free / o-other).
//
// Pure (Node tests, window.OrosBudgetLinks):
//   invoiceRows(inv, cur) → rows of Invoices payments marked `ab` (made
//     while "Payments go to Budget by themselves" was on), not sent by
//     hand (`bud`), in Budget's currency, on an invoice / receipt /
//     record that is not deleted or void
//   shopTag(site) → "s" + 7 letters from the shop's host: the same
//     shop gives the same ids whichever connection reads it
//   shopReq(from, to, page) → the request for one page of records
//   shopRows(records, tag, cats) → one income row per paid order
//     (products + shipping, VAT included: the money the customer paid)
//     and one row per ledger entry (expense, or income for off-site
//     sales), amounts gross (net + VAT) as the bank sees them
//   shopCheck(records, months) → [{ mk, k, want, got }]: months whose
//     own totals (the shop's "months") differ from the records read
//   plan(budget, src, rows) → { put: [tx…], drop: [{ id, m }] }
//   txId(src, key)
// Adding a source: a reader that returns rows, one line in SOURCES
// (budget.js linkSources). Nothing here is shown or sent anywhere.
// ============================================================
(function (root) {
  "use strict";

  var KEY_RE = /^[a-z0-9-]{1,40}$/;
  var SRC_RE = /^[a-z0-9]{1,20}$/;
  var MAX_CENTS = 100000000000;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isStamp(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v > 0; }
  function txId(src, key) { return "l-" + src + "-" + key; }
  function text(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  // ---------- Source: Invoices payments ----------
  var OWES = { inv: 1, rcpt: 1, ext: 1 };
  function invoiceRows(inv, cur) {
    if (!inv || typeof inv !== "object" || !Array.isArray(inv.pays) || !Array.isArray(inv.docs)) return [];
    var docs = {};
    inv.docs.forEach(function (d) { if (d && typeof d.id === "string") docs[d.id] = d; });
    var out = [];
    inv.pays.forEach(function (p) {
      if (!p || typeof p.id !== "string" || !KEY_RE.test(p.id) || !isStamp(p.m)) return;
      if (p.del) { out.push({ key: p.id, m: p.m, del: 1 }); return; }
      if (p.ab !== 1 || p.bud === 1) return;
      var d = docs[p.doc];
      // the invoice is gone (deleted / voided): so is its income here
      if (!d || d.del || d.st === "void") {
        if (d && isStamp(d.m)) out.push({ key: p.id, m: Math.max(p.m, d.m), del: 1 });
        return;
      }
      if (!OWES[d.kind] || d.cur !== cur) return;
      if (typeof p.amt !== "number" || Math.floor(p.amt) !== p.amt || p.amt <= 0 || p.amt > MAX_CENTS) return;
      if (typeof p.date !== "string" || !DAY_RE.test(p.date)) return;
      var who = d.c && typeof d.c === "object" ? text(d.c.name, 80) : "";
      var row = { key: p.id, m: p.m, a: p.amt, d: p.date, n: text((d.num || "") + (who ? " · " + who : ""), 140) };
      var crm = typeof d.crm === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(d.crm) ? d.crm : "";
      if (crm) row.crm = crm;
      out.push(row);
    });
    return out;
  }

  // ---------- Source: shop records (Production Ledger, noxpress) ----------
  // GET /wc/v3/pl/records (links/core.js ALLOW.woo, read only). Record
  // ids: o<order>-p<product>, o<order>-s (shipping), e<entry>; a = net,
  // v = VAT, integer cents; del 1 = no longer counts (cancelled or
  // refunded order, deleted / historical / test entry).
  var REC_RE = /^(?:o(\d{1,12})-(?:p\d{1,12}|s)|e(\d{1,12}))$/;
  var TAG_RE = /^s[a-z0-9]{7}$/;
  function fnv(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function shopTag(site) {
    var host = String(site || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[\/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
    if (!host) return "";
    return "s" + ("0000000" + fnv(host).toString(36)).slice(-7);
  }
  function shopReq(from, to, page) {
    var q = [];
    if (DAY_RE.test(from || "")) q.push("from=" + from);
    if (DAY_RE.test(to || "")) q.push("to=" + to);
    q.push("page=" + (isStamp(page) && page < 10000 ? page : 1), "per_page=500");
    return { m: "GET", path: "/pl/records?" + q.join("&") };
  }
  function cents(v) { return typeof v === "number" && Math.floor(v) === v && v >= 0 && v <= MAX_CENTS ? v : -1; }
  function shopRows(recs, tag, cats) {
    if (!Array.isArray(recs) || !TAG_RE.test(tag || "")) return [];
    var ci = cats && typeof cats.i === "string" ? cats.i : "", co = cats && typeof cats.o === "string" ? cats.o : "";
    var orders = {}, order = [], out = [];
    recs.forEach(function (r) {
      if (!r || typeof r.id !== "string" || !isStamp(r.m)) return;
      var mt = REC_RE.exec(r.id);
      if (!mt) return;
      if (mt[1]) {
        var o = orders[mt[1]];
        if (!o) { o = orders[mt[1]] = { id: mt[1], m: 0, a: 0, d: "", n: "", bad: false }; order.push(o); }
        o.m = Math.max(o.m, r.m);
        if (r.del) return;
        var a = cents(r.a), v = cents(r.v);
        if (r.k !== "i" || a < 0 || v < 0 || !DAY_RE.test(r.d || "")) { o.bad = true; return; }
        o.a += a + v;
        if (!o.d) o.d = r.d;
        if (!o.n) o.n = text("#" + (text(r.number, 20) || mt[1]) + (r.pmt || r.pm ? " · " + (text(r.pmt, 60) || text(r.pm, 40)) : ""), 140);
        return;
      }
      var key = tag + "-e" + mt[2];
      if (r.del || r.t === 1) { out.push({ key: key, m: r.m, del: 1 }); return; }
      var ea = cents(r.a), ev = cents(r.v);
      if (ea < 0 || ev < 0 || ea + ev <= 0 || ea + ev > MAX_CENTS || !DAY_RE.test(r.d || "")) return;
      var k = r.k === "i" ? "i" : "o";
      var parts = [text(r.supplier, 60), text(r.inv, 40), text(r.note, 100) || text(r.title, 100)].filter(function (x) { return x; });
      var row = { key: key, m: r.m, a: ea + ev, d: r.d, n: text(parts.join(" · "), 140), k: k };
      var c = k === "o" ? co : ci;
      if (c) row.c = c;
      out.push(row);
    });
    order.forEach(function (o) {
      var key = tag + "-o" + o.id;
      if (o.bad) return;                          // a row we can't read: leave the order as it is
      if (o.a <= 0 || o.a > MAX_CENTS || !o.d) { out.push({ key: key, m: o.m, del: 1 }); return; }
      var row = { key: key, m: o.m, a: o.a, d: o.d, n: o.n, k: "i" };
      if (ci) row.c = ci;
      out.push(row);
    });
    return out.filter(function (r) { return KEY_RE.test(r.key); });
  }
  function shopCheck(recs, months) {
    var got = {}, bad = [];
    (Array.isArray(recs) ? recs : []).forEach(function (r) {
      if (!r || r.del || r.t === 1 || !DAY_RE.test(r.d || "")) return;
      var a = cents(r.a), v = cents(r.v);
      if (a < 0 || v < 0) return;
      var g = (got[r.d.slice(0, 7)] = got[r.d.slice(0, 7)] || { i: 0, o: 0 });
      g[r.k === "i" ? "i" : "o"] += a + v;
    });
    var mo = months && typeof months === "object" && !Array.isArray(months) ? months : {};
    var keys = {};
    Object.keys(mo).concat(Object.keys(got)).forEach(function (mk) { if (/^\d{4}-\d{2}$/.test(mk)) keys[mk] = 1; });
    Object.keys(keys).sort().forEach(function (mk) {
      var w = mo[mk] || {}, g = got[mk] || { i: 0, o: 0 };
      var num = function (x) { return typeof x === "number" && isFinite(x) ? x : 0; };
      var want = { i: num(w.income_net) + num(w.income_vat), o: num(w.expense_net) + num(w.expense_vat) };
      ["i", "o"].forEach(function (k) { if (want[k] !== g[k]) bad.push({ mk: mk, k: k, want: want[k], got: g[k] }); });
    });
    return bad;
  }

  // ---------- Reconcile ----------
  function plan(budget, src, rows) {
    var put = [], drop = [];
    if (!budget || !Array.isArray(budget.tx) || !SRC_RE.test(src)) return { put: put, drop: drop };
    var tombs = budget.tombs && typeof budget.tombs === "object" ? budget.tombs : {};
    var have = {};
    budget.tx.forEach(function (x) { if (x && x.id) have[x.id] = x; });
    (rows || []).forEach(function (r) {
      if (!r || !KEY_RE.test(r.key) || !isStamp(r.m)) return;
      var id = txId(src, r.key), tx = have[id], tomb = tombs["tx:" + id] || 0;
      if (r.del) {
        if (tx && tx.m < r.m) drop.push({ id: id, m: r.m });
        return;
      }
      if (!tx && tomb) return;                   // deleted in Budget: stays deleted
      var k = r.k === "o" ? "o" : "i";
      if (!tx) {
        var x = { id: id, m: r.m, d: r.d, a: r.a, k: k, c: typeof r.c === "string" && r.c ? r.c : (k === "o" ? "o-other" : "i-free"), n: r.n, src: src };
        if (r.crm) x.crm = r.crm;
        put.push(x);
        return;
      }
      if (tx.m >= r.m) return;                   // edited here after the source: yours wins
      if (tx.a === r.a && tx.d === r.d && tx.k === k) return;
      var upd = Object.assign({}, tx, { a: r.a, d: r.d, k: k, m: r.m });
      if (tx.k !== k) upd.c = typeof r.c === "string" && r.c ? r.c : (k === "o" ? "o-other" : "i-free");   // a category of the other kind can't stay
      put.push(upd);
    });
    return { put: put, drop: drop };
  }

  var API = { invoiceRows: invoiceRows, shopTag: shopTag, shopReq: shopReq, shopRows: shopRows, shopCheck: shopCheck, plan: plan, txId: txId };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosBudgetLinks = API;
})(typeof window !== "undefined" ? window : this);
