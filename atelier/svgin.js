// ============================================================
// orOS Atelier — SVG as editable shapes (v1.0.0, vector wave VEC-4)
// An SVG read by Layout's reader (layout/svgin.js parse(), through the
// Scribus tokenizer layout/sla.js: no DOM, no scripts, no external
// files, no style sheets, filters, masks or clip paths) becomes
// Atelier elements:
//   - rectangles without rounding: shape "rect"; ellipses: "circle";
//     every other outline (rounded, turned, skewed, paths, polygons):
//     a shape with its own outline (ext.pth, as the pen draws);
//   - fill / stroke colours, stroke width, dashes, opacity; linear and
//     radial gradients as ax.g + ext.gs (their own stops, ≤ 10);
//   - lines: line elements; texts: one text element per run of text
//     (font family sans / serif / mono, bold, italic, size, colour,
//     turn); pictures embedded as data: photos (the caller stores
//     them), linked pictures are left out (counted);
//   - everything scaled and moved into `box` (keeping proportions),
//     in the file's order, texts on top.
// toSpecs(page, box, opts) → { specs: [AX.addItem spec], images: [{ i
// (spec index), mime, data (base64) }], bg, skipped, linked } or null;
// opts.bg: a first plain rectangle over the whole page is the page's
// colour (bg) rather than a shape. Runs of text on one baseline in one
// look join into one text element.
// Pure: no DOM. Exposes window.AtelierSvgIn (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, V, AX, T;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); V = require("../designkit/vector.js"); AX = require("./ax.js"); T = require("../designkit/text.js");
  } else { M = root.orosDK.model; V = root.orosDK.vector; AX = root.AtelierAX; T = root.orosDK.text; }

  var EXT_ROOM = 8000, MAX_SPECS = 1500;

  function hex(c) {
    if (!Array.isArray(c)) return "";
    return "#" + c.slice(0, 3).map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // a gradient of a box (Layout gr: fractions of the item's box) → { g, gs }
  function gradient(gr, w, h) {
    if (!gr || !Array.isArray(gr.st) || gr.st.length < 2) return null;
    var st = gr.st.slice(0, 10).map(function (s) { return [Math.round(Math.max(0, Math.min(1, s[0])) * 1000) / 1000, hex(s[1])]; });
    for (var i = 1; i < st.length; i++) if (st[i][0] < st[i - 1][0]) st[i][0] = st[i - 1][0];
    var g = { a: st[0][1], b: st[st.length - 1][1], ang: 90 };
    var gs = { st: st };
    if (gr.k === "r") {
      gs.r = 1;
      gs.c = [Math.max(0, Math.min(1, gr.x1)), Math.max(0, Math.min(1, gr.y1))];
    } else {
      var dx = (gr.x2 - gr.x1) * w, dy = (gr.y2 - gr.y1) * h;
      g.ang = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360);
    }
    return { g: g, gs: gs };
  }

  function look(spec, it, k) {
    if (it.fill) spec.fc = hex(it.fill);
    if (it.stroke && it.sw > 0) { spec.sc = hex(it.stroke); spec.sw = r2(Math.max(0.1, it.sw * k)); }
    if (it.dash) spec.dash = 1;
    if (it.op !== undefined && it.op < 100) spec.op = Math.max(0, Math.round(it.op));
  }

  function covers(it, pw, ph) {
    var e = Math.max(pw, ph) * 0.002;
    return (it.t === "rect" || it.t === "path") && !it.rot && it.fill && !it.gr && !(it.stroke && it.sw > 0) && !(it.op < 100) &&
      Math.abs(it.x) <= e && Math.abs(it.y) <= e && Math.abs(it.w - pw) <= e && Math.abs(it.h - ph) <= e &&
      (it.t === "rect" || /^M0 0L1 0L1 1L0 1Z$/.test(it.d || ""));
  }
  // runs of one line in one look, side by side → one run
  function joinRuns(list) {
    var out = [];
    list.forEach(function (pc) {
      var q = out[out.length - 1];
      var same = q && Math.abs(q.y - pc.y) < 0.5 && Math.abs((q.rot || 0) - (pc.rot || 0)) < 0.01 && Math.abs(q.size - pc.size) < 0.01 &&
        q.fam === pc.fam && q.b === pc.b && q.i === pc.i && String(q.color) === String(pc.color) && !(pc.rot);
      var gap = same ? pc.x - (q.x + q.w) : 0;
      if (same && gap > -1 && gap < pc.size * 0.8) {
        out[out.length - 1] = { s: q.s + (gap > pc.size * 0.15 && !/\s$/.test(q.s) && !/^\s/.test(pc.s) ? " " : "") + pc.s, x: q.x, y: q.y, w: pc.x + pc.w - q.x,
          size: q.size, rot: q.rot, fam: q.fam, b: q.b, i: q.i, color: q.color };
      } else out.push(pc);
    });
    return out;
  }

  function toSpecs(page, box, opts) {
    if (!page || !page.items) return null;
    opts = opts || {};
    var pw = page.w || 1, ph = page.h || 1;
    var b = box || { x: 0, y: 0, w: pw, h: ph };
    var k = Math.min(b.w / pw, b.h / ph);
    var ox = b.x + (b.w - pw * k) / 2, oy = b.y + (b.h - ph * k) / 2;
    function X(x) { return r2(ox + x * k); }
    function Y(y) { return r2(oy + y * k); }
    var specs = [], images = [], skipped = page.skipped || 0, bg = "";
    page.items.forEach(function (it, n) {
      if (opts.bg && n === 0 && covers(it, pw, ph)) { bg = hex(it.fill); return; }
      if (specs.length >= MAX_SPECS) { skipped++; return; }
      var spec = null;
      if (it.t === "line") {
        if (!it.stroke) return;
        spec = { k: "line", x: X(it.x), y: Y(it.y), w: r2(it.w * k), h: r2(it.h * k), sc: hex(it.stroke), sw: r2(Math.max(0.1, (it.sw || 1) * k)) };
        if (it.dash) spec.dash = 1;
        if (it.op !== undefined && it.op < 100) spec.op = it.op;
        specs.push(spec);
        return;
      }
      if (it.t === "img") {
        var im = (page.images || []).filter(function (x) { return x.item === it; })[0];
        if (!im) return;
        spec = { k: "photo", x: X(it.x), y: Y(it.y), w: r2(it.w * k), h: r2(it.h * k), rot: r2(it.rot || 0), fit: it.fit === "fit" ? "fit" : "fill" };
        if (it.op !== undefined && it.op < 100) spec.op = it.op;
        images.push({ i: specs.length, mime: im.mime, data: im.data, name: it.nm || "" });
        specs.push(spec);
        return;
      }
      var w = Math.max(0.5, it.w * k), h = Math.max(0.5, it.h * k);
      spec = { k: "shape", shp: "rect", x: X(it.x), y: Y(it.y), w: r2(w), h: r2(h), rot: r2(it.rot || 0) };
      look(spec, it, k);
      if (it.gr) {
        var gg = gradient(it.gr, it.w, it.h);
        if (gg) { spec.g = gg.g; delete spec.fc; spec.ext = { gs: gg.gs }; }
      }
      if (!spec.fc && !spec.g && !spec.sc) return;
      var unit = null;
      if (it.t === "ell") spec.shp = "circle";
      else if (it.t === "rect" && it.r > 0) unit = roundRect(it.w, it.h, it.r);
      else if (it.t === "path") unit = M.parsePath(it.d);
      if (unit) {
        var rest = spec.ext || {};
        var p = V.pack(unit, EXT_ROOM - JSON.stringify(rest).length - 12);
        if (!p) { skipped++; return; }
        rest.pth = p;
        spec.ext = rest;
      }
      specs.push(spec);
    });
    // texts on top, one element per run
    joinRuns(page.pieces || []).forEach(function (pc) {
      if (specs.length >= MAX_SPECS || !pc.s || !pc.s.trim()) return;
      var size = Math.max(2, Math.min(2000, pc.size * k)), font = pc.fam === "serif" || pc.fam === "mono" ? pc.fam : "sans";
      var ax = { k: "text", tx: pc.s.replace(/^\s+|\s+$/g, ""), font: font, size: r2(size) };
      if (pc.b) ax.b = 1;
      if (pc.i) ax.i = 1;
      ax.fc = hex(pc.color) || "#000000";
      var key = AX.fontKeyOf(ax), asc = T.ascent(key, size), desc = T.descent(key, size);
      var lead = (AX.TEXT_DEF.lh / 100) * size;
      var tw = Math.ceil(AX.textWidth(ax) + 1), th = Math.max(lead, asc + desc);
      // the run starts at its baseline point p, turned about it
      var px = X(pc.x), py = Y(pc.y), top = asc;                                  // the first baseline: one ascent below the box top
      var a = (pc.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      var lx = tw / 2, ly = th / 2 - top;                                          // centre relative to p, unturned
      var cx = px + lx * c - ly * s, cy = py + lx * s + ly * c;
      var spec = { x: r2(cx - tw / 2), y: r2(cy - th / 2), w: tw, rot: r2(pc.rot || 0) };
      Object.keys(ax).forEach(function (kk) { spec[kk] = ax[kk]; });
      specs.push(spec);
    });
    return { specs: specs, images: images, bg: bg, skipped: skipped, linked: page.linked || 0 };
  }
  // a rounded rectangle in unit space (radius in the item's points)
  function roundRect(w, h, r) {
    var c = V.rectCmds(w, h, Math.min(r, w / 2, h / 2));
    return c.map(function (cmd) {
      var o = [cmd[0]];
      for (var i = 1; i < cmd.length; i += 2) o.push(cmd[i] / w, cmd[i + 1] / h);
      return o;
    });
  }

  var api = { toSpecs: toSpecs, gradient: gradient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierSvgIn = api;
})(typeof window !== "undefined" ? window : this);
