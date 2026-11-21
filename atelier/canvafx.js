// ============================================================
// orOS Atelier — canvafx.js: Canva's text effects and curved text
// from Canva's own PDF of the design (wave CV-F2, v1.0.0)
// Canva's PowerPoint download keeps a text's words, font and colour,
// but not its effect (shadow, splice, echo, glitch, hollow) nor its
// curve. The PDF Canva makes of the same design draws them: the text
// again under or over itself, offset and in another colour, outlined,
// or letter by letter along an arc. When a PowerPoint comes with its
// PDF (the same name, in one folder or one pick), this file reads the
// PDF's letters and gives the imported text items back their look:
//   glyphs(buf)  → Promise of [[glyph]] per page (browser, PDF.js):
//                  glyph { ch, x, y (baseline, page pt, y down),
//                  rot (radians, y down), size (pt), adv (pt along
//                  the baseline), fill, stroke ("#rrggbb"), mode
//                  (PDF text render mode), lw (stroke width pt), a
//                  (fill alpha 0..1) }
//   pageLooks(items, glyphs) → per text box its effect and arc, or null
//   apply(doc, pages, AX, M) → gives a design's text boxes their look
// Pure parts run in Node (tests); glyphs() needs PDF.js (Layout's
// reader, layout/pdfin.js loadLib).
// ============================================================
(function (root) {
  "use strict";

  var FX;
  if (typeof module !== "undefined" && module.exports) FX = require("../designkit/fx.js");
  else FX = root.orosDK.fx;

  // ---------- 1. Passes ----------
  // How Canva's PDF draws one text box, in drawing order: its effect
  // layers (each the whole text in one colour, offset), an invisible
  // copy (fill alpha 0), then the text itself in its own colours. A
  // line at a time, so one layer's lines lie between the other
  // layers' lines: a layer is found among the glyphs of its own style.
  // The letters of a text as Canva draws them: no spaces; caps as shown.
  function letters(s) { return Array.from(String(s || "").replace(/\s+/g, "")); }
  function visible(g) { return g.mode !== 3 && g.mode < 4 && !(g.a <= 0.001) && g.ch && /\S/.test(g.ch); }
  // every place the letters stand one after another in list (glyphs):
  // [[index in list]]
  function spots(list, want) {
    var out = [], n = want.length;
    if (!n) return out;
    for (var i = 0; i + n <= list.length; i++) {
      var k = 0;
      while (k < n && list[i + k].ch === want[k]) k++;
      if (k === n) { var at = []; for (k = 0; k < n; k++) at.push(i + k); out.push(at); i += n - 1; }
    }
    return out;
  }
  function median(list) {
    var a = list.slice().sort(function (p, q) { return p - q; });
    return a.length ? a[a.length >> 1] : 0;
  }
  // offset of glyphs b from glyphs a: median per letter
  function offset(a, b) {
    var dx = [], dy = [];
    for (var i = 0; i < a.length; i++) { dx.push(b[i].x - a[i].x); dy.push(b[i].y - a[i].y); }
    return { dx: median(dx), dy: median(dy) };
  }
  function colDist(a, b) {
    function c(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    if (!a || !b) return 999;
    var x = c(a), y = c(b);
    return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
  }
  function cyanish(h) { return colDist(h, "#00ffff") < 120; }
  function r0(v) { return Math.round(v); }
  // Atelier's offset for a distance (designkit fx: dist = off / 100 · size · 0.2)
  function offFor(dist, size) { return Math.max(0, Math.min(100, r0(dist / (size * 0.2) * 100))); }
  function dirFor(dx, dy) { return r0(Math.atan2(dy, dx) * 180 / Math.PI); }
  function styleKey(g) { return g.fill + "|" + g.stroke + "|" + g.mode + "|" + Math.round((g.a >= 0 ? g.a : 1) * 100); }

  // ---------- 2. One page ----------
  // items: the page's text boxes in drawing order, each { tx, caps, fc,
  // size, x, y, w, h } in the same units as the glyphs (y down);
  // glyphs: the page's (glyphs() below, scaled to those units).
  // → per item null (not found) or { tfx?, arc?, main: [glyph] }.
  function pageLooks(items, glyphs) {
    var vis = (glyphs || []).filter(visible), used = {}, lastOf = {};
    function free(at) { return at.every(function (i) { return !used[i]; }); }
    return (items || []).map(function (item) {
      var want = letters(item.caps ? String(item.tx || "").toLocaleUpperCase() : item.tx);
      if (want.length < 1) return null;
      var size = item.size || 12, wk = want.join(""), last = lastOf[wk] >= 0 ? lastOf[wk] : -1;
      function near(at) {
        var g = vis[at[0]];
        return Math.hypot(Math.max(item.x - g.x, 0, g.x - (item.x + item.w)), Math.max(item.y - g.y, 0, g.y - (item.y + item.h + size)));
      }
      // the text itself: unused, by its box, opaque and in its colour when one
      // matches, the first drawn after the last box of the same text
      var all = spots(vis, want).filter(function (at) { return free(at) && near(at) < size * 2; });
      if (!all.length) return null;
      var solid = all.filter(function (at) { return !(vis[at[0]].a < 0.99); });
      if (solid.length) all = solid;
      var own = all.filter(function (at) { var g = vis[at[0]]; return colDist(g.mode === 1 ? g.stroke : g.fill, item.fc) < 24; });
      var pool = own.length ? own : all;
      var after = pool.filter(function (at) { return at[0] > last; });
      var mainAt = (after.length ? after : pool)[0];
      var main = mainAt.map(function (i) { return vis[i]; });
      // its layers: drawn before it and after the last box of the same
      // text (another text's layers may come between), each in one
      // style, the whole text, close by
      var from = Math.min(last + 1, mainAt[0]), groups = {}, layers = [];
      for (var j = from; j < mainAt[0]; j++) {
        if (used[j]) continue;
        var k = styleKey(vis[j]);
        (groups[k] = groups[k] || []).push(j);
      }
      Object.keys(groups).forEach(function (k) {
        var idx = groups[k], list = idx.map(function (i) { return vis[i]; });
        spots(list, want).forEach(function (at) {
          var gl = at.map(function (i) { return list[i]; }), o = offset(main, gl);
          if (Math.hypot(o.dx, o.dy) < size * 0.6) layers.push({ at: at.map(function (i) { return idx[i]; }), g: gl, dx: o.dx, dy: o.dy, d: Math.hypot(o.dx, o.dy), fill: gl[0].fill, a: gl[0].a, mode: gl[0].mode, first: idx[at[0]] });
        });
      });
      layers.sort(function (p, q) { return p.first - q.first; });
      mainAt.forEach(function (i) { used[i] = 1; });
      layers.forEach(function (l) { l.at.forEach(function (i) { used[i] = 1; }); });
      lastOf[wk] = mainAt[mainAt.length - 1];
      var res = { main: main, layers: layers.length };
      var tfx = classify(main, layers, size);
      if (tfx) res.tfx = FX.normTextFx(tfx);
      // the curve: the letters turn along the line
      var rots = main.map(function (q) { return q.rot; });
      if (main.length >= 3 && Math.max.apply(null, rots) - Math.min.apply(null, rots) > 0.08) {
        res.arc = { rot0: rots[0], rot1: rots[rots.length - 1], pts: main.map(function (q) { return { x: q.x + Math.cos(q.rot) * q.adv / 2, y: q.y + Math.sin(q.rot) * q.adv / 2 }; }) };
      }
      return res;
    });
  }
  // the layers' look as an Atelier text effect (designkit fx), or null
  function classify(main, layers, size) {
    var moved = layers.filter(function (l) { return l.d > Math.max(0.3, size * 0.005); });
    var stroked = main[0].mode === 1;
    var cy = moved.filter(function (l) { return cyanish(l.fill); }), other = moved.filter(function (l) { return !cyanish(l.fill); });
    if (cy.length === 1 && other.length === 1 && Math.abs(cy[0].dy) < size * 0.02 && Math.abs(other[0].dy) < size * 0.02 && cy[0].dx < 0 && other[0].dx > 0) {
      var g = (Math.abs(cy[0].dx) + Math.abs(other[0].dx)) / 2;
      return { type: "glitch", off: offFor(2 * g, size), color: other[0].fill };
    }
    if (moved.length && stroked) {
      var sp = moved[0];
      return { type: "splice", off: offFor(sp.d, size), dir: dirFor(sp.dx, sp.dy), color: sp.fill };
    }
    if (moved.length >= 2 && moved.every(function (l) { return colDist(l.fill, main[0].fill) < 24; })) {
      var nearest = moved.slice().sort(function (a, b) { return a.d - b.d; })[0];
      return { type: "echo", off: offFor(nearest.d * 1.5, size), dir: dirFor(nearest.dx, nearest.dy) };
    }
    if (moved.length) {
      var sh = moved[0], al = sh.a;
      return { type: "shadow", off: offFor(sh.d, size), dir: dirFor(sh.dx, sh.dy), blur: 0, color: sh.fill, alpha: r0((al >= 0 && al <= 1 ? al : 1) * 100) };
    }
    if (stroked) return { type: "hollow", thick: Math.max(0, Math.min(100, r0((main[0].lw || size * 0.06) / (size * 0.12) * 100))) };
    return null;
  }

  // Atelier's curve value for an arc: the turn from the first letter's
  // middle to the last one's, over the same turn Atelier draws at a
  // trial curve (rot grows with the curve: rot = cx / R, R ∝ 1 / cv).
  function curveFor(arc, trialRot0, trialRot1, trial) {
    var want = arc.rot1 - arc.rot0, got = trialRot1 - trialRot0;
    if (!(Math.abs(got) > 1e-6)) return 0;
    return Math.max(-100, Math.min(100, Math.round(trial * want / got)));
  }

  // ---------- 3. Reading the PDF (browser, PDF.js) ----------
  function mul(a, b) {
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  }
  function flat(args) {
    var out = [];
    (function f(v) { if (v && typeof v === "object" && typeof v.length === "number" && typeof v !== "string") { for (var i = 0; i < v.length; i++) f(v[i]); } else out.push(v); })(args);
    return out;
  }
  function hex(v) {
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    return null;
  }
  // One page's letters from its operator list (PDF.js 4/5: colours come
  // as "#rrggbb"; text state as PDF.js's canvas renderer keeps it).
  function pageGlyphs(lib, page, ops) {
    var O = lib.OPS, vp = page.getViewport({ scale: 1 }).transform, out = [];
    var st = { ctm: [1, 0, 0, 1, 0, 0], fill: "#000000", stroke: "#000000", a: 1, lw: 1, font: null, size: 0, cs: 0, ws: 0, hs: 1, rise: 0, mode: 0, lead: 0, tm: [1, 0, 0, 1, 0, 0], x: 0, y: 0, lx: 0, ly: 0 };
    var stack = [];
    function copy(s) { var o = {}; Object.keys(s).forEach(function (k) { o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; }); return o; }
    function fontObj(name) {
      try { if (page.commonObjs.has(name)) return page.commonObjs.get(name); if (page.objs.has(name)) return page.objs.get(name); } catch (e) {}
      return null;
    }
    function show(glyphs) {
      var f = st.font, fm = (f && f.fontMatrix) || [0.001, 0, 0, 0.001, 0, 0], vert = f && f.vertical;
      if (vert) return;
      var size = st.size, x = 0, sign = size < 0 ? -1 : 1;
      (glyphs || []).forEach(function (g) {
        if (typeof g === "number") { x -= g * size / 1000; return; }
        if (!g) return;
        var w = (g.width || 0) * size * fm[0] * sign;
        var adv = w + (g.isSpace ? st.ws : 0) + st.cs;
        var m = mul(mul(vp, st.ctm), mul(st.tm, [1, 0, 0, 1, st.x + x * st.hs, st.y + st.rise]));
        var sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
        out.push({ i: out.length, ch: g.unicode || "", x: m[4], y: m[5], rot: Math.atan2(m[1], m[0]), size: Math.abs(size) * sy, adv: w * st.hs * sx,
                   fill: st.fill, stroke: st.stroke, mode: st.mode, lw: st.lw * Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])), a: st.a });
        x += adv;
      });
      st.x += x * st.hs;
    }
    var fn = ops.fnArray, ar = ops.argsArray;
    for (var i = 0; i < fn.length; i++) {
      var op = fn[i], a = ar[i];
      try {
        if (op === O.save) stack.push(copy(st));
        else if (op === O.restore) { if (stack.length) st = stack.pop(); }
        else if (op === O.transform) st.ctm = mul(st.ctm, flat(a));
        else if (op === O.paintFormXObjectBegin) { stack.push(copy(st)); var fmx = flat(a[0]); if (fmx.length === 6) st.ctm = mul(st.ctm, fmx); }
        else if (op === O.paintFormXObjectEnd) { if (stack.length) st = stack.pop(); }
        else if (op === O.beginText) { st.tm = [1, 0, 0, 1, 0, 0]; st.x = st.y = st.lx = st.ly = 0; }
        else if (op === O.setFont) { st.font = fontObj(a[0]); st.size = a[1]; }
        else if (op === O.setTextMatrix) { st.tm = flat(a).slice(0, 6); st.x = st.y = st.lx = st.ly = 0; }
        else if (op === O.moveText) { st.x = st.lx += a[0]; st.y = st.ly += a[1]; }
        else if (op === O.setLeadingMoveText) { st.lead = -a[1]; st.x = st.lx += a[0]; st.y = st.ly += a[1]; }
        else if (op === O.nextLine) { st.x = st.lx; st.y = st.ly -= st.lead; }
        else if (op === O.setLeading) st.lead = a[0];
        else if (op === O.setCharSpacing) st.cs = a[0];
        else if (op === O.setWordSpacing) st.ws = a[0];
        else if (op === O.setHScale) st.hs = a[0] / 100;
        else if (op === O.setTextRise) st.rise = a[0];
        else if (op === O.setTextRenderingMode) st.mode = a[0];
        else if (op === O.setFillRGBColor) st.fill = hex(a[0]) || st.fill;
        else if (op === O.setStrokeRGBColor) st.stroke = hex(a[0]) || st.stroke;
        else if (op === O.setLineWidth) st.lw = a[0];
        else if (op === O.setGState) flat(a).forEach(function (v, k, l) { if (v === "ca" && typeof l[k + 1] === "number") st.a = l[k + 1]; });
        else if (op === O.showText) show(a[0]);
        else if (op === O.showSpacedText) show(a[0]);
        else if (op === O.nextLineShowText) { st.x = st.lx; st.y = st.ly -= st.lead; show(a[0]); }
        else if (op === O.nextLineSetSpacingShowText) { st.ws = a[0]; st.cs = a[1]; st.x = st.lx; st.y = st.ly -= st.lead; show(a[2]); }
      } catch (e) { /* one bad operator: skip it */ }
    }
    return out;
  }
  // buf: ArrayBuffer of the PDF → Promise of [[glyph]] (one list per page)
  function glyphs(buf, maxPages) {
    var R = root.LY_PDFIN;
    if (!R) return Promise.resolve(null);
    return R.loadLib().then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = lib.GlobalWorkerOptions.workerSrc || "../vendor/pdfjs/pdf.worker.min.js";
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, maxPages || 300), pages = [], chain = Promise.resolve();
        for (var k = 1; k <= n; k++) (function (k) {
          chain = chain.then(function () { return pdf.getPage(k); }).then(function (page) {
            return page.getOperatorList().then(function (ops) {
              var vp = page.getViewport({ scale: 1 }), list = pageGlyphs(lib, page, ops);
              list.w = vp.width; list.h = vp.height;
              pages.push(list);
              page.cleanup();
            });
          });
        })(k);
        return chain.then(function () { pdf.destroy(); return pages; });
      });
    }).then(null, function () { return null; });
  }

  // ---------- 4. Into a design ----------
  // doc: a design just built from Canva's PowerPoint; pages: glyphs()
  // of Canva's PDF of it; AX, M: Atelier's. Gives text boxes their
  // effect and curve; returns how many boxes changed. A page whose
  // shape differs from the PDF's is left as it is.
  function apply(doc, pages, AX, M) {
    var n = 0;
    if (!doc || !pages || !doc.setup) return 0;
    M.pagesInOrder(doc).forEach(function (pg, k) {
      var gl = pages[k];
      if (!gl || !(gl.w > 0) || !(gl.h > 0)) return;
      var sc = doc.setup.w / gl.w;
      if (!(sc > 0) || Math.abs(doc.setup.h / gl.h - sc) > sc * 0.02) return;
      var G = gl.map(function (g) {
        return { i: g.i, ch: g.ch, x: g.x * sc, y: g.y * sc, rot: g.rot, size: g.size * sc, adv: g.adv * sc, fill: g.fill, stroke: g.stroke, mode: g.mode, lw: g.lw * sc, a: g.a };
      });
      var its = doc.items.filter(function (it) { return it.pg === pg.id && it.ax && it.ax.k === "text" && !it.hide; }).sort(M.byZ);
      var looks = pageLooks(its.map(function (it) {
        return { tx: it.ax.tx, caps: it.ax.caps, fc: it.ax.fc || "#000000", size: it.ax.size || 48, x: it.x, y: it.y, w: it.w, h: it.h };
      }), G);
      looks.forEach(function (lk, i) {
        if (!lk) return;
        var it = its[i], did = 0;
        if (lk.tfx && lk.tfx.type !== "none" && !it.ax.tfx) { it.ax.tfx = lk.tfx; did = 1; }
        if (lk.arc && !it.ax.cv && !it.rot && !AX.tpOf(it) && String(it.ax.tx).indexOf("\n") < 0 && bend(it, lk.arc, AX)) did = 1;
        n += did;
      });
    });
    return n;
  }
  // a curved text: Atelier's curve that turns as much, then the box
  // moved so the letters stand where Canva's do
  function bend(it, arc, AX) {
    var TRIAL = 50, t = JSON.parse(JSON.stringify(it));
    t.ax.cv = TRIAL;
    var ink = function (g) { return /\S/.test(g.ch); };
    var gs = AX.curveLayout(t).glyphs.filter(ink);
    if (gs.length !== arc.pts.length || gs.length < 3) return false;
    var cv = curveFor(arc, gs[0].rot, gs[gs.length - 1].rot, TRIAL);
    if (!cv) return false;
    it.ax.cv = cv;
    var cl = AX.curveLayout(it), g2 = cl.glyphs.filter(ink);
    it.w = Math.round(cl.w * 100) / 100;
    it.h = Math.round(AX.textHeight(it) * 100) / 100;
    var mx = 0, my = 0;
    g2.forEach(function (g, i) { mx += arc.pts[i].x - g.x; my += arc.pts[i].y - g.y; });
    it.x = Math.round((mx / g2.length - it.w / 2) * 100) / 100;
    it.y = Math.round((my / g2.length - it.h / 2) * 100) / 100;
    return true;
  }

  var api = { letters: letters, spots: spots, pageLooks: pageLooks, classify: classify, curveFor: curveFor, pageGlyphs: pageGlyphs, glyphs: glyphs, offFor: offFor, apply: apply };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierCanvaFx = api;
})(typeof window !== "undefined" ? window : this);
