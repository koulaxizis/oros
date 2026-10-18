// ============================================================
// orOS Connected services — WooCommerce mapping (links/woo.js, v1.0.0)
// Pure: turns what a WooCommerce shop answers (REST API v3) into
// orOS shapes. No DOM, no storage, no network; the Stock app makes
// the calls through the shell (orosLinks.call) and applies the plans.
//   - productPlan(S, stockData, products, variations, opts): products
//     as a Stock import plan (same shape as OrosStockCore.importPlan),
//     plus links (which Stock item is which shop product)
//   - compare(S, stockData, links): quantities that differ
//   - stockReq(link, q): the PUT that sets a quantity in the shop
//   - normOrder(o): one order, every field checked and cut to size
//   - outRequest / invoicePrefill / budgetPrefill / crmLog: an order
//     as the prefill each app's bridge takes (BR-ST-OUT, BR-CRM-INV
//     payload, BR-B1, BR-CRM-MAIL). Prefills only: nothing is saved
//     until the person saves it in that app.
// S = OrosStockCore (passed in, so this file has no load order).
// Everything that comes from the shop is plain text from here on:
// HTML in names is stripped and entities decoded, never rendered.
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  // Text written into the records an order prefills (invoice line and
  // notes, budget entry, CRM log). Greek when the caller says so, else
  // the page's pack language (i18n/<code>/links.js, "links" in
  // data-app), else English.
  var STR = {
    en: { "woo.ship": "Shipping", "woo.order": "Order #{no}" },
    el: { "woo.ship": "Μεταφορικά", "woo.order": "Παραγγελία #{no}" }
  };
  function tx(lang, k, no) {
    var I = typeof window !== "undefined" && window.orosI18n;
    var c = lang === "el" ? "el" : (I && I.lang() !== "el" ? I.lang() : "en");
    var tb = STR[c] || (I ? I.table(STR, "links", c) : STR.en);
    return (tb[k] || STR.en[k]).split("{no}").join(String(no));
  }

  var MAX_PRODUCTS = 5000, MAX_LINES = 100;
  var TEXT = 200;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isInt(v) { return isNum(v) && Math.floor(v) === v; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dict() { return Object.create(null); }

  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€" };
  // WooCommerce sends names with HTML entities (and sometimes tags):
  // tags out, entities decoded, control characters out, one line.
  function plain(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (all, e) {
      var cp = null;
      if (e[0] === "#") cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      else if (has(ENT, e.toLowerCase())) return ENT[e.toLowerCase()];
      if (cp === null || !(cp > 31 && cp < 0x110000) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 127) return all;
      return String.fromCodePoint(cp);
    });
    return L.cleanText(s, max || TEXT);
  }
  // "12.50" / 12.5 → 1250 cents; null when not money
  function cents(v) {
    var n = typeof v === "string" && /^-?[0-9]{1,10}(\.[0-9]{1,6})?$/.test(v.trim()) ? parseFloat(v) : (isNum(v) ? v : NaN);
    if (!isFinite(n) || Math.abs(n) > 999999999) return null;
    return Math.round(n * 100);
  }
  function wooId(v) { return isInt(v) && v > 0 && v < 1e12 ? v : 0; }
  // stock_quantity may be null, an int or (with some plugins) a float
  function shopQty(v) {
    if (!isNum(v) || Math.abs(v) > 1e9) return null;
    return Math.round(v * 1000);
  }
  function ymdOfIso(s) {
    return typeof s === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(s) ? s.slice(0, 10) : "";
  }

  // ---------- Products ----------
  // The sellable rows: simple products and the variations of variable
  // ones (the parent carries no stock of its own). Grouped and external
  // products are left out. → [{ pid, vid, name, sku, price, cat, q, managed }]
  function sellables(products, variations) {
    var out = [], vmap = variations && typeof variations === "object" ? variations : {};
    (Array.isArray(products) ? products : []).slice(0, MAX_PRODUCTS).forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var pid = wooId(p.id);
      if (!pid) return;
      var name = plain(p.name, 80);
      var cats = Array.isArray(p.categories) ? p.categories : [];
      var cat = cats.length && cats[0] ? plain(cats[0].name, 80) : "";
      if (p.type === "variable") {
        var vs = Array.isArray(vmap[pid]) ? vmap[pid] : [];
        vs.forEach(function (v) {
          if (!v || typeof v !== "object" || !wooId(v.id)) return;
          var opts = (Array.isArray(v.attributes) ? v.attributes : []).map(function (a) { return a ? plain(a.option, 40) : ""; }).filter(Boolean);
          // "parent": the variation shares its parent's stock; a count
          // per variation would be wrong, so it is not compared.
          var managed = v.manage_stock === true;
          out.push({
            pid: pid, vid: v.id,
            name: L.cleanText(name + (opts.length ? " – " + opts.join(" / ") : ""), 80) || name,
            sku: plain(v.sku, 40), price: cents(v.regular_price) !== null ? cents(v.regular_price) : cents(v.price),
            cat: cat, q: managed ? shopQty(v.stock_quantity) : null, managed: managed && shopQty(v.stock_quantity) !== null
          });
        });
        return;
      }
      if (p.type && p.type !== "simple") return;
      var m = p.manage_stock === true;
      out.push({
        pid: pid, vid: 0, name: name, sku: plain(p.sku, 40),
        price: cents(p.regular_price) !== null ? cents(p.regular_price) : cents(p.price),
        cat: cat, q: m ? shopQty(p.stock_quantity) : null, managed: m && shopQty(p.stock_quantity) !== null
      });
    });
    return out.filter(function (r) { return r.name; });
  }

  // The shop's products as a Stock import plan. Matching an existing
  // product: the id made for this shop product (imported before), then
  // the SKU, then the name (folded, like the CSV import). New products
  // get extId ids (R16). opts: { acct, now, today, setQty, vat }.
  // setQty: one stock count movement (ref "WooCommerce") brings each
  // managed product to the shop's quantity.
  function productPlan(S, data, products, variations, opts) {
    var o = opts || {}, now = isInt(o.now) ? o.now : Date.now();
    var res = { items: [], cats: [], sups: [], units: [], move: null, links: [],
                stats: { added: 0, updated: 0, same: 0, skipped: 0, qty: 0 }, ok: true };
    var items = (data && data.items) || [];
    var byId = dict(), bySku = dict(), byName = dict();
    items.forEach(function (it) {
      byId[it.id] = it;
      if (it.sku) bySku[S.fold(it.sku)] = it;
      if (!byName[S.fold(it.name)]) byName[S.fold(it.name)] = it;
    });
    var catMap = dict();
    ((data && data.cats) || []).forEach(function (c) { catMap[S.fold(c.name)] = c.id; });
    function catId(name) {
      if (!name) return "";
      var f = S.fold(name);
      if (catMap[f]) return catMap[f];
      var id = L.extId("woo", o.acct, "c", f);
      catMap[f] = id;
      res.cats.push({ id: id, m: now, name: name });
      return id;
    }
    var q = S.qtyMap(data), lines = [], seen = dict();
    sellables(products, variations).forEach(function (r) {
      var key = r.pid + ":" + r.vid;
      if (seen[key]) { res.stats.skipped++; return; }
      seen[key] = true;
      var xid = L.extId("woo", o.acct, "p", key);
      var cur = byId[xid] || (r.sku && bySku[S.fold(r.sku)]) || byName[S.fold(r.name)] || null;
      var row = cur ? JSON.parse(JSON.stringify(cur)) : { id: xid, m: now, name: r.name, vat: isInt(o.vat) ? o.vat : 24 };
      row.name = r.name;
      if (r.sku) row.sku = r.sku;
      if (r.price !== null && r.price >= 0) row.price = r.price;
      if (r.cat) row.cat = catId(r.cat);
      var clean = S.normItem(row);
      if (!clean) { res.stats.skipped++; return; }
      if (!cur) { clean.m = now; res.items.push(clean); res.stats.added++; }
      else {
        clean.m = cur.m;
        if (JSON.stringify(clean) === JSON.stringify(cur)) res.stats.same++;
        else { clean.m = Math.max(now, cur.m + 1); res.items.push(clean); res.stats.updated++; }
      }
      res.links.push({ item: clean.id, pid: r.pid, vid: r.vid, sku: r.sku, name: r.name, q: r.q, managed: r.managed });
      if (o.setQty && r.managed) {
        // a count line's n is the counted quantity (≥ 0): a negative
        // shop quantity is counted as 0
        var have = q[clean.id] || 0, target = Math.max(0, r.q);
        if (target !== have) { lines.push({ i: clean.id, q: target - have, n: target }); res.stats.qty++; }
      }
    });
    if (lines.length) {
      // a count line's n is the counted quantity (≥ 0); a negative shop
      // quantity is counted as 0
      lines = lines.map(function (l) { return { i: l.i, q: l.n - (q[l.i] || 0), n: l.n }; })
        .filter(function (l) { return l.q !== 0 || true; });
      res.move = { id: L.extId("woo", o.acct, "count", String(now)), m: now, d: o.today, t: "count",
                   ref: "WooCommerce", sup: "", note: "", lines: lines.slice(0, 500) };
    }
    return res;
  }

  // Stock items whose quantity differs from the shop's (managed
  // products only). → [{ item, link, mine, shop }] (thousandths)
  function compare(S, data, links) {
    var q = S.qtyMap(data), items = dict();
    ((data && data.items) || []).forEach(function (it) { items[it.id] = it; });
    var out = [];
    (links || []).forEach(function (l) {
      if (!l.managed || !items[l.item]) return;
      var mine = q[l.item] || 0;
      if (mine !== l.q) out.push({ item: items[l.item], link: l, mine: mine, shop: l.q });
    });
    return out.sort(function (a, b) { return S.fold(a.item.name) < S.fold(b.item.name) ? -1 : 1; });
  }
  // The request that sets the shop's quantity to q (thousandths; the
  // shop keeps whole units, so it is rounded).
  function stockReq(link, q) {
    var n = Math.round(q / 1000);
    var path = link.vid ? "/products/" + link.pid + "/variations/" + link.vid : "/products/" + link.pid;
    return { m: "PUT", path: path, body: { stock_quantity: n, manage_stock: true } };
  }

  // ---------- Orders ----------
  function party(b) {
    b = b && typeof b === "object" ? b : {};
    var name = L.cleanText(plain(b.first_name, 60) + " " + plain(b.last_name, 60), 120);
    var street = [plain(b.address_1, 120), plain(b.address_2, 120)].filter(Boolean).join(", ");
    var town = [plain(b.postcode, 20), plain(b.city, 80)].filter(Boolean).join(" ");
    return {
      name: name, company: plain(b.company, 120),
      email: /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/.test(String(b.email || "").trim()) ? String(b.email).trim().toLowerCase() : "",
      phone: plain(b.phone, 40), addr: [street, town].filter(Boolean).join("\n"),
      country: /^[A-Z]{2}$/.test(b.country || "") ? b.country : ""
    };
  }
  function normOrder(o) {
    if (!o || typeof o !== "object" || !wooId(o.id)) return null;
    var bill = party(o.billing), lines = [];
    (Array.isArray(o.line_items) ? o.line_items : []).slice(0, MAX_LINES).forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var qn = isNum(l.quantity) && l.quantity > 0 && l.quantity <= 1e6 ? l.quantity : 0;
      var total = cents(l.total), tax = cents(l.total_tax);
      if (!qn || total === null) return;
      lines.push({
        name: plain(l.name, 200) || "?", sku: plain(l.sku, 40), q: qn,
        pid: wooId(l.product_id), vid: wooId(l.variation_id),
        total: total, tax: tax === null ? 0 : tax
      });
    });
    var ship = 0, shipName = [];
    (Array.isArray(o.shipping_lines) ? o.shipping_lines : []).slice(0, 10).forEach(function (s) {
      var c = s ? cents(s.total) : null;
      if (c) { ship += c; shipName.push(plain(s.method_title, 60)); }
    });
    var cur = /^[A-Z]{3}$/.test(o.currency || "") ? o.currency : "EUR";
    var st = L.ORDER_ST.indexOf(o.status) >= 0 ? o.status : "pending";
    var total = cents(o.total);
    return {
      id: o.id, no: plain(String(o.number || o.id), 30), st: st,
      d: ymdOfIso(o.date_created) || ymdOfIso(o.date_created_gmt),
      at: typeof o.date_created === "string" ? o.date_created.slice(0, 16).replace("T", " ") : "",
      cur: cur, total: total === null ? 0 : total, tax: cents(o.total_tax) || 0,
      ship: ship, shipName: shipName.filter(Boolean).join(", "), shipTax: cents(o.shipping_tax) || 0,
      pay: plain(o.payment_method_title, 80), note: plain(o.customer_note, 500),
      bill: bill, lines: lines
    };
  }

  // BR-ST-OUT request: the order's lines as a sale. code(line) → the
  // Stock code for a line (its SKU, or the code of the item imported
  // for it); lines without a code are listed by name in `nocode`.
  function outRequest(order, acct, code) {
    var lines = [], nocode = [];
    order.lines.forEach(function (l) {
      var c = code ? code(l) : l.sku;
      if (!c) { nocode.push(l.name); return; }
      lines.push({ code: c, q: l.q, p: Math.round((l.total + l.tax) / l.q) });
    });
    return {
      req: { t: "out", d: order.d, src: "woo:" + acct + "-" + order.id, ref: "#" + order.no, lines: lines },
      nocode: nocode
    };
  }
  function vatOf(net, tax) {
    if (!(net > 0) || !(tax >= 0)) return null;
    var r = Math.round(tax / net * 1000) / 10;
    // snap to a whole rate when it is that rate rounded per line
    var w = Math.round(r);
    return Math.abs(r - w) <= 0.3 ? w : r;
  }
  // The BR-CRM-INV payload: lines net of VAT with their rate, shipping
  // as a line, the order number in the notes.
  function invoicePrefill(order, acct, lang) {
    var items = [];
    order.lines.forEach(function (l) {
      var it = { d: l.name, q: l.q, p: Math.round(l.total / l.q) / 100 };
      var v = vatOf(l.total, l.tax);
      if (v !== null) it.vat = v;
      if (l.sku) it.code = l.sku;
      items.push(it);
    });
    if (order.ship > 0) {
      var s = { d: tx(lang, "woo.ship") + (order.shipName ? " · " + order.shipName : ""), q: 1, p: order.ship / 100 };
      var sv = vatOf(order.ship, order.shipTax);
      if (sv !== null) s.vat = sv;
      items.push(s);
    }
    var b = order.bill;
    var out = {
      name: b.company || b.name, email: b.email, phone: b.phone, addr: b.addr, country: b.country,
      cur: order.cur, items: items.slice(0, 50),
      notes: tx(lang, "woo.order", order.no) + (order.pay ? " · " + order.pay : ""),
      ref: { app: "stock", id: ("woo-" + acct + "-" + order.id).slice(0, 60) }
    };
    if (b.company && b.name) out.job = b.name;
    return out;
  }
  // BR-B1: the order as income (gross, cents).
  function budgetPrefill(order, lang) {
    if (!(order.total > 0)) return null;
    return { k: "i", a: order.total, d: order.d || undefined, c: "i-other", src: "stock",
             n: (tx(lang, "woo.order", order.no) + " · " + (order.bill.company || order.bill.name)).slice(0, 140) };
  }
  // BR-CRM-MAIL: a log entry on the customer with that address (an
  // unknown address opens a new customer, prefilled).
  function crmLog(order, lang, money) {
    if (!order.bill.email) return null;
    var text = order.lines.map(function (l) { return l.q + " × " + l.name; }).join("\n");
    return {
      email: order.bill.email, name: order.bill.company || order.bill.name,
      subject: (tx(lang, "woo.order", order.no) + (money ? " · " + money : "")).slice(0, 200),
      text: text.slice(0, 1800)
    };
  }

  var api = {
    plain: plain, cents: cents, sellables: sellables, productPlan: productPlan, compare: compare,
    stockReq: stockReq, normOrder: normOrder, outRequest: outRequest, invoicePrefill: invoicePrefill,
    budgetPrefill: budgetPrefill, crmLog: crmLog, vatOf: vatOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksWoo = api;
})(typeof window !== "undefined" ? window : this);
