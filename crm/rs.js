// ============================================================
// orOS CRM — rs.js (Revenue Splitter on the partner card, W6, v1.0.0)
// Pure functions, no DOM, no storage, no clock. The shop's Revenue
// Splitter (noxpress, 1.11+) answers two read-only routes under its
// WooCommerce REST API, called through Connected services
// (links/core.js allowlist, relay/ext.js the same):
//   GET /rs/balances   per beneficiary, all time: sales share, other
//                      income, payments, remaining (integer cents)
//   GET /rs/report?date_start&date_end
//                      products sold in the period with their splits
//                      and current stock (cents)
// Names never go into a URL: the card asks for every beneficiary and
// picks its own here. Nothing read is stored; only the link (crm/core.js
// rsl: the beneficiary's exact name) is CRM data.
//
// API (window.OrosCrmRs, module.exports under Node):
//   REQ_BAL, reqReport(today) → the two requests (this calendar year)
//   parseBal(json) → { cur, since, ben: [{ name, sales, income,
//     payments, remaining }] } | null when it is not Revenue Splitter's
//   parseRep(json) → { cur, from, to, products: [{ id, title, qty, free,
//     net, stock, status, splits: [{ name, pct, amount }] }] } | null
//   card(bal, rep, names) → { cur, owed, sales, income, payments,
//     found: [name], missing: [name], titles: [{ id, title, qty, free,
//     share, pct, stock, status }], share } the partner's part
//   suggest(bal, cust, taken) → [{ name, why }] the shop's beneficiaries,
//     the ones whose name matches the partner (why "name" | "person")
//     first; taken = names linked to other partners (left out)
// ============================================================
(function (root) {
  "use strict";

  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;
  var CUR_RE = /^[A-Z]{3}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_BEN = 2000, MAX_PRODUCTS = 5000, MAX_SPLITS = 50;

  var REQ_BAL = { m: "GET", path: "/rs/balances" };
  function reqReport(today) {
    var to = DAY_RE.test(today || "") ? today : "";
    if (!to) return null;
    return { m: "GET", path: "/rs/report?date_start=" + to.slice(0, 4) + "-01-01&date_end=" + to };
  }

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cents(v) { return isInt(v) && Math.abs(v) <= 1e13 ? v : 0; }
  function text(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : ""; }
  function fold(s) { return CC.fold(String(s || "")).replace(/\s+/g, " ").trim(); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function parseBal(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.beneficiaries)) return null;
    var ben = [];
    j.beneficiaries.slice(0, MAX_BEN).forEach(function (b) {
      var name = b && text(b.name, 120);
      if (!name) return;
      ben.push({ name: name, sales: cents(b.sales), income: cents(b.income), payments: cents(b.payments), remaining: cents(b.remaining) });
    });
    return { cur: CUR_RE.test(j.currency) ? j.currency : "", since: DAY_RE.test(j.sales_since || "") ? j.sales_since : "", ben: ben };
  }

  function parseRep(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.products)) return null;
    var per = j.period && typeof j.period === "object" ? j.period : {};
    var products = [];
    j.products.slice(0, MAX_PRODUCTS).forEach(function (p) {
      if (!p || !isInt(p.product_id) || p.product_id <= 0) return;
      var splits = [];
      (Array.isArray(p.splits) ? p.splits : []).slice(0, MAX_SPLITS).forEach(function (s) {
        var name = s && text(s.name, 120);
        if (!name) return;
        var pct = typeof s.percent === "number" && isFinite(s.percent) && s.percent >= 0 && s.percent <= 100 ? s.percent : 0;
        splits.push({ name: name, pct: pct, amount: cents(s.amount) });
      });
      products.push({
        id: p.product_id, title: text(p.title, 200) || "#" + p.product_id,
        qty: isInt(p.qty) ? p.qty : 0, free: isInt(p.qty_free) ? p.qty_free : 0, net: cents(p.net),
        stock: isInt(p.stock) ? p.stock : null, status: text(p.stock_status, 20), splits: splits
      });
    });
    return { cur: CUR_RE.test(j.currency) ? j.currency : "", from: DAY_RE.test(per.start || "") ? per.start : "",
             to: DAY_RE.test(per.end || "") ? per.end : "", products: products };
  }

  function card(bal, rep, names) {
    var want = {};
    (names || []).forEach(function (n) { want[n] = 1; });
    var out = { cur: (bal && bal.cur) || (rep && rep.cur) || "", owed: 0, sales: 0, income: 0, payments: 0,
                found: [], missing: [], titles: [], share: 0 };
    var seen = {};
    (bal ? bal.ben : []).forEach(function (b) {
      if (!want[b.name] || seen[b.name]) return;
      seen[b.name] = 1;
      out.found.push(b.name);
      out.owed += b.remaining;
      out.sales += b.sales;
      out.income += b.income;
      out.payments += b.payments;
    });
    (names || []).forEach(function (n) { if (bal && !seen[n]) out.missing.push(n); });
    (rep ? rep.products : []).forEach(function (p) {
      var share = 0, pct = 0, mine = false;
      p.splits.forEach(function (s) {
        if (!want[s.name]) return;
        mine = true;
        share += s.amount;
        pct += s.pct;
      });
      if (!mine) return;
      out.share += share;
      out.titles.push({ id: p.id, title: p.title, qty: p.qty, free: p.free, share: share, pct: Math.round(pct * 100) / 100,
                        stock: p.stock, status: p.status });
    });
    out.titles.sort(function (a, b) { return b.share - a.share || b.qty - a.qty || cmp(fold(a.title), fold(b.title)) || a.id - b.id; });
    return out;
  }

  function suggest(bal, cust, taken) {
    var off = {};
    (taken || []).forEach(function (n) { off[n] = 1; });
    var mine = {}, ppl = {};
    if (cust) {
      [cust.name, cust.alias].forEach(function (n) { var f = fold(n); if (f) mine[f] = 1; });
      (cust.people || []).forEach(function (p) { var f = fold(p && p.n); if (f) ppl[f] = 1; });
    }
    var RANK = { name: 0, person: 1, "": 2 };
    return (bal ? bal.ben : []).filter(function (b) { return !off[b.name]; }).map(function (b) {
      var f = fold(b.name);
      return { name: b.name, why: mine[f] ? "name" : (ppl[f] ? "person" : "") };
    }).sort(function (a, b) { return RANK[a.why] - RANK[b.why] || cmp(fold(a.name), fold(b.name)) || cmp(a.name, b.name); });
  }

  var API = { REQ_BAL: REQ_BAL, reqReport: reqReport, parseBal: parseBal, parseRep: parseRep, card: card, suggest: suggest };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmRs = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
