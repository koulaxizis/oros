// ============================================================
// orOS Connected services — payments (links/pay.js, v1.0.0)
// Pure: the requests that read a Stripe account's balance history,
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
      var id = L.extId("stripe", ctx.acct, kind, xid);
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
      var d = ymdLocal(x.at), label = x.desc || ctx.src + " · " + x.type;
      var gross = toCents(Math.abs(x.amount), x.cur);
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

  var api = { PAGE: PAGE, MAX: MAX, req: req, read: read, plan: plan };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksPay = api;
})(typeof window !== "undefined" ? window : this);
