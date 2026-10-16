// ============================================================
// orOS Stock — .orosstock file (stock/package.js,
// window.OrosStockPackage). The descriptor of Stock for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// products, categories, units, suppliers, purchase orders, photos,
// warehouses, movements and the point of sale's receipts, price lists
// and Z reports in one orOS bundle; product photos (Files › Stock/
// Photos) go in media/<sha256>.jpg. Opening one ADDS what this device
// lacks, with its ids. Pure (no DOM, no storage), so the app and
// `node --test` run the same code. Needs core.js (OrosStockCore).
//   DESC                     the kit descriptor; merge = core.merge
//                            (the slice's own symmetric merge: union by
//                            id, a void wins, tombstones of this
//                            device stay as they are)
//   DESC.norm(data)          a file's data → the known lists, every row
//                            through core.js's own norm* (invalid rows
//                            dropped); pics may carry key (the media
//                            key of the photo's bytes); no close
//   DESC.strip(state)        the slice → { ver, settings, items, cats,
//                            units, sups, pos, pics, whs, moves, sales?,
//                            pls?, zs? }: no tombstones; a closed period
//                            becomes its opening balance as "fix"
//                            movements (opening(close)), since the
//                            archived movements stay in Files
//   DESC.tombIds(state)      the ids in state.tombs, plus the ids of the
//                            opening movements of this device's own
//                            close (reopening your own file adds nothing)
//   DESC.previews(state, l)  products.csv and movements.csv (core's
//                            csvProducts / csvMoves, the app's columns)
//   opening(close)           the opening balance → [movement]: one "fix"
//                            per warehouse (≤ 500 lines each), ids
//                            derived from the close's id, src
//                            "close:<id>"; lots are not kept
//   undo(data, ids, now)     Undo of an opened file → { data, files }:
//                            the app's own ways: movements and receipts
//                            voided, a product with movements archived,
//                            other rows tombstoned (newer than the row,
//                            so sync carries it), a photo row emptied;
//                            files = photo names no longer pointed at
// Never in the file: tombstones, device prefs (oros-stock-prefs: the
// till, filters), the shop's connection (its keys live sealed in the
// shell, never in the slice), the archive files of closed periods.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./core.js") : root.OrosStockCore; }

  var LISTS = ["items", "cats", "units", "sups", "pos", "pics", "whs", "moves", "sales", "pls", "zs"];
  var CAP = { items: 20000, cats: 2000, units: 2000, sups: 2000, pos: 2000, pics: 2000, whs: 2000,
              moves: 100000, sales: 50000, pls: 50, zs: 4000 };
  var KEY_RE = /^[0-9a-f]{64}\.jpg$/;
  var OPEN_LINES = 500;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function normFor(C, k) {
    return { items: C.normItem, cats: C.normCat, units: C.normUnit, sups: C.normSup, pos: C.normPo, whs: C.normWh,
             moves: C.normMove, sales: C.normSale, pls: C.normPl, zs: C.normZ, pics: normPicKey }[k];
  }
  // a photo row as core keeps it, plus the media key of its bytes
  function normPicKey(x) {
    var p = core().normPic(x);
    if (p && typeof x.key === "string" && KEY_RE.test(x.key)) p.key = x.key;
    return p;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var C = core(), out = { ver: C.DATA_VER, settings: C.normSettings(data.settings) };
    LISTS.forEach(function (k) {
      var fn = normFor(C, k), list = [];
      (Array.isArray(data[k]) ? data[k] : []).slice(0, CAP[k]).forEach(function (r) {
        var c = fn(r);
        if (c) list.push(c);
      });
      out[k] = list;
    });
    if (isObj(data.tombs)) {                    // strip and tombIds see them, then they go
      out.tombs = {};
      Object.keys(data.tombs).forEach(function (id) { if (C.ID_RE.test(id)) out.tombs[id] = 1; });
    }
    return out;
  }

  // ---------- the opening balance of a closed period ----------
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function opening(close) {
    var C = core(), cl = C.normClose(close);
    if (!cl || !cl.bal.length) return [];
    var per = {};
    cl.bal.forEach(function (l) {
      var w = l.w || "", m = per[w] || (per[w] = {});
      m[l.i] = (m[l.i] || 0) + l.q;
    });
    var out = [];
    Object.keys(per).sort().forEach(function (w) {
      var lines = Object.keys(per[w]).sort().filter(function (i) {
        return per[w][i] !== 0 && Math.abs(per[w][i]) <= C.Q_MAX;
      }).map(function (i) { return { i: i, q: per[w][i] }; });
      for (var n = 0; n * OPEN_LINES < lines.length; n++) {
        var mv = { id: "op" + fnv(cl.id) + fnv("w:" + w) + n.toString(36), m: cl.m, d: cl.d, t: "fix",
                   ref: "", sup: "", note: "", lines: lines.slice(n * OPEN_LINES, (n + 1) * OPEN_LINES),
                   src: "close:" + cl.id };
        if (w) mv.w = w;
        out.push(mv);
      }
    });
    return out;
  }

  function strip(state) {
    var s = isObj(state) ? state : {}, C = core();
    var out = { ver: C.DATA_VER, settings: clone(isObj(s.settings) ? s.settings : {}) };
    LISTS.forEach(function (k) {
      if (Array.isArray(s[k])) out[k] = clone(s[k]);
      else if (k !== "sales" && k !== "pls" && k !== "zs") out[k] = [];
    });
    if (s.close) {
      var have = {};
      out.moves.forEach(function (x) { if (isObj(x)) have[x.id] = 1; });
      opening(s.close).forEach(function (x) { if (!have[x.id]) out.moves.push(x); });
    }
    return out;
  }
  function tombIds(state) {
    if (!isObj(state)) return [];
    var ids = isObj(state.tombs) ? Object.keys(state.tombs) : [];
    if (state.close) opening(state.close).forEach(function (x) { ids.push(x.id); });
    return ids;
  }

  // ---------- previews: the app's two CSV exports ----------
  var HEAD = {
    en: {
      products: ["SKU", "Name", "Barcode", "Category", "Unit", "Quantity", "Min", "Reorder qty", "Supplier", "Supplier code", "Cost ({c})", "Price ({c})", "VAT %", "Location", "Value ({c})", "Note"],
      moves: ["Date", "Type", "Ref", "Supplier", "SKU", "Product", "Quantity", "Unit price ({c})", "Note", "Voided"],
      wh: ["Warehouse", "To warehouse"], lots: ["Lot", "Expiry"],
      types: { "in": "Receive", out: "Sale", ret: "Customer return", rts: "Return to supplier", loss: "Loss / damage",
               count: "Stock count", fix: "Correction", xfer: "Transfer", voided: "voided" },
      main: "Main warehouse"
    },
    el: {
      products: ["SKU", "Όνομα", "Barcode", "Κατηγορία", "Μονάδα", "Ποσότητα", "Ελάχιστο", "Ποσότητα παραγγελίας", "Προμηθευτής", "Κωδικός προμηθευτή", "Κόστος ({c})", "Τιμή ({c})", "ΦΠΑ %", "Θέση", "Αξία ({c})", "Σημείωση"],
      moves: ["Ημερομηνία", "Είδος", "Παραστατικό", "Προμηθευτής", "SKU", "Προϊόν", "Ποσότητα", "Τιμή μονάδας ({c})", "Σημείωση", "Ακυρωμένη"],
      wh: ["Αποθήκη", "Προς αποθήκη"], lots: ["Παρτίδα", "Λήξη"],
      types: { "in": "Παραλαβή", out: "Πώληση", ret: "Επιστροφή πελάτη", rts: "Επιστροφή σε προμηθευτή", loss: "Φθορά / απώλεια",
               count: "Απογραφή", fix: "Διόρθωση", xfer: "Μεταφορά", voided: "ακυρωμένη" },
      main: "Κεντρική αποθήκη"
    }
  };
  // the app's csvText: "," and "." in English, ";" and "," in Greek;
  // core.csvCell puts an apostrophe before = + - @ tab CR
  function csvText(C, el, head, rows) {
    var sep = el ? ";" : ",";
    var lines = [head.map(C.csvCell).join(sep)];
    rows.forEach(function (r) {
      lines.push(r.map(function (v) {
        if (typeof v === "number" && el) return String(v).replace(".", ",");
        return C.csvCell(v);
      }).join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  function previews(state, lang) {
    var C = core(), el = lang === "el", H = HEAD[el ? "el" : "en"];
    var data = C.merge(state, state);
    var cur = data.settings.cur;
    function h(list) { return list.map(function (x) { return x.replace("{c}", cur); }); }
    var units = {};
    C.UNIT_IDS.forEach(function (u) { units[u] = C.unitName(u, el ? "el" : "en"); });
    var out = {};
    if (data.items.length) out["products.csv"] = csvText(C, el, h(H.products), C.csvProducts(data, units));
    if (data.moves.length) {
      var wh = data.whs.some(function (w) { return w.id !== C.WH_MAIN && !w.arch; }) ||
               data.moves.some(function (x) { return x.w || x.w2; });
      var lots = data.moves.some(function (x) { return x.lines.some(function (l) { return l.lot; }); });
      var head = h(H.moves).concat(wh ? H.wh : []).concat(lots ? H.lots : []);
      out["movements.csv"] = csvText(C, el, head, C.csvMoves(data, H.types, wh ? C.whName(data, "", H.main) : undefined, lots));
    }
    return out;
  }

  // ---------- Undo of an opened file ----------
  function undo(data, ids, now) {
    var C = core(), d = clone(isObj(data) ? data : {});
    now = typeof now === "number" ? now : Date.now();
    if (!isObj(d.tombs)) d.tombs = {};
    var set = Object.create(null), files = [];
    (ids || []).forEach(function (id) { set[String(id)] = 1; });
    function bump(x) { x.m = Math.max(now, (x.m || 0) + 1); }
    function tomb(x) { d.tombs[x.id] = Math.max(now, x.m || 0); }
    // movements and receipts are never deleted: voided
    ["moves", "sales"].forEach(function (k) {
      (d[k] || []).forEach(function (x) { if (set[x.id] && x.v !== 1) { x.v = 1; bump(x); } });
    });
    var used = Object.create(null);
    (d.moves || []).forEach(function (x) {
      (x.lines || []).forEach(function (l) { used[l.i] = 1; });
      if (x.w) used[x.w] = 1;
      if (x.w2) used[x.w2] = 1;
    });
    if (d.close && Array.isArray(d.close.bal)) d.close.bal.forEach(function (l) { used[l.i] = 1; if (l.w) used[l.w] = 1; });
    // a product with movements stays (archived), with its category,
    // unit and supplier; one without is tombstoned
    var keep = Object.create(null), gone = Object.create(null);
    d.items = (d.items || []).filter(function (it) {
      if (!set[it.id]) return true;
      if (used[it.id]) {
        if (it.arch !== 1) { it.arch = 1; bump(it); }
        [it.cat, it.sup, it.unit].forEach(function (r) { if (r) keep[r] = 1; });
        return true;
      }
      tomb(it);
      gone[it.id] = 1;
      return false;
    });
    (d.pics || []).forEach(function (p) {
      if (!set[p.id] && !gone[p.id]) return;
      if (p.f) files.push(p.f);
      if (!gone[p.id] && p.f) { p.f = ""; bump(p); }
    });
    ["cats", "units", "sups", "whs", "pos", "pls", "zs"].forEach(function (k) {
      if (!Array.isArray(d[k])) return;
      d[k] = d[k].filter(function (x) {
        if (!set[x.id] || keep[x.id] || (k === "whs" && used[x.id])) return true;
        tomb(x);
        return false;
      });
    });
    return { data: C.merge(d, d, now), files: files };
  }

  var DESC = {
    app: "stock", title: "Stock", slice: "stock", ext: ".orosstock", mime: "application/x-oros-stock",
    colls: {
      items: { shape: "array", id: "id", stamp: "m" },
      cats: { shape: "array", id: "id", stamp: "m" },
      units: { shape: "array", id: "id", stamp: "m" },
      sups: { shape: "array", id: "id", stamp: "m" },
      pos: { shape: "array", id: "id", stamp: "m" },
      pics: { shape: "array", id: "id", stamp: "m" },
      whs: { shape: "array", id: "id", stamp: "m" },
      moves: { shape: "array", id: "id", stamp: "m" },
      sales: { shape: "array", id: "id", stamp: "m" },
      pls: { shape: "array", id: "id", stamp: "m" },
      zs: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (a, b) { return core().merge(a, b); }
  };

  var api = { DESC: DESC, opening: opening, undo: undo, KEY_RE: KEY_RE };
  if (NODE) module.exports = api;
  else root.OrosStockPackage = api;
})(typeof window !== "undefined" ? window : this);
