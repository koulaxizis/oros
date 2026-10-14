// ============================================================
// orOS Stock — pos-core.js (pure, v1.0.0, wave 46)
// The point of sale's rules: prices per price list, cart totals with
// VAT per rate, receipt numbers, the sale + its stock movement, the
// day's Z report and the receipt's rows. No DOM, no storage: the POS
// screen (stock/pos.js) and the tests use it. The stored shapes and
// their merge live in core.js (normSale / normPl / normZ).
//
// Money is integer cents, quantities integer thousandths (core.js).
// Prices are NET (as everywhere in Stock); VAT is added per rate on
// the sum of the lines with that rate, like an invoice.
//
// API (window.OrosStockPosCore / module.exports):
//   RETAIL                       the built-in price list id ("")
//   priceOf(data, item, plId)    → net unit price in cents
//   totals(lines)                → { net, vat, gross, byVat: [{ rate,
//                                  net, vat, gross }] }; lines [{ q, p, vat }]
//   lineNet(l)                   → round(q × p / 1000)
//   change(gross, given)         → cents back, or null when short
//   nextNo(sales, d, dev)        → "<dev>-<YYMMDD>-<NNN>"
//   devCode(rand)                → two characters A-Z / 2-9
//   makeSale(o)                  → { sale, move } | null
//   daySales(data, d)            → that day's sales, oldest first
//   zReport(data, d)             → the day's totals (see below)
//   zRow(rep, now, no)           → the row stored when a day is closed
//   receiptRows(sale, o)         → [{ k, l, r }] for the printed receipt
// ============================================================
(function (root) {
  "use strict";

  var RETAIL = "";
  var PAYS = ["cash", "card", "other"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // A price list's net unit price for an item: its own price for that
  // item, else the item's sale price ± the list's percentage, else the
  // sale price (retail, or an unknown list).
  function priceOf(data, item, plId) {
    if (!item) return 0;
    var base = isInt(item.price) ? item.price : 0;
    if (!plId) return base;
    var pl = byId(data && data.pls, plId);
    if (!pl) return base;
    if (pl.p && Object.prototype.hasOwnProperty.call(pl.p, item.id) && isInt(pl.p[item.id])) return pl.p[item.id];
    return pl.pct ? Math.max(0, Math.round(base * (100 + pl.pct) / 100)) : base;
  }

  function lineNet(l) { return Math.round((l.q || 0) * (l.p || 0) / 1000); }
  function totals(lines) {
    var by = {}, net = 0;
    (lines || []).forEach(function (l) {
      var n = lineNet(l), r = isInt(l.vat) ? l.vat : 0;
      net += n;
      by[r] = (by[r] || 0) + n;
    });
    var rates = Object.keys(by).map(Number).sort(function (a, b) { return b - a; });
    var vat = 0, byVat = rates.map(function (r) {
      var v = Math.round(by[r] * r / 100);
      vat += v;
      return { rate: r, net: by[r], vat: v, gross: by[r] + v };
    });
    return { net: net, vat: vat, gross: net + vat, byVat: byVat };
  }
  function change(gross, given) {
    if (!isInt(given) || !isInt(gross) || given < gross) return null;
    return given - gross;
  }

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function p3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : String(n); }
  // Receipt numbers count per device and day, so two registers that
  // sell at the same time never print the same number.
  function nextNo(sales, d, dev) {
    var pre = dev + "-" + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + "-", max = 0;
    (sales || []).forEach(function (s) {
      if (typeof s.no === "string" && s.no.indexOf(pre) === 0) {
        var n = parseInt(s.no.slice(pre.length), 10);
        if (isInt(n) && n > max) max = n;
      }
    });
    return pre + p3(max + 1);
  }
  var DEV_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function devCode(rand) {
    var r = typeof rand === "function" ? rand : Math.random;
    return DEV_CH.charAt(Math.floor(r() * DEV_CH.length) % DEV_CH.length) + DEV_CH.charAt(Math.floor(r() * DEV_CH.length) % DEV_CH.length);
  }

  // o = { data, cart: [{ i, q }], pl, pay, given?, w?, d, now, dev,
  //       id, mvId } → { sale, move } (plain rows; core.js normalizes)
  function makeSale(o) {
    var data = o.data || {};
    var lines = [];
    (o.cart || []).forEach(function (c) {
      var it = byId(data.items, c.i);
      if (!it || !isInt(c.q) || c.q <= 0) return;
      lines.push({ i: it.id, q: c.q, p: isInt(c.p) ? c.p : priceOf(data, it, o.pl), vat: isInt(it.vat) ? it.vat : 0, n: it.name });
    });
    if (!lines.length) return null;
    var no = nextNo(data.sales, o.d, o.dev || "AA");
    var sale = {
      id: o.id, m: o.now, d: o.d, at: o.now, no: no, pay: PAYS.indexOf(o.pay) >= 0 ? o.pay : "cash",
      lines: lines, mv: o.mvId
    };
    if (o.pl) sale.pl = o.pl;
    if (isInt(o.given) && o.given > 0) sale.given = o.given;
    if (o.w) sale.w = o.w;
    var move = {
      id: o.mvId, m: o.now, d: o.d, t: "out", ref: no, note: "", src: "pos:" + o.id,
      lines: lines.map(function (l) { return { i: l.i, q: -l.q, p: l.p }; })
    };
    if (o.w) move.w = o.w;
    return { sale: sale, move: move };
  }

  function daySales(data, d) {
    return ((data && data.sales) || []).filter(function (s) { return s.d === d; })
      .sort(function (a, b) { return (a.at - b.at) || cmpStr(a.id, b.id); });
  }
  // The day's totals: live sales only (voided ones are counted apart).
  //   { d, n, voids, g, net, vat, byVat, byPay: { cash, card, other },
  //     byPl: { plId: gross }, top: [{ i, n, q, g }], first, last,
  //     z (the stored close or null), after (sales made after it) }
  function zReport(data, d) {
    var list = daySales(data, d), live = list.filter(function (s) { return s.v !== 1; });
    var all = [], byPay = { cash: 0, card: 0, other: 0 }, byPl = {}, items = {};
    live.forEach(function (s) {
      var tt = totals(s.lines);
      byPay[s.pay] = (byPay[s.pay] || 0) + tt.gross;
      var k = s.pl || RETAIL;
      byPl[k] = (byPl[k] || 0) + tt.gross;
      s.lines.forEach(function (l) {
        all.push(l);
        var x = items[l.i] || (items[l.i] = { i: l.i, n: l.n, q: 0, g: 0 });
        var n = lineNet(l);
        x.q += l.q;
        x.g += n + Math.round(n * l.vat / 100);
      });
    });
    var sum = { net: 0, vat: 0, g: 0, byVat: [] };
    // per sale rounding, the same numbers the receipts show
    var rates = {};
    live.forEach(function (s) {
      var tt = totals(s.lines);
      sum.net += tt.net; sum.vat += tt.vat; sum.g += tt.gross;
      tt.byVat.forEach(function (r) {
        var x = rates[r.rate] || (rates[r.rate] = { rate: r.rate, net: 0, vat: 0, gross: 0 });
        x.net += r.net; x.vat += r.vat; x.gross += r.gross;
      });
    });
    sum.byVat = Object.keys(rates).map(Number).sort(function (a, b) { return b - a; }).map(function (r) { return rates[r]; });
    var z = byId(data && data.zs, "z" + d.replace(/-/g, ""));
    var top = Object.keys(items).map(function (k) { return items[k]; })
      .sort(function (a, b) { return b.g - a.g || cmpStr(a.n, b.n); }).slice(0, 10);
    return {
      d: d, n: live.length, voids: list.length - live.length, g: sum.g, net: sum.net, vat: sum.vat, byVat: sum.byVat,
      byPay: byPay, byPl: byPl, top: top,
      first: live.length ? live[0].at : 0, last: live.length ? live[live.length - 1].at : 0,
      z: z, after: z ? live.filter(function (s) { return s.at > z.at; }).length : 0
    };
  }
  // The stored close of a day (core.normZ shape). no = the Z number.
  function zRow(rep, now, no) {
    return {
      id: "z" + rep.d.replace(/-/g, ""), m: now, d: rep.d, at: now, no: no, n: rep.n, g: rep.g, net: rep.net, vat: rep.vat,
      cash: rep.byPay.cash || 0, card: rep.byPay.card || 0, other: rep.byPay.other || 0
    };
  }
  function nextZ(data) {
    var max = 0;
    ((data && data.zs) || []).forEach(function (z) { if (z.no > max) max = z.no; });
    return max + 1;
  }

  // Rows of a printed receipt. o = { head (text, lines), foot (text),
  // money(cents) → text, qty(line) → text, when (text), labels: { no,
  // net, vat, total, pay, given, change, payName } }. k: "head" |
  // "meta" | "item" | "sub" | "sum" | "total" | "foot"; the screen
  // builds the HTML with escaping.
  function receiptRows(sale, o) {
    var L = o.labels || {}, rows = [], m = o.money;
    String(o.head || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8)
      .forEach(function (s) { rows.push({ k: "head", l: s, r: "" }); });
    rows.push({ k: "meta", l: (L.no || "No.") + " " + sale.no, r: o.when || "" });
    sale.lines.forEach(function (l) {
      var n = lineNet(l);
      rows.push({ k: "item", l: l.n, r: m(n + Math.round(n * l.vat / 100)) });
      rows.push({ k: "sub", l: o.qty(l) + " × " + m(Math.round(l.p * (100 + l.vat) / 100)), r: l.vat + "%" });
    });
    var tt = totals(sale.lines);
    rows.push({ k: "sum", l: L.net || "Net", r: m(tt.net) });
    tt.byVat.forEach(function (r) { rows.push({ k: "sum", l: (L.vat || "VAT") + " " + r.rate + "%", r: m(r.vat) }); });
    rows.push({ k: "total", l: L.total || "TOTAL", r: m(tt.gross) });
    rows.push({ k: "sum", l: L.pay || "Paid", r: (L.payName && L.payName[sale.pay]) || sale.pay });
    if (sale.pay === "cash" && isInt(sale.given) && sale.given >= tt.gross) {
      rows.push({ k: "sum", l: L.given || "Given", r: m(sale.given) });
      rows.push({ k: "sum", l: L.change || "Change", r: m(sale.given - tt.gross) });
    }
    String(o.foot || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6)
      .forEach(function (s) { rows.push({ k: "foot", l: s, r: "" }); });
    return rows;
  }

  var api = {
    RETAIL: RETAIL, PAYS: PAYS, priceOf: priceOf, lineNet: lineNet, totals: totals, change: change,
    nextNo: nextNo, devCode: devCode, makeSale: makeSale, daySales: daySales, zReport: zReport, zRow: zRow,
    nextZ: nextZ, receiptRows: receiptRows
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosStockPosCore = api;
})(typeof window !== "undefined" ? window : this);
