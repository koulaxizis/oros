// ============================================================
// orOS Shop — pure model (OrosShopCore), no DOM, no network
// The figures of the person's own WooCommerce shops, read through
// Connected services (links/host.js orosLinks.call) and kept as
// aggregates only: totals, products, partners' shares, consignments.
// No customer's name, email, phone or address is ever stored here.
//
// Two sources, so the app works with any WooCommerce shop:
//   - base: WooCommerce's own REST reports (every shop):
//       GET /reports/sales?date_min&date_max   (today, month, year)
//       GET /reports/top_sellers?date_min&date_max   (this year)
//       GET /data/currencies/current
//   - extras: the free orOS Connect plugin (1.4+, module «Data for
//     orOS»), GET /oros/digest: { v, site, at, areas, errors }, where
//     each area is the read-only answer of a plugin the shop has
//     (sales, titles, stock, splits, costs, bookstores). A shop
//     without the plugin answers 404: the app shows the base only.
//
// Stored (localStorage oros-shop-data, synced, encrypted like every
// slice): { v: 1, shops: { <account id>: entry } }, entry =
//   { a, m (ms, read at), cur, base: { today, month, year, top },
//     xs ("" = extras read, or why not: "missing" | "auth" | "error"),
//     x: { on: [areas], err: { area: code }, sales, titles, stock,
//          splits, costs, stores } | null }
// Money is in cents (integers). One entry per shop, the newer read
// wins whole (merge: higher m, then the larger JSON), so
// merge(A,B) === merge(B,A) (R5) and get() is canonical (R26).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var KEY = "oros-shop-data";
  var AREAS = ["sales", "titles", "stock", "splits", "costs", "bookstores"];
  var ACCT = /^[A-Za-z0-9_-]{1,64}$/;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var CUR = /^[A-Z]{3}$/;
  var MAX_TITLES = 300, MAX_STOCK = 100, MAX_PARTNERS = 200, MAX_STORES = 200, MAX_COST_ROWS = 300, MAX_TOP = 50;
  var PULL_MS = 15 * 60 * 1000;   // while the app is open

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function int(v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; }
  // "12.30" / 12.3 → 1230
  function cents(v) {
    var n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  // a name as the shop sends it: entities decoded, plain text, bounded
  function name(v, max) {
    if (typeof v !== "string" && typeof v !== "number") return "";
    var s = String(v)
      .replace(/&#(\d{1,7});/g, function (m, d) { var c = +d; return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
      .replace(/&#x([0-9a-f]{1,6});/gi, function (m, h) { var c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
      .replace(/&quot;/g, "\"").replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/<[^>]*>/g, "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return s.slice(0, max || 160);
  }
  function code(v) { return typeof v === "string" && /^[a-z0-9_-]{1,40}$/.test(v) ? v : "error"; }
  function ymd(v) { return typeof v === "string" && YMD.test(v) ? v : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  // ---------- requests ----------
  // today = "YYYY-MM-DD" (the device's day). fresh: skip the shop's
  // kept answer when it is older than a minute (the Refresh button).
  function reqs(today, fresh) {
    var y = today.slice(0, 4), m = today.slice(0, 7);
    return [
      { m: "GET", path: "/reports/sales?date_min=" + today + "&date_max=" + today },
      { m: "GET", path: "/reports/sales?date_min=" + m + "-01&date_max=" + today },
      { m: "GET", path: "/reports/sales?date_min=" + y + "-01-01&date_max=" + today },
      { m: "GET", path: "/reports/top_sellers?date_min=" + y + "-01-01&date_max=" + today },
      { m: "GET", path: "/data/currencies/current" },
      { m: "GET", path: "/oros/digest" + (fresh ? "?fresh=1" : "") }
    ];
  }

  // ---------- base: WooCommerce's own reports ----------
  // /reports/sales → [{ total_sales, net_sales, total_orders, total_items, total_refunds, total_customers }]
  function parseSales(d) {
    var r = Array.isArray(d) ? d[0] : d;
    if (!isObj(r) || r.total_sales === undefined) return null;
    return { g: cents(r.total_sales), n: cents(r.net_sales), o: int(r.total_orders), i: int(r.total_items), r: cents(r.total_refunds) };
  }
  // /reports/top_sellers → [{ title, product_id, quantity }]
  function parseTop(d) {
    if (!Array.isArray(d)) return [];
    return d.filter(isObj).map(function (x) { return { id: int(x.product_id), n: name(x.name || x.title), q: int(x.quantity) }; })
      .filter(function (x) { return x.n; }).slice(0, MAX_TOP);
  }

  // ---------- extras: orOS Connect's digest ----------
  // store-pulse/overview → one period
  function pSales(x) {
    if (!isObj(x)) return null;
    var c = isObj(x.completed) ? x.completed : {};
    var out = { o: int(c.count), g: cents(c.gross), cu: int(c.customers), aov: cents(c.aov),
                pe: int(isObj(x.pending) ? x.pending.count : 0), ca: int(isObj(x.cancelled) ? x.cancelled.count : 0),
                rf: int(isObj(x.refunds) ? x.refunds.count : 0), ra: cents(isObj(x.refunds) ? x.refunds.amount : 0) };
    if (isObj(x.money) && x.money.share !== undefined) out.own = cents(x.money.share);
    if (isObj(x.period)) { out.from = ymd(x.period.start); out.to = ymd(x.period.end); }
    return out;
  }
  // store-pulse/sales → { rows: [{ id, name, qty, sales, net, orders, stock }], totals }
  function pTitles(x) {
    if (!isObj(x) || !Array.isArray(x.rows)) return null;
    var t = isObj(x.totals) ? x.totals : {};
    return {
      rows: x.rows.filter(isObj).map(function (r) {
        return { id: int(r.id), n: name(r.name), q: int(r.qty), s: cents(r.sales), nt: cents(r.net), o: int(r.orders), rq: int(r.ref_qty),
                 st: r.stock === "outofstock" ? "out" : r.stock === "onbackorder" ? "back" : "" };
      }).filter(function (r) { return r.n; }).slice(0, MAX_TITLES),
      q: int(t.qty), s: cents(t.sales), nt: cents(t.net), o: int(t.orders)
    };
  }
  // store-pulse/stock → { threshold, low: { count, items }, out: { count, items } }
  function pStock(x) {
    if (!isObj(x)) return null;
    function list(o) { return isObj(o) && Array.isArray(o.items) ? o.items.filter(isObj).map(function (i) { return { id: int(i.id), n: name(i.title), s: int(i.stock) }; }).filter(function (i) { return i.n; }).slice(0, MAX_STOCK) : []; }
    return { th: int(x.threshold), lc: int(isObj(x.low) ? x.low.count : 0), oc: int(isObj(x.out) ? x.out.count : 0), low: list(x.low), out: list(x.out) };
  }
  // revenue-splitter/balances → { sales_since, beneficiaries: [{ name, sales, income, deductions, payments, remaining }] }
  function pSplits(x) {
    if (!isObj(x) || !Array.isArray(x.beneficiaries)) return null;
    return {
      since: ymd(x.sales_since),
      rows: x.beneficiaries.filter(isObj).map(function (b) {
        return { n: name(b.name), s: cents(b.sales), inc: cents(b.income), ded: cents(b.deductions), pay: cents(b.payments), rem: cents(b.remaining) };
      }).filter(function (b) { return b.n; }).slice(0, MAX_PARTNERS)
    };
  }
  // production-ledger/report → { period, currency, products: [...], totals, general, grand_total }
  function pCosts(x) {
    if (!isObj(x) || !isObj(x.totals)) return null;
    var t = x.totals, p = isObj(x.period) ? x.period : {};
    return {
      from: ymd(p.from), to: ymd(p.to), cur: CUR.test(x.currency || "") ? x.currency : "",
      rev: cents(t.revenue), ct: cents(t.costs_total), nt: cents(t.net), u: int(t.units),
      gen: cents(isObj(x.general) ? x.general.total : 0), all: cents(x.grand_total),
      rows: (Array.isArray(x.products) ? x.products : []).filter(isObj).map(function (r) {
        return { id: int(r.product_id), n: name(r.title), u: int(r.units), rev: cents(r.revenue), ct: cents(r.costs_total), nt: cents(r.net) };
      }).filter(function (r) { return r.n; }).slice(0, MAX_COST_ROWS)
    };
  }
  // trade-accounts/consignment-summary → { as_of, products: { <id>: [{ account, name, city, given, sold, returned, open, due, overdue, sold_value_c, collected_c, owed_c }] } }
  // summed per reseller (one row per shop that holds stock)
  function pStores(x, today) {
    if (!isObj(x) || !isObj(x.products)) return null;
    var by = {}, order = [];
    Object.keys(x.products).sort().forEach(function (pid) {
      var rows = x.products[pid];
      if (!Array.isArray(rows)) return;
      rows.filter(isObj).forEach(function (r) {
        var id = String(int(r.account)), n = name(r.name);
        if (!n) return;
        if (!has(by, id)) { by[id] = { id: id, n: n, city: name(r.city, 60), given: 0, sold: 0, ret: 0, open: 0, val: 0, col: 0, owed: 0, od: 0, due: "", t: 0 }; order.push(id); }
        var s = by[id];
        s.t++;
        s.given += int(r.given); s.sold += int(r.sold); s.ret += int(r.returned); s.open += int(r.open);
        s.val += r.sold_value_c !== undefined ? int(r.sold_value_c) : cents(r.sold_value);
        s.col += r.collected_c !== undefined ? int(r.collected_c) : cents(r.collected);
        s.owed += r.owed_c !== undefined ? int(r.owed_c) : cents(r.owed);
        var due = ymd(r.due);
        if (r.overdue === true || (due && today && due < today && int(r.open) > 0)) s.od++;
        if (due && int(r.open) > 0 && (!s.due || due < s.due)) s.due = due;
      });
    });
    return { asOf: ymd(x.as_of), rows: order.map(function (id) { return by[id]; }).slice(0, MAX_STORES) };
  }

  // the digest → x (or null when it is not one)
  function parseDigest(d, today) {
    if (!isObj(d) || !isObj(d.areas)) return null;
    var a = d.areas, out = { on: [], err: {} };
    AREAS.forEach(function (k) {
      if (!has(a, k) || !isObj(a[k])) return;
      var v = a[k], r = null;
      if (k === "sales") {
        r = {};
        ["today", "month", "year"].forEach(function (s) { var p = pSales(v[s]); if (p) r[s] = p; });
        if (!Object.keys(r).length) r = null;
      } else if (k === "titles") r = pTitles(v.year);
      else if (k === "stock") r = pStock(v.now);
      else if (k === "splits") r = pSplits(v.now);
      else if (k === "costs") r = pCosts(v.year);
      else if (k === "bookstores") r = pStores(v.now, today);
      if (r) { out[k === "bookstores" ? "stores" : k] = r; out.on.push(k); }
    });
    if (isObj(d.errors)) Object.keys(d.errors).sort().forEach(function (k) { if (AREAS.indexOf(k) >= 0) out.err[k] = code(d.errors[k]); });
    return out;
  }

  // the answers of reqs() → an entry, or { fail: code } when even the
  // base could not be read. statusCode = orosLinks.statusCode.
  function fromAnswers(acct, res, now, today, statusCode) {
    if (!Array.isArray(res) || res.length < 6) return { fail: "network" };
    var c0 = statusCode(res[0]);
    if (c0) return { fail: c0 };
    var base = { today: parseSales(res[0].data), month: statusCode(res[1]) ? null : parseSales(res[1].data),
                 year: statusCode(res[2]) ? null : parseSales(res[2].data), top: statusCode(res[3]) ? [] : parseTop(res[3].data) };
    if (!base.today) return { fail: "server" };
    var cur = !statusCode(res[4]) && isObj(res[4].data) && CUR.test(res[4].data.code || "") ? res[4].data.code : "";
    var xc = statusCode(res[5]), x = null, xs = "";
    if (xc === "notfound") xs = "missing";
    else if (xc === "auth") xs = "auth";
    else if (xc) xs = "error";
    else { x = parseDigest(res[5].data, today); if (!x) xs = "error"; }
    return norm({ a: acct, m: now, cur: cur, base: base, xs: xs, x: x });
  }

  // ---------- canonical form, merge ----------
  function nSales(s) {
    if (!isObj(s)) return null;
    return { g: int(s.g), n: int(s.n), o: int(s.o), i: int(s.i), r: int(s.r) };
  }
  function pick(o, keys) {
    var out = {};
    keys.forEach(function (k) { if (has(o, k) && o[k] !== undefined) out[k] = o[k]; });
    return out;
  }
  // an entry in canonical key order, or null
  function norm(e) {
    if (!isObj(e) || typeof e.a !== "string" || !ACCT.test(e.a)) return null;
    var m = int(e.m);
    if (m <= 0) return null;
    var b = isObj(e.base) ? e.base : {};
    var out = {
      a: e.a, m: m, cur: CUR.test(e.cur || "") ? e.cur : "",
      base: { today: nSales(b.today), month: nSales(b.month), year: nSales(b.year),
              top: Array.isArray(b.top) ? b.top.filter(isObj).map(function (t) { return { id: int(t.id), n: name(t.n), q: int(t.q) }; }).filter(function (t) { return t.n; }).slice(0, MAX_TOP) : [] },
      xs: e.xs === "missing" || e.xs === "auth" || e.xs === "error" ? e.xs : "",
      x: null
    };
    if (isObj(e.x)) {
      var x = e.x, nx = { on: Array.isArray(x.on) ? AREAS.filter(function (k) { return x.on.indexOf(k) >= 0; }) : [], err: {} };
      if (isObj(x.err)) Object.keys(x.err).sort().forEach(function (k) { if (AREAS.indexOf(k) >= 0) nx.err[k] = code(x.err[k]); });
      if (isObj(x.sales)) {
        nx.sales = {};
        ["today", "month", "year"].forEach(function (k) {
          if (isObj(x.sales[k])) {
            var s = x.sales[k], o = { o: int(s.o), g: int(s.g), cu: int(s.cu), aov: int(s.aov), pe: int(s.pe), ca: int(s.ca), rf: int(s.rf), ra: int(s.ra) };
            if (s.own !== undefined) o.own = int(s.own);
            if (ymd(s.from)) o.from = s.from;
            if (ymd(s.to)) o.to = s.to;
            nx.sales[k] = o;
          }
        });
      }
      if (isObj(x.titles) && Array.isArray(x.titles.rows)) {
        nx.titles = { rows: x.titles.rows.filter(isObj).map(function (r) { return { id: int(r.id), n: name(r.n), q: int(r.q), s: int(r.s), nt: int(r.nt), o: int(r.o), rq: int(r.rq), st: r.st === "out" || r.st === "back" ? r.st : "" }; }).filter(function (r) { return r.n; }).slice(0, MAX_TITLES),
                      q: int(x.titles.q), s: int(x.titles.s), nt: int(x.titles.nt), o: int(x.titles.o) };
      }
      if (isObj(x.stock)) {
        var li = function (l) { return Array.isArray(l) ? l.filter(isObj).map(function (i) { return { id: int(i.id), n: name(i.n), s: int(i.s) }; }).filter(function (i) { return i.n; }).slice(0, MAX_STOCK) : []; };
        nx.stock = { th: int(x.stock.th), lc: int(x.stock.lc), oc: int(x.stock.oc), low: li(x.stock.low), out: li(x.stock.out) };
      }
      if (isObj(x.splits) && Array.isArray(x.splits.rows)) {
        nx.splits = { since: ymd(x.splits.since), rows: x.splits.rows.filter(isObj).map(function (r) { return { n: name(r.n), s: int(r.s), inc: int(r.inc), ded: int(r.ded), pay: int(r.pay), rem: int(r.rem) }; }).filter(function (r) { return r.n; }).slice(0, MAX_PARTNERS) };
      }
      if (isObj(x.costs)) {
        var c = x.costs;
        nx.costs = { from: ymd(c.from), to: ymd(c.to), cur: CUR.test(c.cur || "") ? c.cur : "", rev: int(c.rev), ct: int(c.ct), nt: int(c.nt), u: int(c.u), gen: int(c.gen), all: int(c.all),
                     rows: Array.isArray(c.rows) ? c.rows.filter(isObj).map(function (r) { return { id: int(r.id), n: name(r.n), u: int(r.u), rev: int(r.rev), ct: int(r.ct), nt: int(r.nt) }; }).filter(function (r) { return r.n; }).slice(0, MAX_COST_ROWS) : [] };
      }
      if (isObj(x.stores) && Array.isArray(x.stores.rows)) {
        nx.stores = { asOf: ymd(x.stores.asOf), rows: x.stores.rows.filter(isObj).map(function (s) {
          return { id: String(s.id || "").slice(0, 20), n: name(s.n), city: name(s.city, 60), given: int(s.given), sold: int(s.sold), ret: int(s.ret), open: int(s.open),
                   val: int(s.val), col: int(s.col), owed: int(s.owed), od: int(s.od), due: ymd(s.due), t: int(s.t) };
        }).filter(function (s) { return s.n; }).slice(0, MAX_STORES) };
      }
      out.x = pick(nx, ["on", "err", "sales", "titles", "stock", "splits", "costs", "stores"]);
    }
    return out;
  }
  function empty() { return { v: VER, shops: {} }; }
  function normalize(d) {
    var out = empty();
    if (!isObj(d) || !isObj(d.shops)) return out;
    Object.keys(d.shops).sort().forEach(function (k) {
      var e = norm(d.shops[k]);
      if (e && e.a === k) out.shops[k] = e;
    });
    return out;
  }
  function serialize(d) { return JSON.stringify(normalize(d)); }
  // per shop the newer read wins whole; equal times → the larger JSON
  function merge(a, b) {
    var A = normalize(a), B = normalize(b), out = empty();
    var keys = Object.keys(A.shops).concat(Object.keys(B.shops)).filter(function (k, i, l) { return l.indexOf(k) === i; }).sort();
    keys.forEach(function (k) {
      var x = A.shops[k], y = B.shops[k];
      if (!x || !y) { out.shops[k] = x || y; return; }
      if (x.m !== y.m) { out.shops[k] = x.m > y.m ? x : y; return; }
      var jx = JSON.stringify(x), jy = JSON.stringify(y);
      out.shops[k] = jx >= jy ? x : y;
    });
    return out;
  }
  function put(d, entry) {
    var out = normalize(d), e = norm(entry);
    if (e) out.shops[e.a] = e;
    return out;
  }

  // ---------- views ----------
  // the figures to show for a period: the plugin's (paid orders, own
  // rules) when present, else WooCommerce's report
  function period(e, k) {
    if (!e) return null;
    var xs = e.x && e.x.sales && e.x.sales[k];
    if (xs) return { src: "x", o: xs.o, g: xs.g, cu: xs.cu, aov: xs.aov, pe: xs.pe, ca: xs.ca, rf: xs.rf, ra: xs.ra, own: xs.own };
    var b = e.base && e.base[k];
    if (b) return { src: "base", o: b.o, g: b.g, n: b.n, i: b.i, r: b.r, aov: b.o ? Math.round(b.g / b.o) : 0 };
    return null;
  }
  // the products of this year, best first (plugin rows, else top sellers)
  function products(e) {
    if (!e) return [];
    if (e.x && e.x.titles) return e.x.titles.rows.slice().sort(function (p, q) { return q.q - p.q || q.s - p.s || (p.n < q.n ? -1 : p.n > q.n ? 1 : 0); });
    return (e.base && e.base.top || []).map(function (t) { return { id: t.id, n: t.n, q: t.q }; });
  }
  // partners with money still owed first
  function partners(e) {
    if (!e || !e.x || !e.x.splits) return [];
    return e.x.splits.rows.slice().sort(function (p, q) { return q.rem - p.rem || (p.n < q.n ? -1 : p.n > q.n ? 1 : 0); });
  }
  function stores(e) {
    if (!e || !e.x || !e.x.stores) return [];
    return e.x.stores.rows.slice().sort(function (p, q) { return q.od - p.od || q.owed - p.owed || q.open - p.open || (p.n < q.n ? -1 : p.n > q.n ? 1 : 0); });
  }
  // which tabs have something to show (a shop without consignments
  // never sees that tab)
  function tabs(e) {
    var t = ["today", "money", "products"];
    if (e && e.x && e.x.splits && e.x.splits.rows.length) t.push("partners");
    if (e && e.x && e.x.stores && e.x.stores.rows.length) t.push("stores");
    return t;
  }
  // is the entry due for a new read?
  function stale(e, now) { return !e || now - e.m >= PULL_MS; }
  // does the shop's figure need the extras plugin? → the areas missing
  function missing(e) {
    if (!e || !e.x) return AREAS.slice();
    return AREAS.filter(function (k) { return e.x.on.indexOf(k) < 0; });
  }

  // a fold for search (accents off, final sigma)
  // i18n-inline-ok: final sigma folded for name matching, data not text
  function fold(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ"); }

  var api = {
    VER: VER, KEY: KEY, AREAS: AREAS, PULL_MS: PULL_MS,
    cents: cents, name: name, dayOf: dayOf,
    reqs: reqs, parseSales: parseSales, parseTop: parseTop, parseDigest: parseDigest, fromAnswers: fromAnswers,
    empty: empty, normalize: normalize, serialize: serialize, merge: merge, put: put,
    period: period, products: products, partners: partners, stores: stores, tabs: tabs, stale: stale, missing: missing, fold: fold
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShopCore = api;
})(typeof window !== "undefined" ? window : this);
