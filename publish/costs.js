// ============================================================
// orOS Publishing — cost and result per title (publish/costs.js, P15)
// Pure, no DOM. Loaded by publish/index.html after core.js, and by
// Node in the tests. Nothing here is stored: the figures are read from
// the shop each time (the shop's Production Ledger is where they are
// kept) and only shown.
//
// Where the figures come from: a WooCommerce shop that runs Production
// Ledger (noxpress 1.0+) answers GET /wc/v3/pl/records (the same read
// Budget's shop records use, links/core.js ALLOW.woo):
//   o<order>-p<product>  a paid order line: k "i", cat sales | trade,
//                        pid, qty, a = net, v = VAT (cents)
//   o<order>-s           shipping charged (not a title's: left out)
//   e<entry>             a ledger entry: k "o" a cost (printing, editing,
//                        design, …) or k "i" an off-site sale (offsite);
//                        scope product (pid) | pool | general
//   del 1                no longer counts
// and Revenue Splitter (noxpress 1.11+) answers GET /wc/v3/rs/report
// with each product's splits: what each person's share came to.
//
// Which products are a title's: a format sent to the shop keeps the
// product's id (fmt.wp { a: account, id }); a format with an ISBN and
// no link is matched by the product's SKU (digits only, so a
// hyphenated SKU matches). Costs spread over a month's orders (pool:
// shipping, consumables, payment fees) and general expenses are not
// any one title's and are left out; the panel says so.
//
// Production Ledger 1.1+ also answers GET /wc/v3/pl/report: its own
// report per product (the same figures as the report screen on the
// site), which is the result shown when the shop has it (titleReport,
// overviewRep): revenue and shipping charged, minus the direct costs,
// the product's shares of each month's pooled shipping, consumables and
// payment fees, and the creators' payouts; VAT out and in beside it; and
// royalties worked out from the title's own terms when Revenue Splitter
// pays no one for it and there is no «Creators» cost (royEst). The
// records then only give each cost's supplier and invoice.
//
// Without the report (Production Ledger 1.0), forTitle / overview count
// what the records alone tell. Amounts are net of VAT, integer cents:
//   income  = shop sales + trade sales + off-site sales
//   costs   = the title's ledger costs, by category
//   shares  = Revenue Splitter's splits to anyone but the publisher
//             (set.imp and set.own name the publisher)
//   net     = income − costs − shares
//
// API (window.OrosPublishCosts):
//   CATS                         the ledger's categories, in order
//   recReq(from, to, page)       → a /pl/records request
//   rsReq(from, to)              → a /rs/report request
//   okEnv(j)                     → is j a /pl/records answer
//   read(ask, today, cur)        → Promise<{ recs, start }> every page
//   pidsOf(title, acct, sku)     → { pid: format id } the title's products
//   unknownPids(recs, pub, acct) → product ids no format is linked to
//   skuMap(pids, answers)        → { pid: "digits" } from /products/<id>
//   isOwn(name, set)             → is this split name the publisher
//   forTitle(recs, pids, rs, set) → the title's figures
//   overview(pub, acct, recs, rs, sku) → [{ id, t, inc, cost, share, net, n }]
//   repReq(from, to), okRep(j)   the report request, is j a report
//   repSum(rep, pids)            → the report's rows for those products, summed
//   royEst(title, pids, rep, z)  → { lines, a } royalties from terms, or null
//   titleReport(rep, recs, rs, title, pids, set) → a title's whole picture
//   overviewRep(pub, acct, rep, sku) → { rows, other, general, total }
// ============================================================
(function (root) {
  "use strict";

  var P = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosPublishCore;

  var CATS = ["printing", "editing", "design", "sound", "isbn", "shipping", "consumables",
              "promotion", "events", "payment_fees", "creators", "general"];
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SPAN = 390;                 // days one request may span (the shop allows 400)
  var MAX_RECS = 50000;
  var MAX_LOOKUP = 100;           // product ids looked up by SKU in one read
  var MAX_CENTS = 1e11;

  function digits(s) { return String(s || "").replace(/[^0-9]/g, ""); }
  function cents(v) { return typeof v === "number" && Math.floor(v) === v && v >= 0 && v <= MAX_CENTS ? v : 0; }
  function pid(v) { return typeof v === "number" && Math.floor(v) === v && v > 0 && v < 1e12 ? v : 0; }
  function txt(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : ""; }
  function fail(code, params) { var e = new Error(code); e.code = code; e.params = params || {}; return e; }

  // ---------- Requests ----------
  function recReq(from, to, page) {
    var q = [];
    if (DAY_RE.test(from || "")) q.push("from=" + from);
    if (DAY_RE.test(to || "")) q.push("to=" + to);
    var p = typeof page === "number" && page >= 1 && page < 10000 ? Math.floor(page) : 1;
    q.push("page=" + p, "per_page=500");
    return { m: "GET", path: "/pl/records?" + q.join("&") };
  }
  function rsReq(from, to) {
    return { m: "GET", path: "/rs/report?date_start=" + from + "&date_end=" + to };
  }
  function okEnv(j) {
    return !!j && typeof j === "object" && j.source === "production-ledger" && Array.isArray(j.records) &&
           typeof j.pages === "number" && j.pages >= 1 && j.pages <= 1000 && DAY_RE.test(j.from || "") && DAY_RE.test(j.to || "");
  }
  function addDays(ymd, n) {
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
    return d.toISOString().slice(0, 10);
  }
  function span(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }

  // Every record the shop has, oldest window first. ask(req) →
  // Promise<data> (throws { code } for a refused call). cur = the
  // currency Publishing counts in: another one reads nothing.
  function read(ask, today, cur) {
    var recs = [];
    function check(env) {
      if (!okEnv(env)) throw fail("nopl");
      if (cur && env.currency && env.currency !== cur) throw fail("cur", { c: String(env.currency).slice(0, 3), cur: cur });
    }
    function pages(env) {
      var chain = Promise.resolve();
      for (var p = 2; p <= env.pages; p++) {
        (function (p) {
          chain = chain.then(function () {
            if (recs.length > MAX_RECS) throw fail("big", { n: MAX_RECS });
            return ask(recReq(env.from, env.to, p)).then(function (j) { check(j); recs = recs.concat(j.records); });
          });
        })(p);
      }
      return chain;
    }
    function win(from, to, first) {
      var got = first ? Promise.resolve(first) : ask(recReq(from, to, 1));
      return got.then(function (env) {
        check(env);
        recs = recs.concat(env.records);
        return pages(env);
      });
    }
    // The first page tells where the shop's records start.
    return ask(recReq("", today, 1)).then(function (env) {
      check(env);
      var start = DAY_RE.test(env.start || "") ? env.start : env.from;
      if (span(start, today) <= SPAN) return win(env.from, env.to, env).then(function () { return start; });
      var wins = [], f = start;
      while (f <= today) { var to = addDays(f, SPAN - 1); if (to > today) to = today; wins.push([f, to]); f = addDays(to, 1); }
      return wins.reduce(function (chain, w) {
        return chain.then(function () { return win(w[0], w[1], null); });
      }, Promise.resolve()).then(function () { return start; });
    }).then(function (start) { return { recs: recs, start: start }; });
  }

  // ---------- Which products are a title's ----------
  // → { pid: format id }
  function pidsOf(title, acct, sku) {
    var out = {}, isbns = {};
    ((title && title.fmts) || []).forEach(function (f) {
      if (f.wp && f.wp.a === acct && pid(f.wp.id)) out[f.wp.id] = f.id;
      else if (f.isbn) isbns[digits(f.isbn)] = f.id;
    });
    Object.keys(sku || {}).forEach(function (k) { if (isbns[sku[k]]) out[k] = isbns[sku[k]]; });
    return out;
  }
  // Products the shop's records name that no format points at: their
  // SKU is looked up once (GET /products/<id>), at most MAX_LOOKUP.
  function unknownPids(recs, pub, acct) {
    var known = {}, seen = {}, out = [];
    ((pub && pub.titles) || []).forEach(function (tt) {
      (tt.fmts || []).forEach(function (f) { if (f.wp && f.wp.a === acct && pid(f.wp.id)) known[f.wp.id] = true; });
    });
    (recs || []).forEach(function (r) {
      var p = r && !r.del ? pid(r.pid) : 0;
      if (!p || known[p] || seen[p]) return;
      seen[p] = true;
      out.push(p);
    });
    return out.sort(function (a, b) { return a - b; }).slice(0, MAX_LOOKUP);
  }
  function skuMap(pids, answers) {
    var out = {};
    (pids || []).forEach(function (p, i) {
      var j = answers && answers[i];
      if (!j || typeof j !== "object" || j.id !== p) return;
      var d = digits(j.sku);
      if (d.length === 13 || d.length === 10) out[p] = d;
    });
    return out;
  }

  // ---------- The publisher among the splits ----------
  function ownNames(set) {
    var s = set || {}, list = [];
    if (typeof s.imp === "string" && s.imp.trim()) list.push(s.imp);
    if (typeof s.own === "string") s.own.split(",").forEach(function (n) { if (n.trim()) list.push(n); });
    return list.map(function (n) { return P.fold(n).replace(/\s+/g, " ").trim(); }).filter(Boolean);
  }
  // A name is the publisher's when it is one of theirs, or one is part
  // of the other ("Γλαρόλυκοι" in "Εκδόσεις Γλαρόλυκοι").
  function isOwn(name, set) {
    var n = P.fold(name).replace(/\s+/g, " ").trim();
    if (!n) return false;
    return ownNames(set).some(function (o) { return o === n || (o.length >= 4 && n.indexOf(o) >= 0) || (n.length >= 4 && o.indexOf(n) >= 0); });
  }

  // ---------- One title's figures ----------
  function forTitle(recs, pids, rs, set) {
    var by = {}, inc = { sales: { q: 0, a: 0 }, trade: { q: 0, a: 0 }, offsite: { a: 0, rows: [] } };
    var first = "", last = "", any = false;
    (recs || []).forEach(function (r) {
      if (!r || r.del || typeof r.id !== "string" || !pids[r.pid]) return;
      if (r.id.charAt(0) === "e" && r.scope && r.scope !== "product") return;
      var a = cents(r.a), d = DAY_RE.test(r.d || "") ? r.d : "";
      if (d) { if (!first || d < first) first = d; if (d > last) last = d; }
      any = true;
      if (r.id.charAt(0) === "o") {
        if (r.k !== "i") return;
        var box = r.cat === "trade" ? inc.trade : inc.sales;
        box.a += a;
        box.q += typeof r.qty === "number" && r.qty > 0 && r.qty < 1e6 ? Math.floor(r.qty) : 0;
        return;
      }
      var row = { id: r.id, d: d, a: a, v: cents(r.v), sup: txt(r.supplier, 120), inv: txt(r.inv, 60), note: txt(r.note, 300) };
      if (r.k === "i") { inc.offsite.a += a; inc.offsite.rows.push(row); return; }
      var cat = CATS.indexOf(r.cat) >= 0 ? r.cat : "general";
      var c = by[cat] || (by[cat] = { cat: cat, a: 0, rows: [] });
      c.a += a;
      c.rows.push(row);
    });
    var costs = CATS.filter(function (k) { return by[k]; }).map(function (k) {
      by[k].rows.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : x.id < y.id ? -1 : 1; });
      return by[k];
    });
    var shares = {}, splitOk = false;
    (rs && Array.isArray(rs.products) ? rs.products : []).forEach(function (p) {
      if (!p || !pids[p.product_id] || !Array.isArray(p.splits)) return;
      splitOk = true;
      p.splits.forEach(function (s) {
        var n = txt(s && s.name, 120);
        if (!n) return;
        var x = shares[n] || (shares[n] = { n: n, a: 0, own: isOwn(n, set) });
        x.a += cents(s.amount);
      });
    });
    var shareList = Object.keys(shares).map(function (k) { return shares[k]; })
      .sort(function (a, b) { return a.own !== b.own ? (a.own ? 1 : -1) : b.a - a.a; });
    var incA = inc.sales.a + inc.trade.a + inc.offsite.a;
    var costA = costs.reduce(function (s, c) { return s + c.a; }, 0);
    var shareA = shareList.reduce(function (s, x) { return s + (x.own ? 0 : x.a); }, 0);
    return {
      any: any || splitOk, first: first, last: last,
      inc: inc, incA: incA, costs: costs, costA: costA,
      shares: shareList, shareA: shareA, rsSince: rs && DAY_RE.test(rs.sales_since || "") ? rs.sales_since : "",
      net: incA - costA - shareA
    };
  }

  // Every title with something in the shop, biggest cost first.
  function overview(pub, acct, recs, rs, sku) {
    var out = [];
    ((pub && pub.titles) || []).forEach(function (tt) {
      var pids = pidsOf(tt, acct, sku);
      if (!Object.keys(pids).length) return;
      var f = forTitle(recs, pids, rs, pub.set);
      if (!f.any) return;
      out.push({ id: tt.id, t: tt.t, inc: f.incA, cost: f.costA, share: f.shareA, net: f.net,
                 n: f.inc.sales.q + f.inc.trade.q });
    });
    return out.sort(function (a, b) { return b.cost - a.cost || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); });
  }

  // ---------- The ledger's own report (Production Ledger 1.1+) ----------
  // GET /wc/v3/pl/report: per product, net of VAT, cents: revenue
  // (retail, trade, offsite), shipping charged, direct costs by category,
  // its shares of the month's pooled shipping, consumables and payment
  // fees, creator payouts (Revenue Splitter, the publisher's own names
  // left out), VAT out and in, net, net since the start, break-even.
  // The same figures as the report screen on the site.
  var MONEY = ["retail", "trade", "offsite", "revenue", "vat_out", "vat_in", "creators_rs", "shipping_charged",
               "shipping_cost", "consumables", "payment_fees", "costs_total", "net"];
  function repReq(from, to) {
    var q = [];
    if (DAY_RE.test(from || "")) q.push("from=" + from);
    if (DAY_RE.test(to || "")) q.push("to=" + to);
    return { m: "GET", path: "/pl/report" + (q.length ? "?" + q.join("&") : "") };
  }
  function int(v) { return typeof v === "number" && Math.floor(v) === v && Math.abs(v) <= MAX_CENTS ? v : 0; }
  function okRep(j) {
    return !!j && typeof j === "object" && j.source === "production-ledger" && Array.isArray(j.products) &&
           DAY_RE.test(j.from || "") && DAY_RE.test(j.to || "");
  }
  function zero() {
    var z = { units_retail: 0, units_trade: 0, costs: {}, net_since_start: 0, be: null, rows: 0 };
    MONEY.forEach(function (k) { z[k] = 0; });
    return z;
  }
  // The report's rows for some products, summed.
  function repSum(rep, pids) {
    var z = zero(), be = 0, beAny = false;
    (rep && Array.isArray(rep.products) ? rep.products : []).forEach(function (p) {
      if (!p || !pids[p.pid]) return;
      z.rows++;
      z.units_retail += int(p.units_retail);
      z.units_trade += int(p.units_trade);
      MONEY.forEach(function (k) { z[k] += int(p[k]); });
      if (p.costs && typeof p.costs === "object") {
        Object.keys(p.costs).forEach(function (c) {
          var k = CATS.indexOf(c) >= 0 ? c : "general";
          z.costs[k] = (z.costs[k] || 0) + int(p.costs[c]);
        });
      }
      z.net_since_start += int(typeof p.net_since_start === "number" ? p.net_since_start : p.net);
      if (typeof p.break_even === "number" && p.break_even > 0) { be += Math.floor(p.break_even); beAny = true; }
    });
    z.be = beAny ? be : null;
    return z;
  }
  function inRange(d, from, to) { return !!d && (!from || d >= from) && (!to || d <= to); }
  // Royalties from the title's own terms (Publishing, wave P6), for a
  // title Revenue Splitter pays nobody for and with no «Creators» cost:
  // pct of the list price (the format's price × its units) or of what
  // came in; an advance paid counts in full while earnings are below it.
  function royEst(title, pids, rep, z) {
    var terms = (title && title.roy) || [];
    if (!terms.length || z.creators_rs || z.costs.creators) return null;
    var fm = {};
    ((title && title.fmts) || []).forEach(function (f) { fm[f.id] = f; });
    var lines = [], total = 0;
    terms.forEach(function (r) {
      var base = 0;
      (rep && Array.isArray(rep.products) ? rep.products : []).forEach(function (p) {
        var f = p && pids[p.pid] ? fm[pids[p.pid]] : null;
        if (!f || (r.k && f.k !== r.k)) return;
        if (r.base === "net") base += int(p.retail) + int(p.trade) + int(p.offsite);
        else base += Math.round((f.price || 0) * 100) * (int(p.units_retail) + int(p.units_trade));
      });
      var earned = Math.round(base * (r.pct || 0) / 100), adv = Math.round((r.adv || 0) * 100);
      var a = Math.max(earned, adv);
      lines.push({ n: r.n, pct: r.pct || 0, base: r.base, earned: earned, adv: adv, a: a });
      total += a;
    });
    return { lines: lines, a: total };
  }
  // A title's whole picture: the report's figures, with each cost
  // category's entries (supplier, invoice) from the records.
  function titleReport(rep, recs, rs, title, pids, set) {
    var z = repSum(rep, pids);
    var direct = forTitle((recs || []).filter(function (r) {
      return r && typeof r.id === "string" && r.id.charAt(0) === "e" && (r.del || inRange(r.d, rep.from, rep.to));
    }), pids, rs, set);
    var rows = {};
    direct.costs.forEach(function (c) { rows[c.cat] = c.rows; });
    var costs = CATS.filter(function (k) { return z.costs[k]; }).map(function (k) {
      return { cat: k, a: z.costs[k], rows: rows[k] || [] };
    });
    var roy = royEst(title, pids, rep, z);
    var royA = roy ? roy.a : 0;
    var inc = { sales: { q: z.units_retail, a: z.retail }, trade: { q: z.units_trade, a: z.trade },
                offsite: { a: z.offsite, rows: direct.inc.offsite.rows }, ship: z.shipping_charged };
    var incA = z.revenue + z.shipping_charged;
    var costA = z.costs_total + royA;
    return {
      any: z.rows > 0, from: rep.from, to: rep.to, start: DAY_RE.test(rep.start || "") ? rep.start : "",
      inc: inc, incA: incA,
      costs: costs, direct: costs.reduce(function (s, c) { return s + c.a; }, 0),
      shared: { ship: z.shipping_cost, cons: z.consumables, fees: z.payment_fees },
      creators: z.creators_rs, shares: direct.shares, rsSince: direct.rsSince, roy: roy,
      costA: costA,
      vat: { out: z.vat_out, "in": z.vat_in, due: z.vat_out - z.vat_in },
      net: incA - costA, since: z.net_since_start - royA, be: roy ? null : z.be
    };
  }
  // Every title with figures, then the shop's other products and the
  // general expenses, so the last line is the ledger's grand total.
  function overviewRep(pub, acct, rep, sku) {
    var out = [], used = {};
    ((pub && pub.titles) || []).forEach(function (tt) {
      var pids = pidsOf(tt, acct, sku);
      if (!Object.keys(pids).length) return;
      var z = repSum(rep, pids);
      if (!z.rows) return;
      Object.keys(pids).forEach(function (k) { used[k] = true; });
      var roy = royEst(tt, pids, rep, z), royA = roy ? roy.a : 0;
      out.push({ id: tt.id, t: tt.t, n: z.units_retail + z.units_trade, inc: z.revenue + z.shipping_charged,
                 cost: z.costs_total + royA, net: z.net - royA, est: !!roy });
    });
    out.sort(function (a, b) { return a.net - b.net || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); });
    var other = { n: 0, inc: 0, cost: 0, net: 0, k: 0 };
    (rep && Array.isArray(rep.products) ? rep.products : []).forEach(function (p) {
      if (!p || used[p.pid]) return;
      other.k++;
      other.n += int(p.units_retail) + int(p.units_trade);
      other.inc += int(p.revenue) + int(p.shipping_charged);
      other.cost += int(p.costs_total);
      other.net += int(p.net);
    });
    var gen = rep && rep.general && typeof rep.general === "object" ? int(rep.general.total) : 0;
    var titles = out.reduce(function (s, r) { return s + r.net; }, 0);
    return { rows: out, other: other, general: gen, total: titles + other.net - gen };
  }

  var api = {
    CATS: CATS, recReq: recReq, rsReq: rsReq, repReq: repReq, okEnv: okEnv, okRep: okRep, read: read,
    pidsOf: pidsOf, unknownPids: unknownPids, skuMap: skuMap,
    isOwn: isOwn, forTitle: forTitle, overview: overview,
    repSum: repSum, royEst: royEst, titleReport: titleReport, overviewRep: overviewRep
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosPublishCosts = api;
})(typeof window !== "undefined" ? window : globalThis);
