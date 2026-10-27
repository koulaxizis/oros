// ============================================================
// orOS Budget — linked entries (budget/links.js, v1.0.0, BR-B3)
// Entries that another app keeps in Budget for you, with no form:
// the first source is Invoices ("a payment recorded in Invoices is
// income here"). Budget READS the source app's synced data (never
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
// A source row: { key, m, a, d, n, crm? } (income) or { key, m, del: 1 }.
//
// Pure (Node tests, window.OrosBudgetLinks):
//   invoiceRows(inv, cur) → rows of Invoices payments marked `ab` (made
//     while "Payments go to Budget by themselves" was on), not sent by
//     hand (`bud`), in Budget's currency, on an invoice / receipt /
//     record that is not deleted or void
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
      if (!tx) {
        var x = { id: id, m: r.m, d: r.d, a: r.a, k: "i", c: "i-free", n: r.n, src: src };
        if (r.crm) x.crm = r.crm;
        put.push(x);
        return;
      }
      if (tx.m >= r.m) return;                   // edited here after the source: yours wins
      if (tx.a === r.a && tx.d === r.d) return;
      put.push(Object.assign({}, tx, { a: r.a, d: r.d, m: r.m }));
    });
    return { put: put, drop: drop };
  }

  var API = { invoiceRows: invoiceRows, plan: plan, txId: txId };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosBudgetLinks = API;
})(typeof window !== "undefined" ? window : this);
