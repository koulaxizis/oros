// ============================================================
// orOS CRM — overview.js (the partner card's Overview, wave W2, v1.0.0)
// Pure: no DOM, no storage, no clock. Everything a partner has in
// other apps, in one object, from data the caller read through each
// app's own core (CRM never writes another app). Nothing here is
// stored: two devices can never disagree on a total.
//
// API (window.OrosCrmOverview, module.exports under Node):
//   build(x) → { money, bills, shops, sups, work, pub, crm, budget }
//     x = { data, cust, today "YYYY-MM-DD", nowMs, links: [{ k, v }],
//           inv?, I? (Invoices data + core), stock?, S? (Stock),
//           ts?, T? (Timesheet), pub? (Publishing data), bud? (Budget
//           data), alsoInv: [id] }
//   money.in  { CUR: { open, overdue } }   owed to you (Invoices)
//   money.out { CUR: cents }               owed by you (received invoices
//                                          still open + royalties due)
//   bills { n, last "YYYY-MM-DD"|"", open: { CUR: { open, overdue, n } } }
//         received invoices of this partner (Invoices wave 7): the
//         bill names the crm id, or none and the supplier's ΑΦΜ is the
//         record's
//   shops [{ id, name, products, q, value, cur, last, due, unbilled }]
//         consignment shops: what is on their shelf (thousandths,
//         value at the products' sale price), the last settlement,
//         the day a settlement is due ("" = none due), and unbilled
//         { n, value, moves: [{ id, d }] }: settlements (sold pieces) that no invoice was
//         made from (Invoices doc src "stock:cons-<movement>", wave 7;
//         only settlements recorded since SRC_SINCE, older invoices
//         carry no source), valued at sale price less the shop's discount
//   sups  [{ id, name, open, left, value, cur }] open purchase orders,
//         pieces still to come and their value at the order's cost
//   work  [{ id, name, ms, amount, cur }] billable, not yet billed
//         Timesheet hours of a linked client (all time)
//   pub   { titles: [{ id, t, r }], due: { CUR: cents }, adv: { CUR:
//         cents }, open: n } royalty statements not yet paid, and the
//         advance not yet earned back (from the latest statement)
//   crm   { last ms, next "YYYY-MM-DD"|"", deals n, val cents }
//   budget { n, last "YYYY-MM-DD"|"", cur, year: { i, o }, all: { i, o } }
//         Budget entries that name this partner (tx.crm, BR-CRM-LINK),
//         income and expenses in Budget's main currency, this calendar
//         year and all time (x.bud = Budget's stored data, read as is)
// ============================================================
(function (root) {
  "use strict";

  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;
  var LK = typeof module !== "undefined" && module.exports ? require("./links.js") : root.OrosCrmLinks;

  function add(map, cur, v) { if (v) map[cur] = (map[cur] || 0) + v; }
  // Invoices stores where an invoice came from since this day (UTC ms)
  var SRC_SINCE = Date.UTC(2026, 9, 26);

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

  function bills(x) {
    var out = { n: 0, last: "", open: {} };
    if (!x.inv || !x.I || typeof x.I.billsByCrm !== "function") return out;
    var r = x.I.billsByCrm(x.inv, x.cust.id, x.today, x.cust.afm || "");
    out.n = r.rows.length;
    out.last = r.rows.length ? r.rows[0].date : "";
    r.rows.forEach(function (b) {
      if (b.bal <= 0) return;
      var t = out.open[b.cur] || (out.open[b.cur] = { open: 0, overdue: 0, n: 0 });
      t.open += b.bal;
      t.n++;
      if (b.status === "overdue") t.overdue += b.bal;
    });
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
      var unbilled = { n: 0, value: 0, moves: [] };
      if (x.I && typeof x.I.bySrc === "function") {   // no Invoices data yet: nothing was invoiced
        var inv = x.inv || { docs: [] };
        (d.moves || []).forEach(function (mv) {
          if (!mv || mv.v === 1 || mv.t !== "out" || mv.src !== "cons:" + w || !(mv.m >= SRC_SINCE)) return;
          if (x.I.bySrc(inv, "stock:cons-" + mv.id).length) return;
          unbilled.n++;
          unbilled.moves.push({ id: mv.id, d: mv.d });
          (mv.lines || []).forEach(function (l) {
            unbilled.value += Math.round(-l.q / 1000 * (l.p || 0) * (100 - (r.cons.disc || 0)) / 100);
          });
        });
      }
      return { id: w, name: r.cons.who || r.wh.name, products: products, q: q, value: value, cur: cur,
               last: S.lastSettle(d, w), due: due[w] || "", unbilled: unbilled };
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

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  function budget(x) {
    var out = { n: 0, last: "", cur: "EUR", year: { i: 0, o: 0 }, all: { i: 0, o: 0 } };
    var b = x.bud;
    if (!b || typeof b !== "object" || !Array.isArray(b.tx)) return out;
    if (b.set && typeof b.set.cur === "string" && /^[A-Z]{3}$/.test(b.set.cur)) out.cur = b.set.cur;
    var tombs = b.tombs && typeof b.tombs === "object" ? b.tombs : {}, y = String(x.today).slice(0, 4);
    b.tx.forEach(function (e) {
      if (!e || e.crm !== x.cust.id || typeof e.id !== "string" || !YMD_RE.test(e.d) || (e.k !== "i" && e.k !== "o")) return;
      if (typeof e.a !== "number" || Math.floor(e.a) !== e.a || e.a <= 0) return;
      if (typeof tombs["tx:" + e.id] === "number" && tombs["tx:" + e.id] >= e.m) return;
      out.n++;
      if (e.d > out.last) out.last = e.d;
      out.all[e.k] += e.a;
      if (e.d.slice(0, 4) === y) out.year[e.k] += e.a;
    });
    return out;
  }

  function crm(x) {
    var c = x.cust, data = x.data, next = "", n = 0, val = 0;
    data.fups.forEach(function (f) { if (f.cust === c.id && !f.done && (!next || f.d < next)) next = f.d; });
    CC.openDeals(data, c.id).forEach(function (d) { n++; val += d.val; });
    return { last: CC.lastContact(data, c.id), next: next, deals: n, val: val };
  }

  function build(x) {
    var m = money(x), p = pub(x), b = bills(x);
    Object.keys(b.open).forEach(function (cur) { add(m.out, cur, b.open[cur].open); });
    Object.keys(p.due).forEach(function (cur) { add(m.out, cur, p.due[cur]); });
    return { money: m, bills: b, shops: shops(x), sups: sups(x), work: work(x), pub: p, crm: crm(x), budget: budget(x) };
  }

  var API = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmOverview = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
