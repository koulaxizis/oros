// ============================================================
// orOS Stock — pos-core.js (pure, v1.1.0; wave 46, fair till F1)
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
// F1 (1.1, Stock data 1.9):
//   OTHER                        line id of a free item ("xother")
//   grossOf(p, vat)              → round(p × (100 + vat) / 100)
//   netFor(gross, vat)           → the net cents whose gross is nearest
//   applyDisc(lines, disc)       → lines with p (charged) and p0 (list)
//                                  after line discounts l.dl and the
//                                  whole sale's disc; dl / disc =
//                                  { k: "pct" | "amt", v }
//   saved(lines)                 → gross cents given off (p0 vs p)
//   discPct(lines)               → that as a % of the list gross (0-100)
//   payParts(sale)               → { cash, card, other } in gross cents
//   receiptText(rows)            → plain text of receipt rows (share, QR)
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

  // ---------- F1: discounts, split payment, free items ----------
  var OTHER = "xother";
  function grossOf(p, vat) { return Math.round(p * (100 + (vat || 0)) / 100); }
  // Net cents are stored, people type gross: the net whose gross is
  // nearest to what was typed (ties: the lower net).
  function netFor(g, vat) {
    if (!isInt(g) || g <= 0) return 0;
    var v = isInt(vat) ? vat : 0, n0 = Math.round(g * 100 / (100 + v)), best = n0, bd = Infinity;
    for (var n = Math.max(0, n0 - 2); n <= n0 + 2; n++) {
      var d = Math.abs(grossOf(n, v) - g);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  function lineGross(l) { var n = lineNet(l); return n + Math.round(n * (l.vat || 0) / 100); }
  // The unit net price that makes the line's gross nearest target.
  function unitFor(target, q, vat) {
    if (target <= 0 || !q) return 0;
    var lineN = netFor(target, vat), p0 = Math.round(lineN * 1000 / q), best = p0, bd = Infinity;
    for (var p = Math.max(0, p0 - 2); p <= p0 + 2; p++) {
      var d = Math.abs(lineGross({ q: q, p: p, vat: vat }) - target);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function discOk(dc) {
    return !!(dc && (dc.k === "pct" || dc.k === "amt") && isInt(dc.v) && dc.v > 0);
  }
  // lines [{ i, q, p0 (list unit net), vat, dl?, … }] → copies with p.
  // A % takes the unit price down; an amount (gross cents) takes the
  // line's (or the sale's) gross down, the sale's spread over the
  // lines by their gross, largest remainder, so it sums exactly.
  function applyDisc(lines, disc) {
    var out = (lines || []).map(function (l) {
      var x = {};
      Object.keys(l).forEach(function (k) { if (k !== "dl") x[k] = l[k]; });
      var p0 = isInt(l.p0) ? l.p0 : (isInt(l.p) ? l.p : 0);
      x.p0 = p0;
      x.p = p0;
      var dl = l.dl;
      if (discOk(dl) && p0 > 0) {
        if (dl.k === "pct") x.p = Math.round(p0 * (100 - Math.min(100, dl.v)) / 100);
        else x.p = unitFor(Math.max(0, lineGross({ q: x.q, p: p0, vat: x.vat }) - dl.v), x.q, x.vat);
      }
      return x;
    });
    if (discOk(disc)) {
      if (disc.k === "pct") {
        out.forEach(function (x) { x.p = Math.round(x.p * (100 - Math.min(100, disc.v)) / 100); });
      } else {
        var gs = out.map(lineGross), tot = gs.reduce(function (a, b) { return a + b; }, 0);
        var off = Math.min(disc.v, tot);
        if (tot > 0 && off > 0) {
          var share = gs.map(function (g, i) { var e = off * g / tot; return { i: i, f: Math.floor(e), r: e - Math.floor(e) }; });
          var left = off - share.reduce(function (a, s) { return a + s.f; }, 0);
          share.slice().sort(function (a, b) { return (b.r - a.r) || (a.i - b.i); }).slice(0, left).forEach(function (s) { s.f++; });
          share.forEach(function (s) { var x = out[s.i]; x.p = unitFor(Math.max(0, gs[s.i] - s.f), x.q, x.vat); });
          // VAT is rounded per rate on the whole sale, so the sum can
          // miss the target by a cent: nudge one unit price at a time
          // (the step that lands nearest, lowest line first) up to 6 times
          var want = tot - off;
          for (var step = 0; step < 6; step++) {
            var miss = totals(out).gross - want;
            if (!miss) break;
            var pick = null, pd = Math.abs(miss);
            out.forEach(function (x, i) {
              [-1, 1].forEach(function (dd) {
                if (x.p + dd < 0) return;
                x.p += dd;
                var m2 = Math.abs(totals(out).gross - want);
                x.p -= dd;
                if (m2 < pd) { pd = m2; pick = { i: i, dd: dd }; }
              });
            });
            if (!pick) break;
            out[pick.i].p += pick.dd;
          }
        }
      }
    }
    out.forEach(function (x) { if (!(x.p0 > x.p)) delete x.p0; });
    return out;
  }
  function saved(lines) {
    var s = 0;
    (lines || []).forEach(function (l) {
      if (isInt(l.p0) && l.p0 > l.p) s += lineGross({ q: l.q, p: l.p0, vat: l.vat }) - lineGross(l);
    });
    return s;
  }
  function discPct(lines) {
    var g0 = 0;
    (lines || []).forEach(function (l) { g0 += lineGross({ q: l.q, p: isInt(l.p0) && l.p0 > l.p ? l.p0 : l.p, vat: l.vat }); });
    return g0 > 0 ? Math.round(saved(lines) * 1000 / g0) / 10 : 0;
  }
  // A split payment counts each part; parts that do not add up to the
  // receipt (an edited copy) fall back to the whole on pay.
  function payParts(sale) {
    var g = totals(sale.lines).gross, out = { cash: 0, card: 0, other: 0 };
    if (sale.pays && typeof sale.pays === "object") {
      var sum = 0;
      PAYS.forEach(function (k) { sum += isInt(sale.pays[k]) ? sale.pays[k] : 0; });
      if (sum === g) { PAYS.forEach(function (k) { out[k] = isInt(sale.pays[k]) ? sale.pays[k] : 0; }); return out; }
    }
    out[PAYS.indexOf(sale.pay) >= 0 ? sale.pay : "cash"] = g;
    return out;
  }
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
      if (!isInt(c.q) || c.q <= 0) return;
      var ln;
      if (c.i === OTHER) {
        // a free item: typed name and price, no stock
        var nm = String(c.n || "").trim();
        if (!nm || !isInt(c.p) || c.p < 0) return;
        ln = { i: OTHER, q: c.q, p: c.p, vat: isInt(c.vat) ? c.vat : 0, n: nm };
      } else {
        var it = byId(data.items, c.i);
        if (!it) return;
        ln = { i: it.id, q: c.q, p: isInt(c.p) ? c.p : priceOf(data, it, o.pl), vat: isInt(it.vat) ? it.vat : 0, n: it.name };
      }
      if (isInt(c.p0) && c.p0 > ln.p) ln.p0 = c.p0;
      lines.push(ln);
    });
    if (!lines.length) return null;
    var no = nextNo(data.sales, o.d, o.dev || "AA");
    var sale = {
      id: o.id, m: o.now, d: o.d, at: o.now, no: no, pay: PAYS.indexOf(o.pay) >= 0 ? o.pay : "cash",
      lines: lines
    };
    if (o.pl) sale.pl = o.pl;
    if (isInt(o.given) && o.given > 0) sale.given = o.given;
    if (o.w) sale.w = o.w;
    var dc = String(o.dc || "").trim().slice(0, 40);
    if (dc && lines.some(function (l) { return l.p0; })) sale.dc = dc;
    // a split: two or more parts that add up to the receipt; pay = the
    // largest part (what a 1.8 device counts it under)
    if (o.pays && typeof o.pays === "object") {
      var g = totals(lines).gross, sum = 0, parts = {}, n = 0, big = "";
      PAYS.forEach(function (k) {
        var v = o.pays[k];
        if (isInt(v) && v > 0) { parts[k] = v; sum += v; n++; if (!big || v > parts[big]) big = k; }
      });
      if (n > 1 && sum === g) { sale.pays = parts; sale.pay = big; }
    }
    var stock = lines.filter(function (l) { return l.i !== OTHER; });
    var move = null;
    if (stock.length) {
      sale.mv = o.mvId;
      move = {
        id: o.mvId, m: o.now, d: o.d, t: "out", ref: no, note: "", src: "pos:" + o.id,
        lines: stock.map(function (l) { return { i: l.i, q: -l.q, p: l.p }; })
      };
      if (o.w) move.w = o.w;
    }
    return { sale: sale, move: move };
  }

  function daySales(data, d) {
    return ((data && data.sales) || []).filter(function (s) { return s.d === d; })
      .sort(function (a, b) { return (a.at - b.at) || cmpStr(a.id, b.id); });
  }
  // The day's totals: live sales only (voided ones are counted apart).
  //   { d, n, voids, g, net, vat, byVat, byPay: { cash, card, other },
  //     byPl: { plId: gross }, top: [{ i, n, q, g }], first, last,
  //     disc (gross given off by discounts), splits (split sales),
  //     z (the stored close or null), after (sales made after it) }
  function zReport(data, d) {
    var list = daySales(data, d), live = list.filter(function (s) { return s.v !== 1; });
    var all = [], byPay = { cash: 0, card: 0, other: 0 }, byPl = {}, items = {}, disc = 0, splits = 0;
    live.forEach(function (s) {
      var tt = totals(s.lines), parts = payParts(s);
      PAYS.forEach(function (p) { byPay[p] += parts[p]; });
      disc += saved(s.lines);
      if (s.pays) splits++;
      var k = s.pl || RETAIL;
      byPl[k] = (byPl[k] || 0) + tt.gross;
      s.lines.forEach(function (l) {
        all.push(l);
        var key = l.i === OTHER ? OTHER + ":" + l.n : l.i;
        var x = items[key] || (items[key] = { i: l.i, n: l.n, q: 0, g: 0 });
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
      byPay: byPay, byPl: byPl, top: top, disc: disc, splits: splits,
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
      if (isInt(l.p0) && l.p0 > l.p) rows.push({ k: "sub", l: (L.was || "was") + " " + m(grossOf(l.p0, l.vat)), r: "" });
    });
    var tt = totals(sale.lines), off = saved(sale.lines);
    if (off > 0) rows.push({ k: "sum", l: (L.disc || "Discount") + (sale.dc ? " · " + sale.dc : ""), r: "−" + m(off) });
    rows.push({ k: "sum", l: L.net || "Net", r: m(tt.net) });
    tt.byVat.forEach(function (r) { rows.push({ k: "sum", l: (L.vat || "VAT") + " " + r.rate + "%", r: m(r.vat) }); });
    rows.push({ k: "total", l: L.total || "TOTAL", r: m(tt.gross) });
    var parts = payParts(sale), cash = parts.cash;
    if (sale.pays && parts[sale.pay] !== tt.gross) {
      PAYS.forEach(function (k) {
        if (parts[k]) rows.push({ k: "sum", l: (L.pay || "Paid") + " · " + ((L.payName && L.payName[k]) || k), r: m(parts[k]) });
      });
    } else {
      rows.push({ k: "sum", l: L.pay || "Paid", r: (L.payName && L.payName[sale.pay]) || sale.pay });
    }
    if (cash > 0 && isInt(sale.given) && sale.given >= cash) {
      rows.push({ k: "sum", l: L.given || "Given", r: m(sale.given) });
      rows.push({ k: "sum", l: L.change || "Change", r: m(sale.given - cash) });
    }
    String(o.foot || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6)
      .forEach(function (s) { rows.push({ k: "foot", l: s, r: "" }); });
    return rows;
  }

  function receiptText(rows) {
    return (rows || []).map(function (r, i) {
      if (r.k === "head" || r.k === "foot" || r.k === "void") return r.l;
      if ((r.k === "total" || r.k === "meta") && i) return "----\n" + r.l + (r.r ? "  " + r.r : "");
      return (r.k === "sub" ? "  " : "") + r.l + (r.r ? "  " + r.r : "");
    }).join("\n");
  }

  var api = {
    OTHER: OTHER, grossOf: grossOf, netFor: netFor, applyDisc: applyDisc, saved: saved, discPct: discPct,
    payParts: payParts, receiptText: receiptText,
    RETAIL: RETAIL, PAYS: PAYS, priceOf: priceOf, lineNet: lineNet, totals: totals, change: change,
    nextNo: nextNo, devCode: devCode, makeSale: makeSale, daySales: daySales, zReport: zReport, zRow: zRow,
    nextZ: nextZ, receiptRows: receiptRows
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosStockPosCore = api;
})(typeof window !== "undefined" ? window : this);
