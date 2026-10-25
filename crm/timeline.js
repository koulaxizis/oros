// ============================================================
// orOS CRM — timeline.js (the partner card's one timeline, wave W3, v1.0.0)
// Pure: no DOM, no storage, no clock. Everything that happened with a
// partner, newest first, from CRM's own history and from the other
// apps' data the caller read through their own cores (CRM never
// writes another app). Nothing here is stored.
//
// API (window.OrosCrmTimeline, module.exports under Node):
//   build(x) → [ev]
//     x = { data, cust, links: [{ k, v }], tz?: minutes (Date#getTimezoneOffset),
//           inv?, I? (Invoices), stock?, S? (Stock), ts? (Timesheet data),
//           pub? (Publishing data), bud? (Budget data as stored), alsoInv: [id] }
//   ev = { key, day "YYYY-MM-DD", at? ms, g: crm|money|stock|work|pub,
//          k (kind, below), n? (number / name), amt? cents, cur?, q? thousandths,
//          ms? (hours), text?, from? (a statement's first day), open?: { app, target }, act?: id, deal?: id }
//   kinds: act (a logged contact; k2 = its kind), won, lost (a deal
//          closed), inv (an invoice / receipt / record you issued),
//          cred (a credit note), pay (a payment you received), bill (a
//          received invoice), bpay (a payment you made on one),
//          po (an order to a supplier), recv (goods in from a
//          supplier), ship (goods to a consignment shop), settle (a
//          settlement: sold at the shop), back (goods back from a
//          shop), work (hours on one day, per Timesheet client),
//          stmt (a royalty statement), roy (a royalty statement
//          paid), bin / bout (a Budget entry, income / expense)
//   filter(evs, g) → the events of one group ("" = all)
// ============================================================
(function (root) {
  "use strict";

  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX = 2000;                      // events kept, newest first
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // the local day of a time stamp; tz = minutes behind UTC (getTimezoneOffset)
  function dayOf(ms, tz) {
    var d = new Date(ms - (tz || 0) * 60000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function ids(x, k) { return x.links.filter(function (l) { return l.k === k; }).map(function (l) { return l.v; }); }

  function crmEvents(x, out) {
    var c = x.cust;
    x.data.acts.forEach(function (a) {
      if (a.cust !== c.id) return;
      out.push({ key: "act:" + a.id, day: dayOf(a.at, x.tz), at: a.at, g: "crm", k: "act", k2: a.k,
                 text: a.text || "", n: a.who || "", act: a.id, deal: a.deal || "" });
    });
    x.data.deals.forEach(function (d) {
      if (d.cust !== c.id || !d.cd || (d.stage !== "won" && d.stage !== "lost")) return;
      var won = d.stage === "won";
      out.push({ key: "deal:" + d.id, day: d.cd, g: "crm", k: won ? "won" : "lost", n: d.title, amt: d.val, deal: d.id });
    });
  }

  function invEvents(x, out) {
    var I = x.I, d = x.inv;
    if (!I || !d) return;
    var mine = {};
    I.byCrm(d, x.cust.id, x.day || "", x.alsoInv || []).rows.forEach(function (r) { mine[r.id] = r; });
    I.live(d.docs).forEach(function (doc) {
      var r = mine[doc.id];
      if (!r || doc.st !== "issued" || !YMD_RE.test(doc.date)) return;
      out.push({ key: "inv:" + doc.id, day: doc.date, g: "money", k: doc.kind === "cred" ? "cred" : "inv",
                 n: doc.num, amt: r.total, cur: doc.cur, open: { app: "invoices", target: { invoice: doc.id } } });
    });
    I.live(d.pays).forEach(function (p) {
      var r = mine[p.doc];
      if (!r) return;
      out.push({ key: "pay:" + p.id, day: p.date, g: "money", k: "pay", n: r.no, amt: p.amt, cur: r.cur,
                 open: { app: "invoices", target: { invoice: p.doc } } });
    });
    if (typeof I.billsByCrm !== "function") return;
    var bills = {};
    I.billsByCrm(d, x.cust.id, x.day || "", x.cust.afm || "").rows.forEach(function (b) {
      bills[b.id] = b;
      out.push({ key: "bill:" + b.id, day: b.date, g: "money", k: "bill", n: b.num, amt: b.total, cur: b.cur,
                 open: { app: "invoices", target: { bill: b.id } } });
    });
    I.live(d.bpays).forEach(function (p) {
      var b = bills[p.bill];
      if (!b) return;
      out.push({ key: "bpay:" + p.id, day: p.date, g: "money", k: "bpay", n: b.num, amt: p.amt, cur: b.cur,
                 open: { app: "invoices", target: { bill: p.bill } } });
    });
  }

  function qty(lines) {
    var q = 0;
    (lines || []).forEach(function (l) { q += Math.abs(l.q || 0); });
    return q;
  }
  function stockEvents(x, out) {
    var d = x.stock;
    if (!d) return;
    var sups = ids(x, "sup"), whs = ids(x, "wh");
    if (!sups.length && !whs.length) return;
    (d.pos || []).forEach(function (p) {
      if (!p || p.v === 1 || sups.indexOf(p.sup) < 0 || !YMD_RE.test(p.d)) return;
      out.push({ key: "po:" + p.id, day: p.d, g: "stock", k: "po", n: p.no || "", q: qty(p.lines), open: { app: "stock", target: { sup: p.sup } } });
    });
    (d.moves || []).forEach(function (mv) {
      if (!mv || mv.v === 1 || !YMD_RE.test(mv.d)) return;
      var k = "";
      if (mv.t === "in" && mv.sup && sups.indexOf(mv.sup) >= 0) k = "recv";
      else if (mv.t === "xfer" && whs.indexOf(mv.w2) >= 0) k = "ship";
      else if (mv.t === "xfer" && whs.indexOf(mv.w) >= 0) k = "back";
      else if (mv.t === "out" && whs.indexOf(mv.w) >= 0 && mv.src === "cons:" + mv.w) k = "settle";
      if (!k) return;
      var ev = { key: "mv:" + mv.id, day: mv.d, g: "stock", k: k, q: qty(mv.lines), open: { app: "stock", target: k === "recv" ? { sup: mv.sup } : { view: "cons" } } };
      if (k === "settle") {
        var v = 0;
        mv.lines.forEach(function (l) { v += Math.round(-l.q / 1000 * (l.p || 0)); });
        ev.amt = v;
        ev.cur = (d.settings && d.settings.cur) || "EUR";
      }
      out.push(ev);
    });
  }

  function workEvents(x, out) {
    var d = x.ts;
    if (!d) return;
    var cl = ids(x, "tsc");
    if (!cl.length) return;
    var proj = {};
    (d.projects || []).forEach(function (p) { if (p && !p.del && cl.indexOf(p.client) >= 0) proj[p.id] = p.client; });
    var days = {};
    (d.entries || []).forEach(function (e) {
      if (!e || e.del || !proj[e.p] || !(e.e > e.s)) return;
      var k = dayOf(e.s, x.tz) + "|" + proj[e.p];
      days[k] = (days[k] || 0) + (e.e - e.s);
    });
    var names = {};
    (d.clients || []).forEach(function (c) { if (c && !c.del) names[c.id] = c.name; });
    Object.keys(days).forEach(function (k) {
      var p = k.split("|");
      out.push({ key: "work:" + k, day: p[0], g: "work", k: "work", n: names[p[1]] || "", ms: days[k],
                 open: { app: "timesheet", target: { client: p[1] } } });
    });
  }

  function pubEvents(x, out) {
    var d = x.pub;
    if (!d || !Array.isArray(d.stmts)) return;
    var names = {};
    ids(x, "pub").forEach(function (v) { names["pub:" + v] = 1; });
    (d.titles || []).forEach(function (t) {
      (t.ppl || []).forEach(function (p) { if (p && p.crm === x.cust.id) names[CC.pubKey(p.n)] = 1; });
    });
    d.stmts.forEach(function (s) {
      if (!s || s.v === 1 || !names[CC.pubKey(s.n)] || !YMD_RE.test(s.to)) return;
      out.push({ key: "stmt:" + s.id, day: s.to, g: "pub", k: "stmt", amt: s.due || 0, cur: s.cur, from: YMD_RE.test(s.from) ? s.from : "",
                 open: { app: "publish", target: { view: "roy" } } });
      if (YMD_RE.test(s.paid || "") && s.due > 0) {
        out.push({ key: "roy:" + s.id, day: s.paid, g: "money", k: "roy", amt: s.due, cur: s.cur,
                   open: { app: "publish", target: { view: "roy" } } });
      }
    });
  }

  function budEvents(x, out) {
    var b = x.bud;
    if (!b || typeof b !== "object" || !Array.isArray(b.tx)) return;
    var cur = b.set && typeof b.set.cur === "string" && /^[A-Z]{3}$/.test(b.set.cur) ? b.set.cur : "EUR";
    var tombs = b.tombs && typeof b.tombs === "object" ? b.tombs : {};
    b.tx.forEach(function (e) {
      if (!e || e.crm !== x.cust.id || typeof e.id !== "string" || !YMD_RE.test(e.d) || (e.k !== "i" && e.k !== "o")) return;
      if (typeof e.a !== "number" || Math.floor(e.a) !== e.a || e.a <= 0) return;
      if (typeof tombs["tx:" + e.id] === "number" && tombs["tx:" + e.id] >= e.m) return;
      out.push({ key: "tx:" + e.id, day: e.d, g: "money", k: e.k === "i" ? "bin" : "bout", amt: e.a, cur: cur,
                 text: typeof e.n === "string" ? e.n.slice(0, 140) : "", open: { app: "budget", target: { tx: e.id } } });
    });
  }

  function build(x) {
    var out = [];
    crmEvents(x, out);
    invEvents(x, out);
    stockEvents(x, out);
    workEvents(x, out);
    pubEvents(x, out);
    budEvents(x, out);
    // newest day first; on one day, timed contacts newest first, then the rest by key
    out.sort(function (a, b) {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      var ta = a.at || 0, tb = b.at || 0;
      if (ta !== tb) return tb - ta;
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
    return out.slice(0, MAX);
  }
  function filter(evs, g) { return g ? evs.filter(function (e) { return e.g === g; }) : evs; }

  var API = { build: build, filter: filter, dayOf: dayOf, GROUPS: ["crm", "money", "stock", "work", "pub"] };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmTimeline = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
