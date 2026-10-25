// ============================================================
// orOS Stock — supplier price lists (stock/prices.js, v1.0.0)
// i18n-inline-ok: the Greek words below are column names and availability words of imported price lists (parser data, no UI text)
// Pure, no DOM. A supplier (a publisher, a wholesaler) sends a price
// list as CSV or Excel; this compares it with the products here:
//   rowsOfText(csv) → rows, for a CSV that opens with a title line
//   parse(rows) → { lines, cols, skipped, dup } | { error: "cols" }
//     rows = the sheet as [[cell…]] (stock/import.js readBytes). The
//     header row is found among the first 10 rows by its names (EN and
//     EL, see HEAD). Needed: a code (ISBN / EAN / SKU) or a name, and
//     a retail price, a net price or an availability column. ISBN-10
//     becomes ISBN-13; prices are cents; a net price may come as a
//     discount % off the retail price.
//   compare(data, lines, supId) → { price, out, fresh, same, link, matched }
//     price: products whose retail (or net) price differs;
//     out:   products the supplier no longer has, still with a minimum
//            or a reorder quantity here (so the Reorder tab stops
//            asking for them);
//     fresh: titles in the list that are not here, available, priced;
//     same:  how many matched with nothing to change;
//     link:  matched products not yet under this supplier (or without
//            the supplier's code).
//     A line matches a product by code (SKU, barcode or the
//     supplier's code, ISBN-10/13 folded together), else by the exact
//     name when only one product has it. Archived products don't
//     match by name.
//   apply(data, cmp, pick, o) → { data, undo }: one copy with the
//     picked changes; with o.link every matched product also gets the
//     supplier and the supplier's code (so Reorder groups it under
//     that supplier and the order mail names the supplier's code).
//     pick = { price: {itemId: true}, out: {itemId: true}, fresh: {code or name: true} }
//     o = { supId, link, now, newId }; a new product's VAT is the one
//     most of the supplier's products have, else the default VAT
//   undo(data, info, now) → data: changed products back as they were,
//     new ones tombstoned (archived if a movement uses them already).
//   shopJobs(cmp, pick, data) → [{ k: "price" | "new", code, name, price }]
//     what may go to a WooCommerce shop (codes the shop's SKU filter
//     takes); stock/pricelist.js sends them, only on a button.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosStockCore;

  var MAX_LINES = 20000;
  // folded header names → column (C.fold, then the same clean-up as headKey)
  var HEAD = {
    code: ["isbn", "isbn13", "isbn 13", "isbn-13", "isbn10", "isbn 10", "ean", "ean13", "ean 13", "ean-13", "barcode", "gtin",
           "sku", "code", "product code", "item code", "κωδικοσ", "κωδ", "κωδ.", "κωδικοσ ειδουσ", "κωδικοσ προϊοντοσ", "κωδικοσ προιοντοσ", "barcode/isbn"],
    name: ["title", "name", "product", "product name", "item", "description", "τιτλοσ", "ονομασια", "ονομα", "περιγραφη", "ειδοσ", "προϊον", "προιον"],
    price: ["price", "retail", "retail price", "list price", "rrp", "srp", "msrp", "price incl. vat", "τιμη", "λιανικη", "τιμη λιανικησ", "λιαν. τιμη", "λιανικη τιμη", "τ.λ.", "τλ"],
    cost: ["net", "net price", "cost", "wholesale", "wholesale price", "trade price", "χονδρικη", "τιμη χονδρικησ", "καθαρη", "καθαρη τιμη", "τιμη αγορασ"],
    disc: ["discount", "discount %", "disc", "disc %", "εκπτωση", "εκπτωση %", "εκπτ.", "εκπτ. %"],
    avail: ["availability", "available", "status", "stock status", "in stock", "διαθεσιμοτητα", "διαθεσιμο", "κατασταση"]
  };
  // an availability cell that means "no more"
  var OUT_RE = /εξαντλ|εκτοσ κυκλοφ|μη διαθεσ|δεν (ειναι )?διαθεσ|out of print|out of stock|unavailable|not available|discontinued|^oop$|^op$|^no$|^οχι$|^0$|^false$|^n$/;

  function cell(v) {
    if (v === null || v === undefined) return "";
    return typeof v === "number" ? String(v) : String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  }
  function headOf(h) {
    var f = C.fold(String(h).replace(/\([^)]*\)/g, "")).replace(/[^a-z0-9α-ω%,.\/ -]+/g, " ").replace(/\s+/g, " ").trim();
    var keys = Object.keys(HEAD);
    for (var i = 0; i < keys.length; i++) if (HEAD[keys[i]].indexOf(f) >= 0) return keys[i];
    return null;
  }

  // "960-12-3456-X" → "9789601234567"; a 13-digit code stays; else ""
  function isbn13(raw) {
    var s = String(raw || "").replace(/[\s -]/g, "").toUpperCase();
    if (/^\d{13}$/.test(s)) return s;
    if (!/^\d{9}[\dX]$/.test(s)) return "";
    var b = "978" + s.slice(0, 9), sum = 0;
    for (var i = 0; i < 12; i++) sum += (+b[i]) * (i % 2 ? 3 : 1);
    return b + ((10 - sum % 10) % 10);
  }
  // the key a code is matched by
  function codeKey(raw) {
    var s = cell(raw);
    if (!s) return "";
    return isbn13(s) || s.toUpperCase().replace(/\s+/g, "");
  }
  // "€ 16,00" · "16.00" · 16 → 1600; null when it is not a price
  function cents(v) {
    if (typeof v === "number") return isFinite(v) && v >= 0 && v < 1e8 ? Math.round(v * 100) : null;
    var s = cell(v).replace(/[€$£]|eur|ευρω/gi, "").trim();
    if (!s) return null;
    var n = C.parseNum(s, "en");
    return n === null || n < 0 || n >= 1e8 ? null : Math.round(n * 100);
  }
  function pct(v) {
    var n = typeof v === "number" ? v : C.parseNum(cell(v).replace("%", ""), "en");
    if (n === null || n < 0 || n > 100) return null;
    return n > 0 && n < 1 ? n * 100 : n;               // 0.4 in a sheet = 40 %
  }

  // A CSV whose first lines are a title ("Price list 2026"): the
  // separator is the one of the line that has the most of one (among
  // the first 10), and the text is read from that line on.
  function rowsOfText(text) {
    var s = String(text || "").replace(/^\ufeff/, ""), lines = s.split(/\r?\n/), best = 0, at = 0;
    for (var i = 0; i < Math.min(10, lines.length); i++) {
      var n = Math.max(lines[i].split(";").length, lines[i].split(",").length, lines[i].split("\t").length) - 1;
      if (n > best) { best = n; at = i; }
    }
    return C.parseCsv(lines.slice(at).join("\n")).rows;
  }

  function parse(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var head = -1, cols = null;
    for (var r = 0; r < Math.min(10, rows.length) && head < 0; r++) {
      var row = Array.isArray(rows[r]) ? rows[r] : [], c = {};
      row.forEach(function (h, i) { var k = headOf(cell(h)); if (k && c[k] === undefined) c[k] = i; });
      if ((c.code !== undefined || c.name !== undefined) && (c.price !== undefined || c.cost !== undefined || c.avail !== undefined)) { head = r; cols = c; }
    }
    if (head < 0) return { error: "cols" };
    var lines = [], seen = {}, skipped = 0, dup = 0;
    for (var i = head + 1; i < rows.length && lines.length < MAX_LINES; i++) {
      var x = Array.isArray(rows[i]) ? rows[i] : [];
      function get(k) { return cols[k] === undefined ? "" : x[cols[k]]; }
      var code = cols.code === undefined ? "" : codeKey(get("code"));
      if (code.length > C.SKU_LEN) code = "";
      var name = C.cleanText(cell(get("name")), C.NAME_LEN, false);
      if (!code && !name) { if (x.some(function (v) { return cell(v); })) skipped++; continue; }
      var price = cols.price === undefined ? null : cents(get("price"));
      var cost = cols.cost === undefined ? null : cents(get("cost"));
      if (cost === null && price !== null && cols.disc !== undefined) {
        var d = pct(get("disc"));
        if (d !== null) cost = Math.round(price * (100 - d) / 100);
      }
      var av = cols.avail === undefined ? "" : C.fold(cell(get("avail")));
      var out = !!av && OUT_RE.test(av);
      if (price === null && cost === null && !out) { skipped++; continue; }
      var k = code || "n:" + C.fold(name);
      if (seen[k]) { dup++; continue; }
      seen[k] = true;
      lines.push({ code: code, name: name, price: price, cost: cost, out: out });
    }
    return { lines: lines, cols: Object.keys(cols), skipped: skipped, dup: dup };
  }

  function index(data) {
    var byCode = {}, byName = {};
    ((data && data.items) || []).forEach(function (it) {
      [it.sku, it.bc, it.ssku].forEach(function (v) {
        var k = codeKey(v);
        if (k && !byCode[k]) byCode[k] = it;
      });
      if (it.arch) return;
      var n = C.fold(it.name);
      byName[n] = byName[n] === undefined ? it : null;    // null = more than one
    });
    return { byCode: byCode, byName: byName };
  }

  function compare(data, lines, supId) {
    var ix = index(data), res = { price: [], out: [], fresh: [], same: 0, link: [] }, done = {};
    (lines || []).forEach(function (l) {
      var it = (l.code && ix.byCode[l.code]) || (l.name && ix.byName[C.fold(l.name)]) || null;
      if (!it) {
        if (!l.out && l.price > 0 && l.name) res.fresh.push(l);
        return;
      }
      if (done[it.id]) return;
      done[it.id] = true;
      var changed = false;
      var np = l.price !== null && l.price > 0 && l.price !== it.price;
      var nc = l.cost !== null && l.cost > 0 && l.cost !== it.cost;
      if (np || nc) {
        res.price.push({ item: it, line: l, old: it.price, now: np ? l.price : it.price, oldCost: it.cost, cost: nc ? l.cost : it.cost });
        changed = true;
      }
      if (l.out && (it.min > 0 || it.rq > 0)) { res.out.push({ item: it, line: l }); changed = true; }
      if (!changed) res.same++;
      if (supId && (it.sup !== supId || (l.code && !it.ssku))) res.link.push({ item: it, line: l });
    });
    function byName(a, b) { var x = C.fold(a.item ? a.item.name : a.name), y = C.fold(b.item ? b.item.name : b.name); return x < y ? -1 : x > y ? 1 : 0; }
    res.price.sort(byName); res.out.sort(byName); res.fresh.sort(byName);
    res.matched = Object.keys(done).length;
    return res;
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function apply(data, cmp, pick, o) {
    o = o || {};
    pick = pick || {};
    var d = clone(data || {}), now = o.now || Date.now();
    if (!Array.isArray(d.items)) d.items = [];
    var prev = [], added = [], touched = {};
    var byId = {};
    d.items.forEach(function (it) { byId[it.id] = it; });
    function touch(it) {
      if (!touched[it.id]) { touched[it.id] = true; prev.push(clone(it)); }
      it.m = Math.max(now, it.m + 1);
    }
    function link(it, line) {
      if (!o.supId || !o.link) return;
      if (it.sup !== o.supId) { touch(it); it.sup = o.supId; }
      if (line.code && !it.ssku) { touch(it); it.ssku = line.code; }
    }
    (cmp.price || []).forEach(function (r) {
      var it = byId[r.item.id];
      if (!it || !(pick.price || {})[it.id]) return;
      touch(it);
      it.price = r.now;
      it.cost = r.cost;
      link(it, r.line);
    });
    (cmp.out || []).forEach(function (r) {
      var it = byId[r.item.id];
      if (!it || !(pick.out || {})[it.id]) return;
      touch(it);
      it.min = 0;
      it.rq = 0;
      link(it, r.line);
    });
    // every product the list names learns its supplier (o.link)
    if (o.link) (cmp.link || []).forEach(function (r) {
      var it = byId[r.item.id];
      if (it) link(it, r.line);
    });
    // the VAT most of this supplier's products have, else the default
    var vat = C.normSettings(d.settings).vat, n = {}, best = 0;
    d.items.forEach(function (it) { if (o.supId && it.sup === o.supId && !it.arch) n[it.vat] = (n[it.vat] || 0) + 1; });
    Object.keys(n).forEach(function (v) { if (n[v] > best) { best = n[v]; vat = +v; } });
    (cmp.fresh || []).forEach(function (l) {
      if (!(pick.fresh || {})[l.code || l.name]) return;
      var row = C.normItem({
        id: o.newId(), m: now, name: l.name, sku: l.code, bc: /^\d{13}$/.test(l.code) ? l.code : "",
        unit: "pcs", sup: o.supId || "", ssku: l.code, price: l.price, cost: l.cost || 0, vat: vat
      });
      if (!row) return;
      d.items.push(row);
      added.push(row.id);
    });
    return { data: C.merge(d, d, now), undo: { prev: prev, added: added } };
  }

  function undo(data, info, now) {
    var d = clone(data || {});
    now = now || Date.now();
    if (!d.tombs || typeof d.tombs !== "object") d.tombs = {};
    var used = {};
    (d.moves || []).forEach(function (x) { (x.lines || []).forEach(function (l) { used[l.i] = true; }); });
    var back = {};
    (info.prev || []).forEach(function (it) { back[it.id] = it; });
    d.items = (d.items || []).filter(function (it) {
      if (info.added.indexOf(it.id) >= 0) {
        if (used[it.id]) { it.arch = 1; it.m = Math.max(now, it.m + 1); return true; }
        d.tombs[it.id] = Math.max(now, it.m);
        return false;
      }
      return true;
    }).map(function (it) {
      var was = back[it.id];
      if (!was) return it;
      var o = clone(was);
      o.m = Math.max(now, it.m + 1);
      return o;
    });
    return C.merge(d, d, now);
  }

  var SKU_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function shopJobs(cmp, pick, data) {
    pick = pick || {};
    var jobs = [];
    (cmp.price || []).forEach(function (r) {
      var code = r.line.code || codeKey(r.item.sku);
      if (!(pick.price || {})[r.item.id] || r.now === r.old || !SKU_RE.test(code)) return;
      jobs.push({ k: "price", code: code, name: r.item.name, price: r.now });
    });
    (cmp.fresh || []).forEach(function (l) {
      if (!(pick.fresh || {})[l.code || l.name] || !SKU_RE.test(l.code)) return;
      jobs.push({ k: "new", code: l.code, name: l.name, price: l.price });
    });
    return jobs;
  }

  var API = { HEAD: HEAD, rowsOfText: rowsOfText, parse: parse, compare: compare, apply: apply, undo: undo, shopJobs: shopJobs, isbn13: isbn13, codeKey: codeKey, cents: cents };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosStockPrices = API;
})(typeof window !== "undefined" ? window : globalThis);
