// ============================================================
// orOS Connected services — payments (links/pay.js, v1.0.0)
// Pure: the requests that read a Stripe account's balance history (or
// an Invoice Ninja account's payments, wave 4C),
// what the answers mean, and the plan that brings them into Budget
// (integrations wave 4B). No DOM, no storage, no network;
// budget/payments.js makes the calls through the shell
// (orosLinks.call) and applies the plan.
//   req(fromSec, after) → one GET of /balance_transactions
//   read(data) → { items, next } (next "" = the last page)
//   plan(budget, items, ctx) → { add: [tx], same, gone, otherCur, skip }
// Read-only: nothing is ever written to Stripe. What moves money in
// or out of the business becomes a Budget entry:
//   charge / payment → income (gross), and its fee → an expense
//   refund / payment_refund / stripe_fee → an expense
//   adjustment / dispute → income or expense by its sign
//   payouts, transfers, top-ups, reserves → nothing (money moving
//   between Stripe and the bank is not income or an expense)
// Ids come from L.extId: the same transaction imported on two devices
// lands on the same entry (R16); an entry deleted in Budget is not
// brought back.
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PAGE = 100, MAX = 10000, NOTE = 140;
  var IN_TYPES = { charge: 1, payment: 1 };
  var OUT_TYPES = { refund: 1, payment_refund: 1, stripe_fee: 1 };
  var SIGN_TYPES = { adjustment: 1, dispute: 1 };
  // Stripe counts these in whole units, every other in hundredths
  var ZERO_DEC = ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"];
  var MAX_CENTS = 100000000000;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdLocal(sec) {
    var d = new Date(sec * 1000);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function req(fromSec, after) {
    var q = "?limit=" + PAGE;
    if (isInt(fromSec) && fromSec > 0) q += "&created[gte]=" + fromSec;
    if (after) q += "&starting_after=" + after;
    return { m: "GET", path: "/balance_transactions" + q };
  }

  function read(data) {
    var items = [];
    var list = data && Array.isArray(data.data) ? data.data : [];
    list.forEach(function (x) {
      if (!x || typeof x !== "object" || typeof x.id !== "string" || !/^txn_[A-Za-z0-9]{1,250}$/.test(x.id)) return;
      if (!isInt(x.amount) || !isInt(x.created) || x.created <= 0 || typeof x.currency !== "string" || !/^[a-z]{3}$/.test(x.currency)) return;
      items.push({
        xid: x.id, type: typeof x.type === "string" ? x.type : "", amount: x.amount,
        fee: isInt(x.fee) ? x.fee : 0, cur: x.currency.toUpperCase(), at: x.created,
        desc: L.cleanText(x.description, NOTE)
      });
    });
    var last = items.length ? items[items.length - 1].xid : "";
    return { items: items, next: data && data.has_more === true && last ? last : "" };
  }

  function toCents(n, cur) {
    var c = ZERO_DEC.indexOf(cur) >= 0 ? n * 100 : n;
    return c > 0 && c <= MAX_CENTS ? c : 0;
  }

  // budget: { tx: [{ id }], tombs: { "tx:<id>": ms }, cur }
  // ctx: { acct, src ("Stripe"), feeNote, catIn, catOut, ac }
  // → entries without m (the app stamps them)
  function plan(budget, items, ctx) {
    var have = {};
    (budget.tx || []).forEach(function (x) { have[x.id] = 1; });
    var tombs = budget.tombs || {};
    var out = { add: [], same: 0, gone: 0, otherCur: 0, skip: 0 };
    function entry(kind, xid, k, cents, d, n) {
      var id = L.extId(ctx.p || "stripe", ctx.acct, kind, xid);
      if (have[id]) { out.same++; return; }
      if (tombs["tx:" + id]) { out.gone++; return; }
      var e = { id: id, d: d, a: cents, k: k, c: k === "i" ? ctx.catIn || "" : ctx.catOut || "", n: L.cleanText(n, NOTE) };
      if (ctx.ac) e.ac = ctx.ac;
      have[id] = 1;
      out.add.push(e);
    }
    items.forEach(function (x) {
      var kind = IN_TYPES[x.type] ? "in" : OUT_TYPES[x.type] ? "out" : SIGN_TYPES[x.type] ? (x.amount > 0 ? "in" : "out") : "";
      if (!kind || x.amount === 0) { out.skip++; return; }
      if (x.cur !== budget.cur) { out.otherCur++; return; }
      var d = x.d || ymdLocal(x.at), label = x.desc || ctx.src + " · " + x.type;
      var gross = x.cents ? (x.amount > 0 && x.amount <= MAX_CENTS ? x.amount : 0) : toCents(Math.abs(x.amount), x.cur);
      if (!gross) { out.skip++; return; }
      entry("txn", x.xid, kind === "in" ? "i" : "o", gross, d, label);
      // a charge's fee is its own expense, so income stays the gross amount
      if (kind === "in" && x.fee > 0 && IN_TYPES[x.type]) {
        var fee = toCents(x.fee, x.cur);
        if (fee) entry("fee", x.xid, "o", fee, d, ctx.feeNote + (x.desc ? " · " + x.desc : ""));
      }
    });
    return out;
  }

  // ---------- Invoice Ninja (wave 4C) ----------
  // Payments received, net of refunds, as income. Currencies are ids
  // there: /statics names them.
  var IN_OK = { "4": 1, "5": 1, "6": 1, "-1": 1 };   // completed, partly / fully refunded, unapplied
  function inReq(kind, page) {
    if (kind === "statics") return { m: "GET", path: "/statics" };
    return { m: "GET", path: "/payments?per_page=" + PAGE + "&page=" + (page || 1) };
  }
  function inCurrencies(data) {
    var map = {};
    var list = data && Array.isArray(data.currencies) ? data.currencies : [];
    list.forEach(function (c) {
      if (c && (typeof c.id === "string" || typeof c.id === "number") && typeof c.code === "string" && /^[A-Z]{3}$/.test(c.code)) map[String(c.id)] = c.code;
    });
    return map;
  }
  function money(v) {
    var n = typeof v === "string" && /^-?[0-9]{1,12}(\.[0-9]{1,6})?$/.test(v.trim()) ? parseFloat(v) : (typeof v === "number" && isFinite(v) ? v : NaN);
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  // → { items, next } ; items from fromYmd on (the API has no date filter)
  function inRead(data, curMap, fromYmd) {
    var items = [];
    (data && Array.isArray(data.data) ? data.data : []).forEach(function (x) {
      if (!x || typeof x !== "object" || x.is_deleted === true) return;
      var id = typeof x.id === "string" && /^[A-Za-z0-9]{1,40}$/.test(x.id) ? x.id : "";
      var d = typeof x.date === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) ? x.date : "";
      if (!id || !d || (fromYmd && d < fromYmd) || !IN_OK[String(x.status_id)]) return;
      var net = money(x.amount) - money(x.refunded);
      if (net <= 0) return;
      var num = L.cleanText(x.number, 40), ref = L.cleanText(x.transaction_reference, 60);
      items.push({ xid: id, type: "payment", amount: net, cents: true, fee: 0, cur: curMap[String(x.currency_id)] || "?", d: d,
                   desc: ["Invoice Ninja", num ? "#" + num : "", ref].filter(Boolean).join(" · ") });
    });
    var pg = data && data.meta && data.meta.pagination;
    var cur = pg && typeof pg.current_page === "number" ? pg.current_page : 0;
    var tot = pg && typeof pg.total_pages === "number" ? pg.total_pages : 0;
    return { items: items, next: cur > 0 && cur < tot && cur < 1000 ? cur + 1 : 0 };
  }

  var api = { PAGE: PAGE, MAX: MAX, req: req, read: read, plan: plan, inReq: inReq, inCurrencies: inCurrencies, inRead: inRead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksPay = api;
})(typeof window !== "undefined" ? window : this);
