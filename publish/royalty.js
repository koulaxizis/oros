// ============================================================
// orOS Publishing — royalty statements (publish/royalty.js, wave P6)
// Pure, no DOM. Loaded by publish/index.html after core.js, and by
// Node in the tests. It reads Stock's own saved data (localStorage
// "oros-stock-data", already normalized by Stock) and never writes it.
//
// Where the sales come from: Stock. Every sale that went through Stock
// counts: the till, shop orders recorded there, invoices taken out of
// stock, consignment settlements (stock/consign.js). A format is
// matched to Stock products by its ISBN (the product's SKU or barcode,
// as "Send to Stock" makes it). Sales Stock never saw (an e-book shop,
// a fair) are typed into the statement by hand.
//   units = sold − customer returns in the period (voided movements
//           and transfers don't count)
//   net   = what came in, VAT excluded: each sale line's price, less
//           the consignment shop's discount for a settlement; returns
//           at the period's average price
// Terms are on the title (core.js cleanRoy): pct of the list price
// (the format's price × units) or of net, one format kind or all, and
// an advance that is recouped first: what the earlier statements of the
// same person and term earned is taken off it, and only the rest of
// this period's earnings is payable.
//
// API (window.OrosPublishRoyalty):
//   people(pub) → [{ n, key, titles }] everyone with terms, by name
//   sales(stock, isbn, from, to) → { q, net, found, closed }
//   build(pub, stock, name, from, to, cur) → a statement draft
//   recompute(st, pub) → the same statement with b, e, rec, due redone
//     (after a units figure was typed)
//   periods(today) → [{ id, from, to }] last half, last year, last quarter
// ============================================================
(function (root) {
  "use strict";

  var P = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosPublishCore;

  function key(n) { return P.fold(n); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function digits(s) { return String(s || "").replace(/[^0-9]/g, ""); }

  // Everyone who has terms on a title, with those titles.
  function people(pub) {
    var by = {};
    ((pub && pub.titles) || []).forEach(function (t) {
      (t.roy || []).forEach(function (r) {
        var k = key(r.n);
        if (!k) return;
        var p = by[k] || (by[k] = { n: r.n, key: k, titles: [] });
        if (p.titles.indexOf(t) < 0) p.titles.push(t);
      });
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  }

  // Sales of one ISBN in Stock between from and to (days, inclusive).
  // q in units (may be fractional only if the product's unit allows),
  // net in cents. found = a Stock product has this ISBN; closed = Stock
  // closed its books after `from`, so older movements are archived and
  // not counted here.
  function sales(stock, isbn, from, to) {
    var out = { q: 0, net: 0, found: false, closed: false };
    if (!stock || !/^\d{13}$/.test(isbn || "")) return out;
    var ids = {};
    (stock.items || []).forEach(function (it) {
      if (digits(it.sku) === isbn || digits(it.bc) === isbn) { ids[it.id] = it; out.found = true; }
    });
    if (!out.found) return out;
    if (stock.close && stock.close.d >= from) out.closed = true;
    var disc = {};
    (stock.cons || []).forEach(function (c) { disc["cons:" + c.id] = c.disc || 0; });
    var sold = 0, back = 0, net = 0;
    (stock.moves || []).forEach(function (x) {
      if (x.v === 1 || (x.t !== "out" && x.t !== "ret") || x.d < from || x.d > to) return;
      var d = x.src && disc[x.src] !== undefined ? disc[x.src] : 0;
      x.lines.forEach(function (l) {
        if (!ids[l.i]) return;
        if (x.t === "out") {
          sold += -l.q;
          net += -l.q / 1000 * (typeof l.p === "number" ? l.p : 0) * (100 - d) / 100;
        } else back += l.q;
      });
    });
    var avg = sold > 0 ? net / (sold / 1000) : 0;
    if (!avg) {
      var any = Object.keys(ids).map(function (i) { return ids[i]; })[0];
      avg = any ? any.price || 0 : 0;
    }
    net -= back / 1000 * avg;
    out.q = (sold - back) / 1000;
    out.net = Math.round(net);
    return out;
  }

  // Earned before this statement on one term: the rows of the earlier,
  // not voided statements of the same person (they end before `from`).
  function earnedBefore(pub, k, ti, tr, from, selfId) {
    var e = 0;
    ((pub && pub.stmts) || []).forEach(function (s) {
      if (s.v === 1 || s.id === selfId || key(s.n) !== k || s.to >= from) return;
      s.rows.forEach(function (r) { if (r.ti === ti && r.tr === tr) e += r.e; });
    });
    return e;
  }

  // A statement draft for one person and period. Each format of a title
  // the person has a term on is one row (a term on one kind only takes
  // the formats of that kind).
  function build(pub, stock, name, from, to, cur) {
    var k = key(name), rows = [], warn = { closed: false, missing: [] };
    ((pub && pub.titles) || []).forEach(function (t) {
      (t.roy || []).forEach(function (r) {
        if (key(r.n) !== k) return;
        (t.fmts || []).forEach(function (f) {
          if (r.k && f.k !== r.k) return;
          var s = sales(stock, f.isbn, from, to);
          if (s.closed) warn.closed = true;
          if (f.isbn && !s.found) warn.missing.push(t.t);
          var u = r.base === "list" ? Math.round((f.price || 0) * 100) : (s.q > 0 ? r2(s.net / s.q) : 0);
          rows.push({ ti: t.id, tr: r.id, t: t.t, k: f.k, isbn: f.isbn || "", q: s.q, base: r.base, u: u, b: 0, pct: r.pct, e: 0 });
        });
      });
    });
    var st = { id: "", m: 0, n: name, from: from, to: to, cur: cur || "EUR", rows: rows, rec: [], due: 0, paid: "", note: "" };
    var out = recompute(st, pub);
    out.warn = warn;
    return out;
  }

  // b = units × unit base, e = b × pct; per term: the advance left
  // before this period, then what is payable.
  function recompute(st, pub) {
    var k = key(st.n), terms = {};
    ((pub && pub.titles) || []).forEach(function (t) {
      (t.roy || []).forEach(function (r) { terms[t.id + "/" + r.id] = r; });
    });
    var rows = st.rows.map(function (r) {
      var o = Object.assign({}, r);
      o.b = Math.round(o.q * o.u);
      o.e = Math.round(o.b * o.pct / 100);
      return o;
    });
    var rec = [], at = {};
    rows.forEach(function (r) {
      var id = r.ti + "/" + r.tr;
      if (at[id] === undefined) {
        var term = terms[id], adv = term ? Math.round(term.adv * 100) : 0;
        // a statement already issued keeps the advance it showed
        var was = (st.rec || []).filter(function (x) { return x.ti === r.ti && x.tr === r.tr; })[0];
        if (st.id && was) adv = was.adv;
        var left = Math.max(0, adv - earnedBefore(pub, k, r.ti, r.tr, st.from, st.id));
        at[id] = rec.length;
        rec.push({ ti: r.ti, tr: r.tr, adv: adv, left: left, e: 0, pay: 0 });
      }
      rec[at[id]].e += r.e;
    });
    var due = 0;
    rec.forEach(function (x) { x.pay = Math.max(0, x.e - x.left); due += x.pay; });
    return Object.assign({}, st, { rows: rows, rec: rec, due: due });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m 1–12
  // The usual statement periods that ended before today.
  function periods(today) {
    var y = +today.slice(0, 4), m = +today.slice(5, 7);
    var h = m <= 6 ? { from: (y - 1) + "-07-01", to: (y - 1) + "-12-31" } : { from: y + "-01-01", to: y + "-06-30" };
    var q = Math.floor((m - 1) / 3), qy = y;
    if (q === 0) { q = 4; qy = y - 1; }
    var qs = (q - 1) * 3 + 1, qe = qs + 2;
    return [
      { id: "half", from: h.from, to: h.to },
      { id: "year", from: (y - 1) + "-01-01", to: (y - 1) + "-12-31" },
      { id: "quarter", from: qy + "-" + pad(qs) + "-01", to: qy + "-" + pad(qe) + "-" + pad(lastDay(qy, qe)) }
    ];
  }

  var API = { people: people, sales: sales, build: build, recompute: recompute, periods: periods, key: key };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishRoyalty = API;
})(typeof window !== "undefined" ? window : globalThis);
