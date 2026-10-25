// ============================================================
// orOS CRM — overview.js (the partner card's Overview, wave W2, v1.0.0)
// Pure: no DOM, no storage, no clock. Everything a partner has in
// other apps, in one object, from data the caller read through each
// app's own core (CRM never writes another app). Nothing here is
// stored: two devices can never disagree on a total.
//
// API (window.OrosCrmOverview, module.exports under Node):
//   build(x) → { money, shops, sups, work, pub, crm }
//     x = { data, cust, today "YYYY-MM-DD", nowMs, links: [{ k, v }],
//           inv?, I? (Invoices data + core), stock?, S? (Stock),
//           ts?, T? (Timesheet), pub? (Publishing data), alsoInv: [id] }
//   money.in  { CUR: { open, overdue } }   owed to you (Invoices)
//   money.out { CUR: cents }               owed by you (royalties due)
//   shops [{ id, name, products, q, value, cur, last, due }]
//         consignment shops: what is on their shelf (thousandths,
//         value at the products' sale price), the last settlement,
//         the day a settlement is due ("" = none due)
//   sups  [{ id, name, open, left, value, cur }] open purchase orders,
//         pieces still to come and their value at the order's cost
//   work  [{ id, name, ms, amount, cur }] billable, not yet billed
//         Timesheet hours of a linked client (all time)
//   pub   { titles: [{ id, t, r }], due: { CUR: cents }, adv: { CUR:
//         cents }, open: n } royalty statements not yet paid, and the
//         advance not yet earned back (from the latest statement)
//   crm   { last ms, next "YYYY-MM-DD"|"", deals n, val cents }
// ============================================================
(function (root) {
  "use strict";

  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;
  var LK = typeof module !== "undefined" && module.exports ? require("./links.js") : root.OrosCrmLinks;

  function add(map, cur, v) { if (v) map[cur] = (map[cur] || 0) + v; }

  function money(x) {
    var out = { "in": {}, out: {} };
    if (x.inv && x.I) {
      var tt = x.I.byCrm(x.inv, x.cust.id, x.today, x.alsoInv || []).totals;
      Object.keys(tt).forEach(function (cur) {
        if (tt[cur].open > 0) out["in"][cur] = { open: tt[cur].open, overdue: tt[cur].overdue };
      });
    }
    return out;
  }

  function shops(x) {
    var S = x.S, d = x.stock;
    if (!S || !d) return [];
    var ids = x.links.filter(function (l) { return l.k === "wh"; }).map(function (l) { return l.v; });
    if (!ids.length) return [];
    var all = S.whQty(d), price = {}, due = {};
    (d.items || []).forEach(function (it) { price[it.id] = it.price || 0; });
    S.consDue(d, x.today).forEach(function (r) { due[r.wh.id] = r.due; });
    var cur = (d.settings && d.settings.cur) || "EUR";
    return S.consList(d).filter(function (r) { return ids.indexOf(r.wh.id) >= 0; }).map(function (r) {
      var w = r.wh.id, products = 0, q = 0, value = 0;
      Object.keys(all).forEach(function (i) {
        var n = all[i][w] || 0;
        if (n <= 0) return;
        products++;
        q += n;
        value += Math.round(n / 1000 * (price[i] || 0));
      });
      return { id: w, name: r.cons.who || r.wh.name, products: products, q: q, value: value, cur: cur,
               last: S.lastSettle(d, w), due: due[w] || "" };
    });
  }

  function sups(x) {
    var S = x.S, d = x.stock;
    if (!S || !d) return [];
    var ids = x.links.filter(function (l) { return l.k === "sup"; }).map(function (l) { return l.v; });
    if (!ids.length) return [];
    var cur = (d.settings && d.settings.cur) || "EUR";
    return (d.sups || []).filter(function (s) { return ids.indexOf(s.id) >= 0; }).map(function (s) {
      var open = 0, left = 0, value = 0;
      S.poViews(d).forEach(function (v) {
        if (!v.open || v.po.sup !== s.id) return;
        open++;
        v.lines.forEach(function (l) {
          left += l.left;
          if (typeof l.c === "number") value += Math.round(l.left / 1000 * l.c);
        });
      });
      return { id: s.id, name: s.name, open: open, left: left, value: value, cur: cur };
    });
  }

  function work(x) {
    var T = x.T, d = x.ts;
    if (!T || !d) return [];
    var ids = x.links.filter(function (l) { return l.k === "tsc"; }).map(function (l) { return l.v; });
    var cur = (d.prefs && d.prefs.cur) || "EUR";
    return (d.clients || []).filter(function (c) { return !c.del && ids.indexOf(c.id) >= 0; }).map(function (c) {
      var r = T.report(d, "2000-01-01", x.today, { client: c.id, bill: "bill", billed: "open" }, x.nowMs);
      return { id: c.id, name: c.name, ms: r.total.billMs, amount: r.total.amount, cur: cur };
    });
  }

  function pub(x) {
    var out = { titles: [], due: {}, adv: {}, open: 0 };
    var d = x.pub;
    if (!d) return out;
    var keys = x.links.filter(function (l) { return l.k === "pub"; }).map(function (l) { return "pub:" + l.v; });
    out.titles = LK.pubTitles(d, x.cust.id, keys);
    // the names this partner goes by on the titles
    var names = {};
    keys.forEach(function (k) { names[k] = 1; });
    (d.titles || []).forEach(function (t) {
      (t.ppl || []).forEach(function (p) { if (p && p.crm === x.cust.id) names[CC.pubKey(p.n)] = 1; });
    });
    var latest = {};                        // per term (title + term id): the latest statement's left advance
    (d.stmts || []).forEach(function (s) {
      if (s.v === 1 || !names[CC.pubKey(s.n)]) return;
      if (!s.paid && s.due > 0) { add(out.due, s.cur, s.due); out.open++; }
      (s.rec || []).forEach(function (r) {
        var k = r.ti + "/" + r.tr, prev = latest[k];
        if (!prev || s.to > prev.to || (s.to === prev.to && s.id > prev.id)) latest[k] = { to: s.to, id: s.id, cur: s.cur, left: r.left };
      });
    });
    Object.keys(latest).forEach(function (k) { add(out.adv, latest[k].cur, latest[k].left); });
    return out;
  }

  function crm(x) {
    var c = x.cust, data = x.data, next = "", n = 0, val = 0;
    data.fups.forEach(function (f) { if (f.cust === c.id && !f.done && (!next || f.d < next)) next = f.d; });
    CC.openDeals(data, c.id).forEach(function (d) { n++; val += d.val; });
    return { last: CC.lastContact(data, c.id), next: next, deals: n, val: val };
  }

  function build(x) {
    var m = money(x), p = pub(x);
    Object.keys(p.due).forEach(function (cur) { add(m.out, cur, p.due[cur]); });
    return { money: m, shops: shops(x), sups: sups(x), work: work(x), pub: p, crm: crm(x) };
  }

  var API = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmOverview = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
