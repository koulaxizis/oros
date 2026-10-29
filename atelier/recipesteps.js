// ============================================================
// orOS Atelier — recipesteps.js: the steps an automation may use
// (v1.0.0). The catalog for recipes/core.js (orosRecipes): what a
// step is called, what it takes, and, for the steps that only edit
// the design, what it does. The rest (background removal, new
// sizes, download) needs the browser and runs in recipes.js.
//   text   find → repl in text boxes and table cells (cs = match
//          case, word = whole words only)
//   color  every fill, outline, gradient end and table colour that
//          is `from` becomes `to`
//   font   text and tables in `from` ("" = any font) get `to`
//   size   text sizes × pct %
//   filter the photo filter of every photo ("none" removes it)
//   center text boxes (or every element) centred across the page
//   cutout remove the background of every photo (on the device)
//   resize sizes [{ w, h, u px|mm, p preset id }]: copies = new
//          designs in each size (the next steps work on the copies),
//          else this design takes the first size
//   export download every page: png / jpg (scale ×1-3) or pdf
//          (150 / 300 dpi); several files come as one ZIP
// apply(doc, step, ctx) edits a copy of a design in place (ctx.now,
// ctx.textHeight) and returns how many elements changed; nothing
// else is touched, so the same recipe twice changes nothing more.
// learn(before, after) turns what someone did by hand (Record) into
// steps: changed words, colours, fonts, text sizes, photo filters.
// Pure: no DOM. Exposes window.AtelierRecipes (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, FX, AX;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); FX = require("../designkit/fx.js"); AX = require("./ax.js");
  } else {
    M = root.orosDK.model; FX = root.orosDK.fx; AX = root.AtelierAX;
  }
  var FILTER_IDS = FX.FILTERS.map(function (f) { return f.id; });

  var SIZE = { t: "obj", f: { w: { t: "num", lo: 1, hi: 20000, req: 1 }, h: { t: "num", lo: 1, hi: 20000, req: 1 }, u: { t: "enum", v: ["px", "mm"], def: "px" }, p: { t: "str", max: 40 } } };
  var CATALOG = {
    text: { kind: "doc", args: { find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } } },
    color: { kind: "doc", args: { from: { t: "color", req: 1 }, to: { t: "color", req: 1 } } },
    font: { kind: "doc", args: { from: { t: "font" }, to: { t: "font", req: 1 } } },
    size: { kind: "doc", args: { pct: { t: "num", lo: 10, hi: 1000, def: 100, req: 1 } } },
    filter: { kind: "doc", args: { flt: { t: "enum", v: FILTER_IDS, def: "none" } } },
    center: { kind: "doc", args: { what: { t: "enum", v: ["text", "all"], def: "text" } } },
    cutout: { kind: "async", args: {} },
    resize: { kind: "async", args: { sizes: { t: "list", of: SIZE, min: 1, max: 12 }, copies: { t: "bool", def: 1 } } },
    export: { kind: "out", args: { fmt: { t: "enum", v: ["png", "jpg", "pdf"], def: "png" }, scale: { t: "enum", v: [1, 2, 3], def: 1 }, dpi: { t: "enum", v: [150, 300], def: 300 } } }
  };
  var ORDER = ["text", "color", "font", "size", "filter", "center", "cutout", "resize", "export"];

  // ---------- 1. Applying a step ----------
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function swap(s, rx, repl) {
    if (typeof s !== "string" || !s) return s;
    return s.replace(rx, function () { return repl; }).slice(0, AX.MAX_TX);
  }
  function lc(c) { return typeof c === "string" ? c.toLowerCase() : c; }

  function apply(doc, st, ctx) {
    ctx = ctx || {};
    var nw = ctx.now || Date.now(), n = 0;
    var th = ctx.textHeight || function (it) { return AX.textHeight(M.normItem(it) || it); };
    var W = doc.setup.w, rx = st.op === "text" ? finder(st) : null;
    doc.items.forEach(function (it) {
      var ax = it.ax;
      if (!ax) return;                       // a kind this copy does not know (axu)
      var before = JSON.stringify(it), k = ax.k;
      switch (st.op) {
        case "text":
          if (k === "text") ax.tx = swap(ax.tx, rx, st.repl);
          if (k === "table" && ax.tb && Array.isArray(ax.tb.rows)) {
            ax.tb.rows = ax.tb.rows.map(function (r) { return (r || []).map(function (c) { return swap(c, rx, st.repl); }); });
          }
          break;
        case "color":
          ["fc", "sc"].forEach(function (f) { if (lc(ax[f]) === st.from) ax[f] = st.to; });
          if (ax.g) ["a", "b"].forEach(function (f) { if (lc(ax.g[f]) === st.from) ax.g[f] = st.to; });
          if (ax.tb) ["ac", "bf", "cf"].forEach(function (f) { if (lc(ax.tb[f]) === st.from) ax.tb[f] = st.to; });
          break;
        case "font":
          if ((k === "text" || k === "table") && (!st.from || AX.fontOf(it) === st.from)) AX.setFont(it, st.to);
          break;
        case "size":
          if (k === "text" || k === "table") {
            var s0 = ax.size || (k === "table" ? AX.TABLE_SIZE : AX.TEXT_DEF.size);
            ax.size = Math.min(2000, Math.max(2, Math.round(s0 * st.pct) / 100));
          }
          break;
        case "filter":
          if (k === "photo") { if (st.flt === "none") delete ax.flt; else ax.flt = st.flt; }
          break;
        case "center":
          if (!ax.bg && !it.lock && (st.what === "all" || k === "text")) it.x = Math.round((W - it.w) / 2 * 100) / 100;
          break;
      }
      if (k === "text" && JSON.stringify(it) !== before) it.h = th(it);
      if (JSON.stringify(it) !== before) { M.touch(it, nw); n++; }
    });
    return n;
  }

  // ---------- 2. Record: steps from what changed ----------
  var WORD = /[\p{L}\p{N}_]/u;
  function wordAt(s, i) { return i >= 0 && i < s.length && WORD.test(s.charAt(i)); }
  // The changed part of a text, widened to whole words.
  function textChange(a, b) {
    if (a === b) return null;
    var p = 0, la = a.length, lb = b.length;
    while (p < la && p < lb && a.charAt(p) === b.charAt(p)) p++;
    var s = 0;
    while (s < la - p && s < lb - p && a.charAt(la - 1 - s) === b.charAt(lb - 1 - s)) s++;
    while (p > 0 && (wordAt(a, p - 1) || wordAt(b, p - 1))) p--;
    while (s > 0 && (wordAt(a, la - s) || wordAt(b, lb - s))) s--;
    var find = a.slice(p, la - s), repl = b.slice(p, lb - s);
    if (!find.trim()) {
      if (!a.trim()) return null;
      find = a; repl = b;                   // only added: the whole old text
    }
    return { find: find.slice(0, 500), repl: repl.slice(0, 2000) };
  }

  function learn(before, after) {
    var out = { text: [], color: [], font: [], size: [], filter: [] }, seen = {};
    function add(kind, key, step) { if (seen[kind + key]) return; seen[kind + key] = 1; out[kind].push(step); }
    var was = {};
    (before.items || []).forEach(function (it) { was[it.id] = it; });
    var ratios = [];
    (after.items || []).forEach(function (it) {
      var o = was[it.id];
      if (!o || !o.ax || !it.ax || o.ax.k !== it.ax.k) return;
      var a = o.ax, b = it.ax, k = b.k;
      if (k === "text" && a.tx !== b.tx) {
        var c = textChange(a.tx || "", b.tx || "");
        if (c) add("text", c.find, { op: "text", find: c.find, repl: c.repl, cs: 1, word: 0 });
      }
      function col(x, y) { x = lc(x); y = lc(y); if (x && y && x !== y) add("color", x, { op: "color", from: x, to: y }); }
      col(a.fc, b.fc); col(a.sc, b.sc);
      if (a.g && b.g) { col(a.g.a, b.g.a); col(a.g.b, b.g.b); }
      if (a.tb && b.tb) { col(a.tb.ac, b.tb.ac); col(a.tb.bf, b.tb.bf); col(a.tb.cf, b.tb.cf); }
      if (k === "text" || k === "table") {
        var fa = a.font || "sans", fb = b.font || "sans";
        if (fa !== fb) add("font", fa, { op: "font", from: fa, to: fb });
        var def = k === "table" ? AX.TABLE_SIZE : AX.TEXT_DEF.size, sa = a.size || def, sb = b.size || def;
        if (sa !== sb) ratios.push(sb / sa);
      }
      if (k === "photo" && (a.flt || "none") !== (b.flt || "none")) {
        out.filter = [{ op: "filter", flt: b.flt || "none" }];
      }
    });
    // one shared change of size; mixed changes are not a rule
    if (ratios.length && ratios.every(function (r) { return Math.abs(r - ratios[0]) < 0.01; })) {
      out.size.push({ op: "size", pct: Math.round(ratios[0] * 1000) / 10 });
    }
    return out.text.concat(out.color, out.font, out.size, out.filter);
  }

  var api = { CATALOG: CATALOG, ORDER: ORDER, apply: apply, learn: learn, textChange: textChange, FILTER_IDS: FILTER_IDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierRecipes = api;
})(typeof window !== "undefined" ? window : this);
