// ============================================================
// orOS CRM — rs.js (Revenue Splitter on the partner card, W6, v1.1.0)
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
//
// Contracts (RS-CTR, Revenue Splitter 1.14+, 1.1.0): the Author Portal
// shows each beneficiary their contracts (the list: crm/core.js
// portalPlan, sent by CRM) and lets them ask for a talk about a
// renewal. CRM pulls the requests while it is open (GET
// /rs/contract-requests?state=new), then marks each one "oros" once it
// is in CRM, and "closed" once its follow-up is done or deleted.
//   reqPushCtr(body), REQ_CTR, REQ_RQ_NEW, REQ_RQ_OROS, reqMark(id, state)
//   parseSaved(json) → { saved, skipped: [{ id, why }] } | null
//   parseRequests(json) → [{ id, ctr, ben, title, at, note, state }] | null
//   rqIds(shopId, reqId) → { fup, act }: the same ids on every device
//   importPlan(data, shopId, firstShopId, reqs) → [{ req, cust, ctr,
//     ids, have }] (have = already in CRM) + left: [req] (no partner)
//   closeList(data, shopId, reqs) → [request id] whose follow-up is done
//     or was deleted
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

  // ---------- Contracts (RS-CTR) ----------
  var RQ_ID = /^[A-Za-z0-9_-]{1,64}$/, MAX_RQ = 500;
  var REQ_CTR = { m: "GET", path: "/rs/contracts" };
  var REQ_RQ_NEW = { m: "GET", path: "/rs/contract-requests?state=new" };
  var REQ_RQ_OROS = { m: "GET", path: "/rs/contract-requests?state=oros" };
  function reqPushCtr(body) { return { m: "POST", path: "/rs/contracts", body: body }; }
  function reqMark(id, state) { return { m: "POST", path: "/rs/contract-requests/" + id, body: { state: state } }; }
  var WHY = ["bad_id", "duplicate_id", "unknown_beneficiary", "bad_title", "bad_fmt", "bad_date", "bad_state", "bad_renewed", "bad_item"];
  function parseSaved(j) {
    if (!j || typeof j !== "object" || !isInt(j.saved) || j.saved < 0) return null;
    var skipped = [];
    (Array.isArray(j.skipped) ? j.skipped : []).slice(0, 2000).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      skipped.push({ id: text(x.id, 64), why: WHY.indexOf(x.why) >= 0 ? x.why : "bad_item" });
    });
    return { saved: j.saved, skipped: skipped };
  }
  function parseRequests(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.requests)) return null;
    var out = [];
    j.requests.slice(0, MAX_RQ).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var id = typeof r.id === "number" && isInt(r.id) && r.id > 0 ? String(r.id) : (typeof r.id === "string" ? r.id : "");
      if (!RQ_ID.test(id)) return;
      var at = Date.parse(typeof r.at === "string" ? r.at : "");
      out.push({ id: id, ctr: typeof r.contract_id === "string" ? text(r.contract_id, 64) : "", ben: text(r.ben, 120),
                 title: text(r.title, 200), at: isFinite(at) && at > 0 ? at : 0,
                 note: typeof r.note === "string" ? r.note.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, 500) : "",
                 state: ["new", "oros", "closed"].indexOf(r.state) >= 0 ? r.state : "new" });
    });
    return out;
  }
  // FNV-1a, two seeds → base36: the same request gets the same follow-up
  // and activity ids on every device, so two devices pulling at once
  // keep one copy, and one pulled again is seen as done
  function h32(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rqIds(shopId, reqId) {
    var s = String(shopId) + "|rsrq|" + String(reqId);
    var a = h32(s, 2166136261).toString(36), b = h32(s, 3735928559).toString(36);
    return { fup: "rqf" + a + b, act: "rqa" + a + b };
  }
  function importPlan(data, shopId, firstShopId, reqs) {
    var plan = [], left = [], tombs = (data && data.tombs) || {};
    (reqs || []).forEach(function (q) {
      var k = q.ctr ? CC.byId(data.ctr || [], q.ctr) : null, cust = null;
      if (k && !tombs[k.id]) cust = CC.byId(data.cust, k.cust);
      else k = null;
      if (!cust && q.ben) {
        (data.rsl || []).some(function (r) {
          if (!r.n || r.n.indexOf(q.ben) < 0 || (r.a || firstShopId || "") !== shopId) return false;
          cust = CC.byId(data.cust, r.id);
          return !!cust;
        });
      }
      if (!cust || tombs[cust.id]) { left.push(q); return; }
      var ids = rqIds(shopId, q.id);
      var have = !!(CC.byId(data.fups || [], ids.fup) || tombs[ids.fup] || CC.byId(data.acts || [], ids.act) || tombs[ids.act]);
      plan.push({ req: q, cust: cust, ctr: k, ids: ids, have: have });
    });
    return { plan: plan, left: left };
  }
  function closeList(data, shopId, reqs) {
    var out = [], tombs = (data && data.tombs) || {};
    (reqs || []).forEach(function (q) {
      if (q.state !== "oros") return;
      var ids = rqIds(shopId, q.id), f = CC.byId(data.fups || [], ids.fup);
      if ((f && f.done) || (!f && tombs[ids.fup])) out.push(q.id);
    });
    return out;
  }

  var API = { REQ_BAL: REQ_BAL, reqReport: reqReport, parseBal: parseBal, parseRep: parseRep, card: card, suggest: suggest,
              REQ_CTR: REQ_CTR, REQ_RQ_NEW: REQ_RQ_NEW, REQ_RQ_OROS: REQ_RQ_OROS, reqPushCtr: reqPushCtr, reqMark: reqMark,
              parseSaved: parseSaved, parseRequests: parseRequests, rqIds: rqIds, importPlan: importPlan, closeList: closeList };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmRs = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
