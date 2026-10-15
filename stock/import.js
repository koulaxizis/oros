// ============================================================
// orOS Stock — import.js ("Import from another app", v1.0.0)
// Reads a product export from a shop / point-of-sale app and turns it
// into Stock products. Pure: no DOM, no storage; stock.js runs the
// picker, the preview dialog, the one write and the Undo. A file that
// is none of the sources below goes on to the app's own CSV import
// (core.importPlan: own export, WooCommerce, any CSV with Name / SKU).
//
// Sources (detected from the header row):
//   shopify  Shopify, Products › Export (CSV): Handle, Title, Body
//            (HTML), Vendor, Type, Tags, Option1 Name / Value…,
//            Variant SKU, Variant Price, Variant Inventory Qty,
//            Variant Barcode, Cost per item, Image Src. Rows with the
//            same Handle are the variants of one product: one Stock
//            product per variant ("Tee (Red / M)"); rows with only an
//            image are skipped. The description becomes plain text;
//            the picture stays a link in the note (never fetched).
//   square   Square, Items › Export library (.xlsx, or the CSV):
//            Item Name, Variation Name, SKU, Description, Category,
//            Price, Current Quantity <location> (all locations added
//            together), Stock Alert Count <location>, GTIN, Default
//            Unit Cost, Default Vendor Name.
//
// readBytes(bytes, name, getXlsx) → Promise<{ rows: [[cell…]], text? }
//   | { error: "big" | "bad" | "lib" }>: CSV text, or the first sheet
//   of an .xlsx through SheetJS (getXlsx() → Promise<XLSX>, loaded by
//   the app only when an .xlsx is picked). toCsv(rows) turns a sheet
//   back into CSV for the app's own importer.
// parseRows(rows, lab) → result | null:
//   { source, items: [{ key, name, sku, bc, cat, sup, price, cost,
//     min, qty, note, arch }], skipped, locs }
// plan(data, res, opts) → { items, cats, sups, moves, stats, undo }
//   opts: { now, today, setQty, ref }. Nothing is changed. An
//   item id is "imp" + hash(source|key), so the same file twice adds
//   nothing; a product already here (same id, SKU, barcode or name)
//   is the user's and is left as it is. A deleted imported product
//   comes back. With setQty, new products get their quantity from ONE
//   stock count movement (src "imp:<source>", ≤ 500 lines each).
// apply(data, plan) → data (a copy) · undo(data, undoInfo, now) → data:
//   new rows get tombstones newer than themselves; a product that
//   already has a (now voided) count can never disappear in Stock's
//   merge, so it is archived instead.
// UMD: window.OrosStockImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.OrosStockCore; }

  var MAX_FILE = 20 * 1024 * 1024;   // bytes read from one file
  var MAX_ROWS = 20000;              // rows read from one file
  var MAX_SHEETS = 10;
  var ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var SRC_NAME = { shopify: "Shopify", square: "Square" };

  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function str(v) {
    if (v == null) return "";
    if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
    return String(v);
  }
  function hid(s) { var K = kit(); return "imp" + K.hash(s) + K.hash("~" + s); }

  // ---------- reading ----------
  function readBytes(bytes, name, getXlsx) {
    var K = kit();
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (K.isZip(bytes)) {
      // an .xlsx is a zip; SheetJS reads it (loaded only now)
      if (!getXlsx) return Promise.resolve({ error: "bad" });
      return getXlsx().then(function (X) {
        var wb;
        try { wb = X.read(bytes, { type: "array", cellDates: true }); } catch (e) { return { error: "bad" }; }
        var best = null;
        (wb.SheetNames || []).slice(0, MAX_SHEETS).forEach(function (sn) {
          var aoa = X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "", blankrows: false }).slice(0, MAX_ROWS + 1);
          if (!best) best = aoa;
          else if (!parseRows(best) && parseRows(aoa)) best = aoa;
        });
        return best && best.length ? { rows: best } : { error: "bad" };
      }, function () { return { error: "lib" }; });
    }
    var txt;
    try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    if (!K.clean(txt)) return Promise.resolve({ error: "bad" });
    var t = K.csv(txt, { maxRows: MAX_ROWS });
    return Promise.resolve({ rows: [t.head].concat(t.rows), text: txt });
  }
  // A sheet back to CSV (",", quoted) for core.importPlan.
  function toCsv(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(function (v) {
        var s = typeof v === "number" ? String(v) : str(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  // ---------- HTML → plain text (no DOM: nothing is ever rendered) ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
    laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•" };
  function htmlText(html) {
    var s = String(html == null ? "" : html).slice(0, 200000);
    s = s.replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head|template)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|section|article|blockquote)\s*>/gi, "\n")
      .replace(/<(p|div|h[1-6]|ul|ol|tr|table)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (m, e) {
        if (e[0] === "#") {
          var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : " ";
        }
        var k = e.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
      });
    return s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  }

  // ---------- detection ----------
  var SIGS = [
    { id: "shopify", need: ["Handle", ["Variant SKU", "Variant Price", "Variant Inventory Qty"]] },
    { id: "square", need: ["Item Name", ["Variation Name", "Variation"]] }
  ];
  function detect(head) { return kit().detect(head, SIGS); }

  // A row as { header: value } with the headers trimmed.
  function recs(rows) {
    var head = (rows[0] || []).map(function (h) { return kit().clean(str(h), 200); });
    var out = [];
    for (var i = 1; i < rows.length && out.length < MAX_ROWS; i++) {
      var r = rows[i] || [], o = {}, any = false;
      head.forEach(function (h, j) { if (!h) return; var v = r[j] == null ? "" : r[j]; o[h] = v; if (str(v).trim()) any = true; });
      if (any) out.push(o);
    }
    return { head: head, rows: out };
  }
  function g(rec, names) { return str(kit().get(rec, names)).trim(); }
  function numOf(rec, names) {
    var v = kit().get(rec, names);
    if (v === "" || v == null) return null;
    var n = kit().num(v);
    return isFinite(n) ? n : null;
  }
  // "Clothing > Shirts" → "Shirts"
  function lastSeg(s) {
    var p = String(s || "").split(/\s*[>›]\s*/);
    return kit().clean(p[p.length - 1], 80);
  }
  // note text: the description first, then the extra lines, ≤ 500
  function noteOf(text, extra) {
    var K = kit(), tail = extra.filter(Boolean).join("\n");
    var room = 500 - (tail ? tail.length + 2 : 0);
    var body = K.cleanText(text, 4000);
    if (body.length > room) body = room > 1 ? body.slice(0, room - 1).trim() + "…" : "";
    return K.cleanText([body, tail].filter(Boolean).join("\n\n"), 500);
  }
  function safeUrl(u) {
    u = kit().clean(u, 300);
    return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "";
  }

  function parseShopify(t, lab) {
    var items = [], skipped = 0, byHandle = {}, seen = {};
    t.rows.forEach(function (r) {
      var handle = low(g(r, ["Handle"]));
      if (!handle) { skipped++; return; }
      var p = byHandle[handle];
      if (!p) {
        p = byHandle[handle] = { title: "", body: "", vendor: "", type: "", tags: "", status: "", img: "", opts: ["", "", ""], n: 0 };
      }
      // the first row of a handle carries the product fields
      if (!p.title) p.title = kit().clean(g(r, ["Title"]), 80);
      if (!p.body) p.body = g(r, ["Body (HTML)", "Body HTML", "Body", "Description"]);
      if (!p.vendor) p.vendor = g(r, ["Vendor"]);
      if (!p.type) p.type = g(r, ["Type", "Product Type"]) || lastSeg(g(r, ["Product Category", "Standard Product Type", "Custom Product Type"]));
      if (!p.tags) p.tags = g(r, ["Tags"]);
      if (!p.status) p.status = low(g(r, ["Status"]));
      if (!p.img) p.img = safeUrl(g(r, ["Image Src", "Image URL"]));
      [1, 2, 3].forEach(function (k) { if (!p.opts[k - 1]) p.opts[k - 1] = g(r, ["Option" + k + " Name", "Option " + k + " Name"]); });
      var vals = [1, 2, 3].map(function (k) { return g(r, ["Option" + k + " Value", "Option " + k + " Value"]); });
      var sku = kit().clean(g(r, ["Variant SKU", "SKU"]), 40);
      var price = numOf(r, ["Variant Price", "Price"]);
      var bc = kit().clean(g(r, ["Variant Barcode", "Barcode"]), 40).replace(/\s+/g, "");
      var qtyRaw = numOf(r, ["Variant Inventory Qty", "Inventory quantity", "Inventory Qty", "On hand"]);
      // an image-only row: no variant at all
      if (!sku && price === null && !bc && qtyRaw === null && !vals.some(Boolean)) {
        if (!p.img) p.img = safeUrl(g(r, ["Image Src"]));
        return;
      }
      p.n++;
      var optTxt = vals.filter(function (v) { return v && !/^default title$/i.test(v); }).join(" / ");
      var name = kit().clean(p.title || handle, 80);
      if (optTxt) name = kit().clean(name + " (" + optTxt + ")", 80);
      var key = sku ? "s:" + low(sku) : "h:" + handle + "|" + low(vals.join("|")) + "|" + p.n;
      if (seen[key]) { skipped++; return; }
      seen[key] = true;
      var vimg = safeUrl(g(r, ["Variant Image"]));
      items.push({
        key: key, name: name, sku: sku, bc: bc,
        cat: kit().clean(p.type, 80), sup: kit().clean(p.vendor, 80),
        price: price, cost: numOf(r, ["Cost per item", "Variant Cost", "Cost"]), min: null,
        qty: qtyRaw, arch: p.status === "archived" ? 1 : 0,
        _p: p, _img: vimg
      });
    });
    // notes once every row of a product was read (the image can come later)
    items.forEach(function (it) {
      var p = it._p, tags = kit().clean(p.tags, 200);
      it.note = noteOf(htmlText(p.body), [tags ? (lab.tags || "Tags") + ": " + tags : "",
                                       (it._img || p.img) ? (lab.image || "Image") + ": " + (it._img || p.img) : ""]);
      delete it._p; delete it._img;
    });
    return { source: "shopify", items: items, skipped: skipped, locs: 0 };
  }

  function parseSquare(t) {
    var items = [], skipped = 0, seen = {};
    var qCols = t.head.filter(function (h) { return /^current quantity\b/i.test(h); });
    var aCols = t.head.filter(function (h) { return /^stock alert count\b/i.test(h); });
    t.rows.forEach(function (r) {
      var nm = kit().clean(g(r, ["Item Name", "Item"]), 80);
      if (!nm) { skipped++; return; }
      if (/^(y|yes|true|1)$/i.test(g(r, ["Archived"]))) { skipped++; return; }
      var vn = kit().clean(g(r, ["Variation Name", "Variation"]), 60);
      var name = vn && !/^(regular|default)$/i.test(vn) ? kit().clean(nm + " (" + vn + ")", 80) : nm;
      var sku = kit().clean(g(r, ["SKU"]), 40);
      var key = sku ? "s:" + low(sku) : "n:" + low(nm) + "|" + low(vn);
      if (seen[key]) { skipped++; return; }
      seen[key] = true;
      var qty = null;
      qCols.forEach(function (h) { var n = kit().num(r[h]); if (isFinite(n)) qty = (qty || 0) + n; });
      if (!qCols.length) qty = numOf(r, ["Quantity", "Current Quantity"]);
      var min = null;
      aCols.forEach(function (h) { var n = kit().num(r[h]); if (isFinite(n) && n > 0 && min === null) min = n; });
      var price = low(g(r, ["Price"])) === "variable" ? null : numOf(r, ["Price"]);
      items.push({
        key: key, name: name, sku: sku,
        bc: kit().clean(g(r, ["GTIN", "UPC", "Barcode"]), 40).replace(/\s+/g, ""),
        cat: lastSeg(g(r, ["Category", "Categories", "Reporting Category"]).split(",")[0]),
        sup: kit().clean(g(r, ["Default Vendor Name", "Vendor Name", "Vendor"]), 80),
        price: price, cost: numOf(r, ["Default Unit Cost", "Unit Cost", "Cost"]), min: min,
        qty: qty, arch: 0,
        note: noteOf(htmlText(g(r, ["Description", "Item Description"])), [])
      });
    });
    return { source: "square", items: items, skipped: skipped, locs: qCols.length };
  }

  // lab: words for the note lines ({ tags, image }, the app's language)
  function parseRows(rows, lab) {
    if (!rows || rows.length < 2) return null;
    // the header is the first row, or (a sheet with a title above it)
    // one of the next few
    for (var h = 0; h < 10 && h < rows.length - 1; h++) {
      var head = (rows[h] || []).map(function (c) { return str(c).trim(); });
      if (!detect(head)) continue;
      var t = recs(rows.slice(h)), src = detect(t.head);
      var res = src === "shopify" ? parseShopify(t, lab || {}) : parseSquare(t);
      return res.items.length ? res : null;
    }
    return null;
  }

  // ---------- plan ----------
  function idOf(source, key) { return hid(source + "|" + key); }
  function plan(data, res, opts) {
    var C = core(), o = opts || {};
    var now = o.now || Date.now(), today = C.isYmd(o.today) ? o.today : C.ymdOf(now);
    data = data || {};
    var items = data.items || [], tombs = data.tombs || {};
    var byId = {}, bySku = {}, byBc = {}, byName = {};
    items.forEach(function (it) {
      byId[it.id] = it;
      if (it.sku) bySku[C.fold(it.sku)] = it;
      if (it.bc) byBc[C.fold(it.bc)] = it;
      if (!byName[C.fold(it.name)]) byName[C.fold(it.name)] = it;
    });
    var out = { source: res.source, items: [], cats: [], sups: [], moves: [],
                stats: { added: 0, back: 0, same: 0, skipped: res.skipped || 0, qty: 0, withQty: 0 },
                undo: { items: [], cats: [], sups: [], moves: [] } };
    function finder(list, made, kind) {
      var map = {};
      (data[list] || []).forEach(function (x) { map[C.fold(x.name)] = x.id; });
      return function (name) {
        var n = C.cleanText(name, C.NAME_LEN, false);
        if (!n) return "";
        var f = C.fold(n);
        if (map[f]) return map[f];
        var id = hid(kind + "|" + f);
        map[f] = id;
        made.push({ id: id, m: Math.max(now, (tombs[id] || 0) + 1), name: n });
        return id;
      };
    }
    var catId = finder("cats", out.cats, "cat"), supId = finder("sups", out.sups, "sup");
    var vat = data.settings && typeof data.settings.vat === "number" ? data.settings.vat : 24;
    function cents(v) { return v === null || !(v >= 0) ? 0 : Math.min(C.C_MAX, Math.round(v * 100)); }
    function pieces(v) { return v === null || !(v > 0) ? 0 : Math.min(C.Q_MAX, Math.round(v) * 1000); }
    var lines = [], usedCat = {}, usedSup = {};
    res.items.forEach(function (x) {
      var id = idOf(res.source, x.key);
      var cur = byId[id] || (x.sku && bySku[C.fold(x.sku)]) || (x.bc && byBc[C.fold(x.bc)]) || byName[C.fold(x.name)];
      if (cur) { out.stats.same++; return; }       // already here: the user's row is kept
      var row = C.normItem({
        id: id, m: Math.max(now, (tombs[id] || 0) + 1), name: x.name, sku: x.sku, bc: x.bc,
        cat: x.cat ? catId(x.cat) : "", unit: "pcs", min: pieces(x.min), rq: 0,
        sup: x.sup ? supId(x.sup) : "", ssku: "", cost: cents(x.cost), price: cents(x.price),
        vat: vat, loc: "", note: x.note || "", arch: x.arch ? 1 : 0
      });
      if (!row) { out.stats.skipped++; return; }
      byId[id] = row;
      if (row.sku) bySku[C.fold(row.sku)] = row;
      if (row.bc) byBc[C.fold(row.bc)] = row;
      if (!byName[C.fold(row.name)]) byName[C.fold(row.name)] = row;
      if (row.cat) usedCat[row.cat] = true;
      if (row.sup) usedSup[row.sup] = true;
      out.items.push(row);
      out.undo.items.push(id);
      if (id in tombs) out.stats.back++; else out.stats.added++;
      var q = pieces(x.qty);
      if (q > 0) {
        out.stats.withQty++;
        if (o.setQty) lines.push({ i: id, q: q, n: q });
      }
    });
    // only lists the new products use
    out.cats = out.cats.filter(function (c) { return usedCat[c.id]; });
    out.sups = out.sups.filter(function (s) { return usedSup[s.id]; });
    out.undo.cats = out.cats.map(function (c) { return c.id; });
    out.undo.sups = out.sups.map(function (s) { return s.id; });
    for (var i = 0; i < lines.length; i += C.MAX_LINES) {
      var part = lines.slice(i, i + C.MAX_LINES);
      var mid = hid("mv|" + res.source + "|" + part.map(function (l) { return l.i + ":" + l.q; }).join(","));
      out.moves.push({ id: mid, m: now, d: today, t: "count", ref: C.cleanText(o.ref || SRC_NAME[res.source], C.REF_LEN, false),
                       sup: "", note: "", src: "imp:" + res.source, lines: part });
      out.undo.moves.push(mid);
      out.stats.qty += part.length;
    }
    return out;
  }

  // The plan into a COPY of the data (core.merge canonicalises it).
  function apply(data, p) {
    var C = core(), d = JSON.parse(JSON.stringify(data || {}));
    ["items", "cats", "sups", "moves"].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    if (!d.tombs || typeof d.tombs !== "object") d.tombs = {};
    ["cats", "sups", "items", "moves"].forEach(function (k) {
      var ids = {};
      p[k].forEach(function (x) { ids[x.id] = true; });
      d[k] = d[k].filter(function (x) { return !ids[x.id]; }).concat(JSON.parse(JSON.stringify(p[k])));
    });
    return C.merge(d, d);
  }

  // Back to how it was: moves voided, rows tombstoned (newer than the
  // row, so a sync that already carried the import cannot bring it
  // back); a product with a movement is archived (merge keeps it).
  function undo(data, info, now) {
    var C = core(), d = JSON.parse(JSON.stringify(data || {}));
    now = now || Date.now();
    if (!d.tombs || typeof d.tombs !== "object") d.tombs = {};
    var used = {};
    (d.moves || []).forEach(function (x) {
      if (info.moves.indexOf(x.id) >= 0 && x.v !== 1) { x.v = 1; x.m = Math.max(now, x.m + 1); }
      x.lines.forEach(function (l) { used[l.i] = true; });
    });
    var keep = {};
    d.items = (d.items || []).filter(function (it) {
      if (info.items.indexOf(it.id) < 0) return true;
      if (used[it.id]) {
        it.arch = 1;
        it.m = Math.max(now, it.m + 1);
        if (it.cat) keep[it.cat] = true;
        if (it.sup) keep[it.sup] = true;
        return true;
      }
      d.tombs[it.id] = Math.max(now, it.m);
      return false;
    });
    ["cats", "sups"].forEach(function (k) {
      d[k] = (d[k] || []).filter(function (x) {
        if (info[k].indexOf(x.id) < 0 || keep[x.id]) return true;
        d.tombs[x.id] = Math.max(now, x.m);
        return false;
      });
    });
    return C.merge(d, d, now);
  }

  var API = {
    ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, SRC_NAME: SRC_NAME,
    readBytes: readBytes, toCsv: toCsv, htmlText: htmlText, detect: detect,
    parseRows: parseRows, idOf: idOf, plan: plan, apply: apply, undo: undo
  };
  if (NODE) module.exports = API;
  else root.OrosStockImport = API;
})(typeof self !== "undefined" ? self : this);
