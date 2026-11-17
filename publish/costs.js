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
//
// Production Ledger 1.3+ (wave P16, «Ανάλυση τίτλου») also answers
// GET /wc/v3/pl/analysis: per product, copies by sales channel and by
// delivery method, free copies (Revenue Splitter's register) with their
// recipients, consignments per bookstore and promotion cost per
// material; with the material price list (dated versions) and the
// promotion package. Amounts there are euros (2 decimals), turned into
// cents here. The same data the «Title analysis» tab on the site shows;
// orOS writes back only through the ledger's own typed routes
// (POST /pl/rates, /pl/promo-apply, /pl/event-sale): one copy, on the site.
//   CHANNELS, DELIVERIES         the keys, in the ledger's order
//   anaReq(from, to)             → a /pl/analysis request (every title)
//   okAna(j)                     → is j an analysis answer
//   anaSum(ana, pids)            → the title's analysis, its products summed
//   rateBody(o), promoBody(pid, day, dry), saleBody(o) → checked bodies, or null
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

  // ---------- Title analysis (Production Ledger 1.3+, wave P16) ----------
  var CHANNELS = ["full", "discount", "bundle", "free_order", "import", "event", "trade", "consignment", "author_buy", "free"];
  var DELIVERIES = ["allover", "boxnow", "warehouse", "grafo", "pickup_other", "hand", "none", "other"];
  var SOLD = ["full", "discount", "bundle", "import", "event", "trade", "consignment", "author_buy"];
  var KEY_RE = /^[a-z0-9_]{1,40}$/;
  function eur(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= MAX_CENTS / 100 ? Math.round(v * 100) : 0; }
  function qn(v) { return typeof v === "number" && Math.floor(v) === v && v >= 0 && v < 1e7 ? v : 0; }
  function anaReq(from, to) {
    var q = [];
    if (DAY_RE.test(from || "")) q.push("from=" + from);
    if (DAY_RE.test(to || "")) q.push("to=" + to);
    return { m: "GET", path: "/pl/analysis" + (q.length ? "?" + q.join("&") : "") };
  }
  function okAna(j) {
    return !!j && typeof j === "object" && j.source === "production-ledger" && Array.isArray(j.titles) &&
           DAY_RE.test(j.from || "") && DAY_RE.test(j.to || "");
  }
  // A title's analysis: every one of its products summed. Promotion
  // lines by material (item key); free copies and consignments listed.
  function anaSum(ana, pids) {
    var ch = {}, dl = {}, promo = {}, free = [], stores = {}, events = {};
    CHANNELS.forEach(function (k) { ch[k] = { q: 0, a: 0 }; });
    DELIVERIES.forEach(function (k) { dl[k] = 0; });
    var rows = 0, stock = null, orders = 0;
    (ana && Array.isArray(ana.titles) ? ana.titles : []).forEach(function (r) {
      if (!r || !pids[r.product_id]) return;
      rows++;
      orders += qn(r.orders);
      if (typeof r.stock === "number" && isFinite(r.stock)) stock = (stock || 0) + Math.floor(r.stock);
      (Array.isArray(r.channels) ? r.channels : []).forEach(function (c) {
        if (!c || !ch[c.key]) return;
        ch[c.key].q += qn(c.qty);
        ch[c.key].a += eur(c.net);
      });
      (Array.isArray(r.delivery) ? r.delivery : []).forEach(function (d) {
        if (d && has(dl, d.key)) dl[d.key] += qn(d.qty);
      });
      (Array.isArray(r.events) ? r.events : []).forEach(function (e) {
        var n = txt(e && e.name, 120);
        if (n) events[n] = (events[n] || 0) + qn(e.qty);
      });
      (Array.isArray(r.free_list) ? r.free_list : []).forEach(function (f) {
        if (!f) return;
        free.push({ d: DAY_RE.test(f.date || "") ? f.date : "", type: txt(f.type, 20), q: qn(f.qty),
                    to: txt(f.recipient, 120), kind: txt(f.kind, 20), ben: txt(f.ben, 120) });
      });
      (Array.isArray(r.stores) ? r.stores : []).forEach(function (s) {
        var n = txt(s && s.name, 120) || "?";
        var x = stores[n] || (stores[n] = { n: n, given: 0, sold: 0, ret: 0, shelf: 0, owed: 0 });
        x.given += qn(s.given); x.sold += qn(s.sold); x.ret += qn(s.returned); x.shelf += qn(s.shelf); x.owed += eur(s.owed);
      });
      var pr = r.promo && Array.isArray(r.promo.lines) ? r.promo.lines : [];
      pr.forEach(function (l) {
        var k = l && typeof l.item === "string" && (KEY_RE.test(l.item) || l.item === "_other") ? l.item : "";
        if (!k) return;
        var x = promo[k] || (promo[k] = { item: k, label: txt(l.label, 80) || k, q: 0, net: 0, vat: 0 });
        x.q += qn(l.qty); x.net += eur(l.net); x.vat += eur(l.vat);
      });
    });
    var sold = 0, rev = 0;
    SOLD.forEach(function (k) { sold += ch[k].q; rev += ch[k].a; });
    var promoList = Object.keys(promo).map(function (k) { return promo[k]; })
      .sort(function (a, b) { return a.item === "_other" ? 1 : b.item === "_other" ? -1 : b.net - a.net; });
    free.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return {
      any: rows > 0, from: ana ? ana.from : "", to: ana ? ana.to : "", stock: stock, orders: orders,
      sold: sold, rev: rev, free: ch.free.q + ch.free_order.q,
      channels: CHANNELS.map(function (k) { return { key: k, q: ch[k].q, a: ch[k].a }; }).filter(function (c) { return c.q || c.a; }),
      delivery: DELIVERIES.map(function (k) { return { key: k, q: dl[k] }; }).filter(function (d) { return d.q; }),
      events: Object.keys(events).sort().map(function (n) { return { n: n, q: events[n] }; }),
      freeList: free,
      stores: Object.keys(stores).sort().map(function (n) { return stores[n]; }),
      promo: promoList,
      promoNet: promoList.reduce(function (s, l) { return s + l.net; }, 0),
      promoVat: promoList.reduce(function (s, l) { return s + l.vat; }, 0)
    };
  }
  // The price list as the ledger sends it, cents (net) per version.
  function rates(ana) {
    var r = ana && ana.rates && Array.isArray(ana.rates.items) ? ana.rates.items : [];
    return r.filter(function (it) { return it && KEY_RE.test(it.key || ""); }).map(function (it) {
      return {
        key: it.key, label: txt(it.label, 80) || it.key, inPkg: qn(it.in_pkg),
        cur: typeof it.current === "number" ? it.current : null,
        vers: (Array.isArray(it.versions) ? it.versions : []).filter(function (v) { return v && DAY_RE.test(v.from || ""); }).map(function (v) {
          return { from: v.from, net: typeof v.net === "number" ? v.net : 0, rate: typeof v.vat_rate === "number" ? v.vat_rate : 0,
                   gross: typeof v.gross === "number" ? v.gross : 0, sup: txt(v.supplier, 120), inv: txt(v.invoice, 60),
                   note: txt(v.note, 300), chg: typeof v.change === "number" ? v.change : null };
        })
      };
    });
  }
  function pkg(ana) {
    var p = ana && ana.rates && ana.rates.package;
    if (!p || typeof p !== "object") return null;
    return { day: DAY_RE.test(p.day || "") ? p.day : "", net: eur(p.net), vat: eur(p.vat), gross: eur(p.gross),
             missing: Array.isArray(p.missing) ? p.missing.filter(function (k) { return typeof k === "string"; }) : [],
             lines: (Array.isArray(p.lines) ? p.lines : []).map(function (l) {
               return { item: txt(l && l.item, 40), label: txt(l && l.label, 80), q: qn(l && l.qty), net: eur(l && l.net), vat: eur(l && l.vat) };
             }) };
  }

  // ---------- Bodies for the ledger's typed POST routes ----------
  // Each the same shape links/core.js ALLOW.woo accepts; null = refused here first.
  function money4(v) {
    var n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
    return typeof n === "number" && isFinite(n) && n >= 0 && n < 1e6 ? Math.round(n * 10000) / 10000 : null;
  }
  function money2(v) {
    var n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
    return typeof n === "number" && isFinite(n) && n >= 0 && n < 1e7 ? (Math.round(n * 100) / 100).toFixed(2) : null;
  }
  // A new price (a dated version) of a material, or a new material.
  function rateBody(o) {
    o = o || {};
    var key = typeof o.key === "string" ? o.key.trim() : "";
    var net = money4(o.net), noRate = o.rate === undefined || o.rate === null || o.rate === "";
    var rate = noRate ? "" : money2(o.rate);
    if (!KEY_RE.test(key) || !DAY_RE.test(o.from || "") || net === null || rate === null || +rate > 100) return null;
    var b = { key: key, from: o.from, net: String(net) };
    if (!noRate) b.vat_rate = rate;   // left out: the site's 24 %
    [["label", 80], ["supplier", 120], ["invoice", 60], ["note", 200]].forEach(function (f) {
      var v = txt(o[f[0]], f[1]);
      if (v) b[f[0]] = v;
    });
    return b;
  }
  function promoBody(p, day, dry) {
    if (!pid(p) || !DAY_RE.test(day || "")) return null;
    return { product_id: p, date: day, dry_run: !!dry };
  }
  // A sale at an event: 1–50 lines; price is the unit price incl. VAT
  // (left out = the shop's price).
  function saleBody(o) {
    o = o || {};
    var ev = txt(o.event, 120);
    if (!DAY_RE.test(o.date || "") || !ev || (o.payment !== "cash" && o.payment !== "card")) return null;
    var lines = Array.isArray(o.lines) ? o.lines : [];
    if (!lines.length || lines.length > 50) return null;
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i] || {}, q = l.qty;
      if (!pid(l.product_id) || typeof q !== "number" || Math.floor(q) !== q || q < 1 || q > 999) return null;
      var x = { product_id: l.product_id, qty: q };
      if (l.price !== undefined && l.price !== "" && l.price !== null) {
        var pr = money2(l.price);
        if (pr === null) return null;
        x.price = pr;
      }
      out.push(x);
    }
    var b = { date: o.date, event: ev, payment: o.payment, lines: out, dry_run: !!o.dry_run };
    var note = txt(o.note, 300);
    if (note) b.note = note;
    return b;
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  var api = {
    CATS: CATS, recReq: recReq, rsReq: rsReq, repReq: repReq, okEnv: okEnv, okRep: okRep, read: read,
    pidsOf: pidsOf, unknownPids: unknownPids, skuMap: skuMap,
    isOwn: isOwn, forTitle: forTitle, overview: overview,
    repSum: repSum, royEst: royEst, titleReport: titleReport, overviewRep: overviewRep,
    CHANNELS: CHANNELS, DELIVERIES: DELIVERIES, anaReq: anaReq, okAna: okAna, anaSum: anaSum, rates: rates, pkg: pkg,
    rateBody: rateBody, promoBody: promoBody, saleBody: saleBody
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosPublishCosts = api;
})(typeof window !== "undefined" ? window : globalThis);
