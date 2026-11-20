// ============================================================
// orOS Atelier — a PDF as an editable design (v1.0.0, wave PS-3)
// Canva's "Download › PDF" (and any other PDF) opens as a NEW design:
// Layout's reader (layout/pdfin.js, PDF.js) finds each page's text
// blocks, pictures and the rest (drawn as one picture per page); this
// file turns its Layout document into Atelier elements:
//   - every page becomes a page; screen-sized pages (anything that is
//     not a paper size) are scaled by 4/3, so a 1080 px Canva post,
//     which Canva writes as 810 pt, is 1080 px again; paper sizes (A
//     and B series, Letter, Legal, Tabloid) keep their size in mm;
//   - each text block becomes one text element: its words, family
//     (sans / serif / mono), size, colour, alignment, line height and
//     turn; words in bold or italic inside it keep their look
//     (ext.runs) and the text is kerned (ext.kern, as Canva sets it);
//   - each picture becomes a photo element you can move, crop or
//     replace; the drawing behind (shapes, backgrounds) becomes one
//     locked photo at the back of the page.
// toDesign(ldoc, opts) → { setup: { w, h, unit }, pages: [[spec]] }
// (specs for AX.addItem; photos carry the asset id the reader stored)
// or null. paper(w, h) → true for a paper size (pt, either way up).
// Pure: no DOM. Exposes window.AtelierPdfIn (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, AX;
  if (typeof module !== "undefined" && module.exports) { M = require("../designkit/model.js"); AX = require("./ax.js"); }
  else { M = root.orosDK.model; AX = root.AtelierAX; }

  var SCREEN = 4 / 3, MAX_RUNS = 400;
  // Paper sizes in pt (portrait), ±2 pt either way up.
  var PAPER = [[595.28, 841.89], [419.53, 595.28], [297.64, 419.53], [841.89, 1190.55], [1190.55, 1683.78], [209.76, 297.64],
               [498.9, 708.66], [354.33, 498.9], [612, 792], [612, 1008], [792, 1224], [283.46, 419.53], [311.81, 623.62]];
  function paper(w, h) {
    var a = Math.min(w, h), b = Math.max(w, h);
    return PAPER.some(function (p) { return Math.abs(p[0] - a) <= 2 && Math.abs(p[1] - b) <= 2; });
  }
  function hexOf(sw) {
    if (!sw || !Array.isArray(sw.v)) return "#000000";
    return "#" + sw.v.slice(0, 3).map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  function toDesign(ld, opts) {
    opts = opts || {};
    if (!ld || !Array.isArray(ld.pages) || !ld.pages.length) return null;
    var w0 = ld.setup.w, h0 = ld.setup.h, isPaper = paper(w0, h0), k = isPaper ? 1 : SCREEN;
    var sw = {}, ps = {}, cs = {}, story = {};
    (ld.swatches || []).forEach(function (s) { sw[s.id] = s; });
    (ld.pstyles || []).forEach(function (s) { ps[s.id] = s; });
    (ld.cstyles || []).forEach(function (s) { cs[s.id] = s; });
    (ld.stories || []).forEach(function (s) { story[s.id] = s; });
    function colour(id) {
      if (id === "sw-paper") return "#ffffff";
      if (!id || id === "sw-black") return "#000000";
      return hexOf(sw[id]);
    }
    var order = M.pagesInOrder(ld), pages = [];
    order.forEach(function (pg) {
      var items = ld.items.filter(function (it) { return it.pg === pg.id; }).sort(function (a, b) { return a.z - b.z; });
      var specs = [], z = 1;
      items.forEach(function (it) {
        var box = { x: r1(it.x * k), y: r1(it.y * k), w: r1(it.w * k), h: r1(it.h * k), rot: it.rot || 0 };
        if (it.t === "img" && it.a) {
          specs.push(Object.assign(box, { k: "photo", a: it.a, iw: it.iw, ih: it.ih, nm: it.nm || "", fit: "fill", lock: it.lock ? 1 : 0, z: z++ }));
          return;
        }
        if (it.t !== "text" || !story[it.story]) return;
        var st = story[it.story], P = ps[(st.paras[0] || {}).ps] || {};
        var tx = "", runs = [], allB = true, allI = true, anyB = false, anyI = false;
        st.paras.forEach(function (p, pi) {
          if (pi) { tx += "\n"; runs.push({ n: 1 }); }
          (p.runs || []).forEach(function (r) {
            var t = String(r.t || "");
            if (!t) return;
            tx += t;
            var o = { n: t.length };
            if (r.b) o.b = 1;
            if (r.i) o.i = 1;
            if (r.b) anyB = true; else allB = false;
            if (r.i) anyI = true; else allI = false;
            runs.push(o);
          });
        });
        if (!tx.trim()) return;
        // one look throughout (all or none in bold / italic) is on the
        // element; only a mixed look goes into runs
        var mixB = anyB && !allB, mixI = anyI && !allI, mixed = mixB || mixI;
        runs.forEach(function (o) {
          if (mixB) o.b = o.b ? 1 : 0; else delete o.b;
          if (mixI) o.i = o.i ? 1 : 0; else delete o.i;
        });
        var size = (P.size || 12) * k, lh = P.lead && P.size ? Math.round(P.lead / P.size * 100) : 120;
        var spec = Object.assign(box, {
          k: "text", tx: tx.slice(0, 20000), font: P.font || "sans", size: r1(size), fc: colour(P.color), al: P.align || "l",
          lh: Math.max(70, Math.min(300, lh)), b: allB ? 1 : 0, i: allI ? 1 : 0, z: z++, ext: { kern: 1 }
        });
        // a block in one colour other than its style's (character style)
        var c0 = st.paras[0] && st.paras[0].runs && st.paras[0].runs[0] && st.paras[0].runs[0].cs;
        if (c0 && cs[c0] && cs[c0].color) spec.fc = colour(cs[c0].color);
        if (mixed && runs.length <= MAX_RUNS) spec.ext.runs = merge(runs);
        specs.push(spec);
      });
      pages.push(specs);
    });
    return { setup: { w: isPaper ? w0 : Math.round(w0 * k), h: isPaper ? h0 : Math.round(h0 * k), unit: isPaper ? "mm" : "px" }, pages: pages, scaled: k !== 1 };
  }
  // neighbouring runs in the same look become one
  function merge(runs) {
    var out = [];
    runs.forEach(function (r) {
      var p = out[out.length - 1];
      if (p && (p.b || 0) === (r.b || 0) && (p.i || 0) === (r.i || 0)) p.n += r.n;
      else out.push(Object.assign({}, r));
    });
    return out.map(function (r) { var o = { n: r.n }; if (r.b) o.b = 1; else if (r.b === 0) o.b = 0; if (r.i) o.i = 1; else if (r.i === 0) o.i = 0; return o; });
  }

  var api = { toDesign: toDesign, paper: paper, SCREEN: SCREEN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierPdfIn = api;
})(typeof window !== "undefined" ? window : this);
