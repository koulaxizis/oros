// ============================================================
// orOS Assistant — shop.js (AS-SHOP W1, Chris 2026-11-23)
// The person's own WooCommerce shop (Settings › Connected services,
// any shop; Noxpress orOS Connect is not needed for this) as two
// Assistant tools:
//   shop_find    read: products by name, SKU or id, with the fields the
//                Assistant may change and the shop's units
//   shop_change  write: a few product fields (weight, dimensions,
//                prices, stock), one product or one variation at a
//                time, shown on the usual change card (before → after)
//                and sent only after the person presses Apply; Undo
//                puts the old values back while the shop still shows
//                the new ones
// Pure: requests are built here and sent by assistant.js through the
// shell (orosLinks.call, the allowlist in links/core.js and
// relay/ext.js). Everything from the shop is plain text from here on
// (names: tags out, entities decoded). Nothing is ever deleted, no
// product is made, no status, name or text is changed.
// Tests: tests/assistant-shop.test.js.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";

  // The fields shop_change takes, in card order. f = the card's row
  // name (assistant.js "f.<f>" strings, ≤ 12 lowercase letters).
  var FIELDS = ["weight", "length", "width", "height", "regular_price", "sale_price", "stock_quantity", "manage_stock", "stock_status"];
  var ROW = { weight: "pweight", length: "length", width: "width", height: "height", regular_price: "price",
              sale_price: "saleprice", stock_quantity: "stock", manage_stock: "managestock", stock_status: "stockstatus" };
  var DIMS = ["length", "width", "height"];
  var STOCK_ST = ["instock", "outofstock", "onbackorder"];
  var PER_PAGE = 100, MAX_PAGES = 30;            // up to 3,000 products are searched
  var FIND_MAX = 10, VAR_MAX = 30, TEXT = 160;
  var SKU_RE = /^[A-Za-z0-9_-]{1,40}$/;          // = links/core.js SKU

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function wooId(v) {
    if (typeof v === "string" && /^[0-9]{1,12}$/.test(v.trim())) v = +v.trim();
    return isInt(v) && v > 0 && v < 1e12 ? v : 0;
  }
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\u03c2/g, "\u03c3").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€" };
  // a shop's text: tags out, entities decoded, control characters out, one line
  function plain(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (all, e) {
      if (e[0] !== "#") return has(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : all;
      var cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp > 31 && cp < 0x110000) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 127) return all;
      return String.fromCodePoint(cp);
    });
    s = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return s.length > (max || TEXT) ? s.slice(0, (max || TEXT) - 1) + "…" : s;
  }
  // a decimal as the shop keeps it: "" (none) or "0.35"
  function dec(v) {
    if (v === "" || v == null) return "";
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    if (!isFinite(n) || n < 0) return "";
    return num(n, 3);
  }
  function num(n, places) {
    var s = (Math.round(n * Math.pow(10, places)) / Math.pow(10, places)).toFixed(places);
    return s.indexOf(".") < 0 ? s : s.replace(/0+$/, "").replace(/\.$/, "");
  }
  function money(v) {
    if (v === "" || v == null) return "";
    var n = typeof v === "number" ? v : parseFloat(String(v));
    return isFinite(n) && n >= 0 ? n.toFixed(2) : "";
  }

  // ---------- the shop ----------
  // list = [{ id, name, site }] (WooCommerce accounts of Connected services)
  function siteOf(a) { return fold(String(a.site || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "")); }
  function pickShop(list, want) {
    list = (Array.isArray(list) ? list : []).filter(function (a) { return isObj(a) && typeof a.id === "string" && /^[a-z0-9]{8,24}$/.test(a.id); });
    if (!list.length) return { err: "No WooCommerce shop is connected on this device (Settings › Connected services). Tell the user to add their shop there first." };
    var names = list.map(function (a) { return a.name || a.site || a.id; });
    if (want == null || String(want).trim() === "") {
      return list.length === 1 ? { id: list[0].id, name: names[0] } : { err: "The user has several shops (" + names.join(", ") + "); give shop." };
    }
    var q = fold(String(want).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, ""));
    var hit = list.filter(function (a) { return a.id === String(want) || fold(a.name) === q || siteOf(a) === q; });
    if (hit.length !== 1) hit = list.filter(function (a) { return q && (fold(a.name).indexOf(q) >= 0 || siteOf(a).indexOf(q) >= 0); });
    if (hit.length === 1) return { id: hit[0].id, name: hit[0].name || hit[0].site || hit[0].id };
    return { err: "\"" + String(want).slice(0, 80) + "\" is not one of the user's shops: " + names.join(", ") + "." };
  }

  // ---------- requests (links/core.js ALLOW.woo) ----------
  function listReq(page) { return { m: "GET", path: "/products?page=" + page + "&per_page=" + PER_PAGE + "&orderby=id&order=asc" }; }
  function skuReq(sku) { return SKU_RE.test(sku) ? { m: "GET", path: "/products?sku=" + sku } : null; }
  function productReq(id) { return { m: "GET", path: "/products/" + id }; }
  function varsReq(id) { return { m: "GET", path: "/products/" + id + "/variations?per_page=" + PER_PAGE }; }
  function unitReqs() {
    return [{ m: "GET", path: "/settings/products/woocommerce_weight_unit" }, { m: "GET", path: "/settings/products/woocommerce_dimension_unit" }];
  }
  function putReq(t, body) {
    return { m: "PUT", path: "/products/" + t.pid + (t.vid ? "/variations/" + t.vid : ""), body: body };
  }
  // the two settings answers → { weight, dimension } (WooCommerce's own codes)
  var W_UNITS = ["kg", "g", "lbs", "oz"], D_UNITS = ["m", "cm", "mm", "in", "yd"];
  function units(w, d) {
    var wv = isObj(w) && typeof w.value === "string" ? w.value : "", dv = isObj(d) && typeof d.value === "string" ? d.value : "";
    return { weight: W_UNITS.indexOf(wv) >= 0 ? wv : "kg", dimension: D_UNITS.indexOf(dv) >= 0 ? dv : "cm" };
  }

  // ---------- products ----------
  // a product or a variation as the Assistant sees it (only what it may change, and how to find it)
  function norm(p, parent) {
    if (!isObj(p) || !wooId(p.id)) return null;
    var dims = isObj(p.dimensions) ? p.dimensions : {};
    var o = { id: p.id, name: plain(p.name, TEXT), sku: plain(p.sku, 60), type: plain(p.type, 20) || "simple", status: plain(p.status, 20),
              weight: dec(p.weight), length: dec(dims.length), width: dec(dims.width), height: dec(dims.height),
              regular_price: money(p.regular_price), sale_price: money(p.sale_price),
              manage_stock: p.manage_stock === true, stock_quantity: isInt(p.stock_quantity) ? p.stock_quantity : (typeof p.stock_quantity === "number" ? Math.round(p.stock_quantity) : null),
              stock_status: STOCK_ST.indexOf(p.stock_status) >= 0 ? p.stock_status : "" };
    if (parent) {
      o.parent = parent.id;
      o.attrs = (Array.isArray(p.attributes) ? p.attributes : []).slice(0, 6).map(function (a) {
        return isObj(a) ? plain(String(a.name || ""), 40) + ": " + plain(String(a.option || ""), 60) : "";
      }).filter(Boolean).join(", ");
      if (!o.name) o.name = parent.name + (o.attrs ? " (" + o.attrs + ")" : "");
    }
    // a variation that keeps no stock of its own follows its product ("parent")
    if (p.manage_stock === "parent") o.manage_stock = "parent";
    return o;
  }
  // rows = normed products; q = words, an id or a SKU → best first
  function find(rows, q) {
    rows = (Array.isArray(rows) ? rows : []).filter(Boolean);
    var raw = String(q == null ? "" : q).trim(), id = wooId(raw), f = fold(raw);
    if (!raw) return [];
    if (id) { var byId = rows.filter(function (r) { return r.id === id; }); if (byId.length) return byId; }
    var bySku = rows.filter(function (r) { return r.sku && fold(r.sku) === f; });
    if (bySku.length) return bySku;
    var words = f.split(" ").filter(Boolean);
    var hits = rows.map(function (r) {
      var n = fold(r.name), sc = 0;
      if (n === f) sc = 3;
      else if (words.every(function (w) { return n.indexOf(w) >= 0; })) sc = n.indexOf(f) >= 0 ? 2 : 1;
      return { r: r, sc: sc };
    }).filter(function (x) { return x.sc > 0; });
    hits.sort(function (a, b) { return b.sc - a.sc || a.r.name.length - b.r.name.length || a.r.id - b.r.id; });
    // an exact name stands alone
    if (hits.length && hits[0].sc === 3) hits = hits.filter(function (x) { return x.sc === 3; });
    return hits.map(function (x) { return x.r; });
  }
  // a variation by its id or by words of its attributes ("Ψηφιακό", "Size: L")
  function findVar(vars, want) {
    var id = wooId(want), f = fold(want);
    if (id) return vars.filter(function (v) { return v.id === id; });
    if (!f) return [];
    var words = f.split(" ").filter(Boolean);
    var exact = vars.filter(function (v) { return fold(v.attrs) === f || fold(v.attrs.replace(/^[^:]*: /, "")) === f || (v.sku && fold(v.sku) === f); });
    if (exact.length) return exact;
    return vars.filter(function (v) { var a = fold(v.attrs); return words.every(function (w) { return a.indexOf(w) >= 0; }); });
  }
  // what shop_find hands the model (short, so a small local model copes)
  function view(r, u) {
    var o = { id: r.id, name: r.name };
    if (r.parent) o.product_id = r.parent;
    if (r.attrs) o.variation = r.attrs;
    if (r.sku) o.sku = r.sku;
    if (!r.parent) o.type = r.type;
    if (r.status && r.status !== "publish") o.status = r.status;
    o.weight = r.weight ? r.weight + " " + u.weight : "";
    var d = DIMS.filter(function (k) { return r[k]; });
    if (d.length) o.dimensions = DIMS.map(function (k) { return r[k] || "–"; }).join(" × ") + " " + u.dimension + " (length × width × height)";
    o.regular_price = r.regular_price;
    if (r.sale_price) o.sale_price = r.sale_price;
    o.stock = r.manage_stock === true ? r.stock_quantity : r.manage_stock === "parent" ? "follows the product" : "not counted";
    if (r.stock_status) o.stock_status = r.stock_status;
    return o;
  }

  // ---------- what the model asked for ----------
  // i18n-inline-ok: Greek unit words ("350 γρ", "21 εκ") are parsed here, never shown
  var W_WORDS = [[/^(kg|kgs|kilo|kilos|kilogram|kilograms|κιλ[αοό]|κιλα|κg|χλγ|χγρ)$/, "kg"],
                 [/^(g|gr|grs|gram|grams|gramme|grammes|γρ|γραμ|γραμμαρια|γραμμαριο|γραμμαρίων)$/, "g"],
                 [/^(lb|lbs|pound|pounds)$/, "lbs"], [/^(oz|ounce|ounces)$/, "oz"]];
  var D_WORDS = [[/^(mm|millimetre|millimetres|millimeter|millimeters|χιλ|χιλιοστα|χιλιοστο)$/, "mm"],
                 [/^(cm|centimetre|centimetres|centimeter|centimeters|εκ|εκατοστα|εκατοστο)$/, "cm"],
                 [/^(m|metre|metres|meter|meters|μ|μετρα|μετρο)$/, "m"],
                 [/^(in|inch|inches)$/, "in"], [/^(yd|yard|yards)$/, "yd"]];
  var TO_G = { kg: 1000, g: 1, lbs: 453.59237, oz: 28.349523125 };
  var TO_MM = { m: 1000, cm: 10, mm: 1, "in": 25.4, yd: 914.4 };
  // "350 g", "0,35 kg", 350 (= the shop's unit) → the shop's unit, as text
  function amount(v, kind, shopUnit) {
    var words = kind === "weight" ? W_WORDS : D_WORDS, table = kind === "weight" ? TO_G : TO_MM;
    var n, unit = shopUnit;
    if (typeof v === "number") n = v;
    else if (typeof v === "string") {
      var m = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*([^\s0-9.,]*)\s*\.?\s*$/.exec(v);
      if (!m) return { err: kind + " \"" + v.slice(0, 40) + "\" is not a number with a unit (e.g. \"350 g\")." };
      n = parseFloat(m[1].replace(",", "."));
      if (m[2]) {
        var f = fold(m[2]).replace(/\s+/g, ""), u = "";
        words.forEach(function (w) { if (!u && w[0].test(f)) u = w[1]; });
        if (!u) return { err: kind + ": the unit \"" + m[2].slice(0, 20) + "\" is unknown; use " + (kind === "weight" ? "g, kg, lbs or oz" : "mm, cm, m, in or yd") + "." };
        unit = u;
      }
    } else return { err: kind + " must be a number with its unit, e.g. \"350 g\"." };
    if (!isFinite(n) || n <= 0) return { err: kind + " must be more than 0 (to remove it, say so to the user: the Assistant does not clear it)." };
    var out = n * table[unit] / table[shopUnit];
    var s = num(out, 3);
    if (+s === 0) return { err: kind + " " + n + " " + unit + " is too small for the shop's unit (" + shopUnit + ")." };
    if (out >= 1e6) return { err: kind + " is too large." };
    return { v: s };
  }
  function price(v, what) {
    var s = typeof v === "number" ? String(v) : String(v == null ? "" : v);
    s = s.replace(/[€$£\s]|EUR|eur/g, "").replace(",", ".");
    if (!/^[0-9]{1,7}(\.[0-9]{1,4})?$/.test(s)) return { err: what + " must be an amount like 12.50 (no currency)." };
    return { v: (Math.round(parseFloat(s) * 100) / 100).toFixed(2) };
  }
  function int(v, what, min, max) {
    var n = typeof v === "string" && /^[+-]?[0-9]{1,9}$/.test(v.trim()) ? +v.trim() : v;
    if (!isInt(n) || n < min || n > max) return { err: what + " must be a whole number" + (min >= 0 ? " (0 or more)" : "") + "." };
    return { v: n };
  }

  // args of shop_change → { ok, t: { pid?, q, vq? }, set: { field: wanted }, add? } | { ok:false, err }
  // Values stay as given until the shop's units are known (plan).
  function normArgs(a) {
    if (!isObj(a)) return { ok: false, err: "The arguments must be an object." };
    var q = a.product == null ? "" : String(a.product).trim();
    if (!q) return { ok: false, err: "Give product: its id from shop_find (best), its SKU or its exact name." };
    var known = ["shop", "product", "variation", "stock_change", "sale_price_clear"].concat(FIELDS);
    var no = Object.keys(a).filter(function (k) { return known.indexOf(k) < 0 && a[k] != null && a[k] !== ""; });
    if (no.length) return { ok: false, err: "shop_change does not change " + no.join(", ") + "; it takes " + FIELDS.join(", ") + " and stock_change. Names, texts, status and pictures stay as they are." };
    var set = {}, n = 0;
    FIELDS.forEach(function (k) { if (a[k] != null && a[k] !== "") { set[k] = a[k]; n++; } });
    if (a.sale_price_clear === true) {
      if (has(set, "sale_price")) return { ok: false, err: "Give sale_price or sale_price_clear, not both." };
      set.sale_price = ""; n++;
    }
    var add = null;
    if (a.stock_change != null && a.stock_change !== "") {
      if (has(set, "stock_quantity")) return { ok: false, err: "Give stock_quantity (the new count) or stock_change (how many more or fewer), not both." };
      var sc = int(a.stock_change, "stock_change", -1000000, 1000000);
      if (sc.err) return { ok: false, err: sc.err };
      if (sc.v === 0) return { ok: false, err: "stock_change 0 changes nothing." };
      add = sc.v; n++;
    }
    if (!n) return { ok: false, err: "Say what to change: " + FIELDS.join(", ") + " or stock_change." };
    if (has(set, "manage_stock") && typeof set.manage_stock !== "boolean") return { ok: false, err: "manage_stock is true or false." };
    if (has(set, "stock_status") && STOCK_ST.indexOf(set.stock_status) < 0) return { ok: false, err: "stock_status is instock, outofstock or onbackorder." };
    return { ok: true, t: { q: q, vq: a.variation == null ? "" : String(a.variation).trim() }, set: set, add: add };
  }

  function same(f, a, b) {
    if (f === "manage_stock") return a === b;
    if (a === "" || a == null || b === "" || b == null) return (a === "" || a == null) && (b === "" || b == null);
    return +a === +b;
  }
  // cur = the product or variation as the shop has it NOW (norm),
  // ch = normArgs(...), u = units → { ok, body, rows, after, before, keep }
  //   rows: [{ f, b, a }] for the card (shown in the shop's units)
  //   after / before: field → value, for Undo (before of a price that
  //   was empty is left out of before: the shop cannot be given back
  //   "no price" from here, keep names it)
  function plan(cur, ch, u) {
    if (!cur) return { ok: false, err: "The product was not found in the shop." };
    if (cur.type === "variable" && !cur.parent) {
      return { ok: false, err: "“" + cur.name + "” has variations: give variation (its id or its option, as shop_find lists them)." };
    }
    if (cur.type === "grouped" || cur.type === "external") {
      var stockish = ["stock_quantity", "manage_stock", "stock_status"].some(function (k) { return has(ch.set, k); }) || ch.add != null;
      if (stockish) return { ok: false, err: "“" + cur.name + "” is a " + cur.type + " product; the shop keeps no stock for it." };
    }
    var want = {};
    var ks = Object.keys(ch.set);
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i], v = ch.set[k], r;
      if (k === "weight") r = amount(v, "weight", u.weight);
      else if (DIMS.indexOf(k) >= 0) r = amount(v, k, u.dimension);
      else if (k === "regular_price") r = price(v, "regular_price");
      else if (k === "sale_price") r = v === "" ? { v: "" } : price(v, "sale_price");
      else if (k === "stock_quantity") r = int(v, "stock_quantity", 0, 1000000000);
      else r = { v: v };
      if (r.err) return { ok: false, err: r.err };
      want[k] = r.v;
    }
    if (ch.add != null) {
      if (cur.manage_stock !== true) return { ok: false, err: "“" + cur.name + "” has no stock count in the shop; give stock_quantity to start one." };
      var nq = (cur.stock_quantity || 0) + ch.add;
      if (nq < 0) return { ok: false, err: "The shop has " + (cur.stock_quantity || 0) + " of “" + cur.name + "”; " + (-ch.add) + " fewer would be below 0." };
      want.stock_quantity = nq;
    }
    // a stock count needs the shop to count stock
    if (has(want, "stock_quantity") && cur.manage_stock !== true && !has(want, "manage_stock")) want.manage_stock = true;
    if (cur.manage_stock === "parent" && (has(want, "stock_quantity") || want.manage_stock === true)) want.manage_stock = true;
    if (has(want, "stock_quantity") && want.manage_stock === false) return { ok: false, err: "A stock count needs manage_stock true." };
    var reg = has(want, "regular_price") ? want.regular_price : cur.regular_price;
    var sale = has(want, "sale_price") ? want.sale_price : cur.sale_price;
    if (sale !== "" && (reg === "" || +sale >= +reg)) return { ok: false, err: "The sale price (" + sale + ") must be lower than the regular price (" + (reg || "none") + "); the shop would ignore it." };
    var body = {}, rows = [], after = {}, before = {}, keep = [];
    FIELDS.forEach(function (k) {
      if (!has(want, k)) return;
      var was = cur[k];
      if (k === "manage_stock" && was === "parent") was = false;
      if (same(k, was, want[k])) return;
      if (DIMS.indexOf(k) >= 0) { body.dimensions = body.dimensions || {}; body.dimensions[k] = want[k]; }
      else body[k] = want[k];
      after[k] = want[k];
      if (k === "regular_price" && was === "") keep.push(k);
      else if (!(k === "stock_quantity" && was == null)) before[k] = was == null ? "" : was;   // no count before: manage_stock goes back
      rows.push({ f: ROW[k], k: k, b: show(k, was, u), a: show(k, want[k], u) });
    });
    if (!rows.length) return { ok: false, err: "Nothing would change: “" + cur.name + "” already has that." };
    return { ok: true, body: body, rows: rows, after: after, before: before, keep: keep };
  }
  function show(k, v, u) {
    if (v === "" || v == null) return "";
    if (k === "weight") return v + " " + u.weight;
    if (DIMS.indexOf(k) >= 0) return v + " " + u.dimension;
    return String(v);   // manage_stock true|false, stock_status: assistant.js chgValue names them
  }

  // Undo: cur = the shop's values now. Only while every field still has
  // what the Assistant set (else someone changed it since: nothing is
  // touched). → { ok, body } | { ok:false, err }
  function undoPlan(cur, mem) {
    if (!cur) return { ok: false, err: "gone" };
    var ks = Object.keys(mem.after || {});
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i], now = cur[k];
      if (k === "manage_stock" && now === "parent") now = false;
      if (!same(k, now, mem.after[k])) return { ok: false, err: "changed" };
    }
    var body = {}, n = 0;
    Object.keys(mem.before || {}).forEach(function (k) {
      if (DIMS.indexOf(k) >= 0) { body.dimensions = body.dimensions || {}; body.dimensions[k] = mem.before[k]; }
      else body[k] = mem.before[k];
      n++;
    });
    if (!n) return { ok: false, err: "keep" };
    return { ok: true, body: body };
  }

  var api = {
    FIELDS: FIELDS, ROW: ROW, PER_PAGE: PER_PAGE, MAX_PAGES: MAX_PAGES, FIND_MAX: FIND_MAX, VAR_MAX: VAR_MAX,
    fold: fold, plain: plain, pickShop: pickShop, listReq: listReq, skuReq: skuReq, productReq: productReq, varsReq: varsReq,
    unitReqs: unitReqs, putReq: putReq, units: units, norm: norm, find: find, findVar: findVar, view: view,
    amount: amount, normArgs: normArgs, plan: plan, undoPlan: undoPlan, wooId: wooId
  };
  root.OrosAssistShop = api;
  if (NODE) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
