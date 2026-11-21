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
  function pageLooks(items, glyphs, imgs) {
    var vis = (glyphs || []).filter(visible), used = {}, lastOf = {}, fullOf = {}, taken = {};
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
      // pictures drawn just before it that frame its letters: Canva's
      // outline, glow or lift
      var lo = fullOf[wk] >= 0 ? fullOf[wk] : -1, ink = inkBox(main, size);
      fullOf[wk] = main[main.length - 1].i;
      (imgs || []).forEach(function (im, k) {
        if (taken[k] || !im.straight || im.at <= lo || im.at > main[0].i) return;
        var m = size * 1.5;
        if (im.x < ink.x - m || im.y < ink.y - m || im.x + im.w > ink.x + ink.w + m || im.y + im.h > ink.y + ink.h + m) return;
        var ox = Math.min(im.x + im.w, ink.x + ink.w) - Math.max(im.x, ink.x), oy = Math.min(im.y + im.h, ink.y + ink.h) - Math.max(im.y, ink.y);
        if (!(ox > 0 && oy > 0) || ox * oy < ink.w * ink.h * 0.85) return;
        taken[k] = 1;
        (res.pics = res.pics || []).push(im);
      });
      var tfx = classify(main, layers, size) || outlineOf(main, layers, size);
      if (tfx) res.tfx = FX.normTextFx(tfx);
      // the curve: the letters turn along the line
      var rots = main.map(function (q) { return q.rot; });
      if (main.length >= 3 && Math.max.apply(null, rots) - Math.min.apply(null, rots) > 0.08) {
        res.arc = { rot0: rots[0], rot1: rots[rots.length - 1], pts: main.map(function (q) { return { x: q.x + Math.cos(q.rot) * q.adv / 2, y: q.y + Math.sin(q.rot) * q.adv / 2 }; }) };
      }
      return res;
    });
  }
  // the letters' ink: from the cap height to below the baseline
  function inkBox(main, size) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    main.forEach(function (g) {
      var s = g.size || size;
      x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x + g.adv);
      y0 = Math.min(y0, g.y - s * 0.75); y1 = Math.max(y1, g.y + s * 0.2);
    });
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
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

  // Canva's outline: the text in place in another colour, drawn in a
  // Type3 font of outlined letters; its letters are wider than the text's
  // by the line on both sides. Atelier's outline draws a line of
  // thick / 100 · size · 0.24 across the letters' edge.
  function outlineOf(main, layers, size) {
    var ol = layers.filter(function (l) { return l.g[0].t3 && l.d < size * 0.05 && !(l.a < 0.5) && colDist(l.fill, main[0].fill) >= 24; })[0];
    if (!ol) return null;
    var dw = [];
    ol.g.forEach(function (g, k) { var m = main[k]; if (g.inkw > 0 && m && m.inkw > 0) dw.push(g.inkw - m.inkw); });
    var w = dw.length ? med(dw) : size * 0.072;
    return { type: "outline", color: ol.fill, thick: Math.max(1, Math.min(100, r0(w / (size * 0.0024)))) };
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
    var stack = [], imgs = [];
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
        var q = { i: out.length, ch: g.unicode || "", x: m[4], y: m[5], rot: Math.atan2(m[1], m[0]), size: Math.abs(size) * sy, adv: w * st.hs * sx,
                   fill: st.fill, stroke: st.stroke, mode: st.mode, lw: st.lw * Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])), a: st.a };
        // Canva's outline is the text again in a Type3 font whose letters
        // are the outlined shapes (CV-F4): keep how wide their ink is;
        // other letters keep where to measure theirs (inkWidths below)
        if (f && f.isType3Font) {
          q.t3 = 1;
          var cp = f.charProcOperatorList && f.charProcOperatorList[g.operatorListId], d1 = cp ? cp.fnArray.indexOf(O.setCharWidthAndBounds) : -1;
          var bb = d1 >= 0 ? flat(cp.argsArray[d1]) : null;
          if (bb && bb.length >= 6) q.inkw = Math.abs((bb[4] - bb[2]) * fm[0] * size) * st.hs * sx;
        } else if (f && f.loadedName && g.fontChar) { q.fk = f.loadedName; q.fch = g.fontChar; }
        out.push(q);
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
        else if (op === O.paintImageXObject || op === O.paintInlineImageXObject) {
          // a picture: where it lies (Canva draws an outline, glow or lift
          // as a picture under the text, CV-F4)
          var um = mul(mul(vp, st.ctm), [1, 0, 0, 1, 0, 0]), xs = [], ys = [];
          [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (c) { xs.push(um[0] * c[0] + um[2] * c[1] + um[4]); ys.push(um[1] * c[0] + um[3] * c[1] + um[5]); });
          imgs.push({ at: out.length, id: typeof a[0] === "string" ? a[0] : null, img: typeof a[0] === "string" ? null : a[0], straight: Math.abs(um[1]) < 1e-6 && Math.abs(um[2]) < 1e-6,
                      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) });
        }
        else if (op === O.showText) show(a[0]);
        else if (op === O.showSpacedText) show(a[0]);
        else if (op === O.nextLineShowText) { st.x = st.lx; st.y = st.ly -= st.lead; show(a[0]); }
        else if (op === O.nextLineSetSpacingShowText) { st.ws = a[0]; st.cs = a[1]; st.x = st.lx; st.y = st.ly -= st.lead; show(a[2]); }
      } catch (e) { /* one bad operator: skip it */ }
    }
    out.imgs = imgs;
    return out;
  }
  // On a page with an outline (Type3 letters), how wide the ink of the
  // other letters is: their font from the PDF, measured on a canvas.
  var inkFaces = {};
  function inkWidths(list, page) {
    if (!list.some(function (g) { return g.t3; }) || typeof FontFace === "undefined" || typeof document === "undefined") return null;
    var keys = {};
    list.forEach(function (g) { if (g.fk) keys[g.fk] = 1; });
    return Promise.all(Object.keys(keys).map(function (fk) {
      if (!inkFaces[fk]) {
        var o = null;
        try { o = page.commonObjs.has(fk) ? page.commonObjs.get(fk) : page.objs.get(fk); } catch (e) {}
        if (!o || !o.data) return null;
        var face = new FontFace("cfx-" + fk, o.data);
        inkFaces[fk] = face.load().then(function (ff) { document.fonts.add(ff); return true; }, function () { return false; });
      }
      return inkFaces[fk];
    })).then(function () {
      var c = document.createElement("canvas").getContext("2d");
      list.forEach(function (g) {
        if (!g.fk || !inkFaces[g.fk]) return;
        c.font = "100px \"cfx-" + g.fk + "\"";
        var m = c.measureText(g.fch);
        if (m && m.actualBoundingBoxRight != null) g.inkw = Math.max(0, (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 100 * g.size);
      });
    }).then(null, function () {});
  }
  // buf: ArrayBuffer of the PDF → Promise of [[glyph]] (one list per page)
  function glyphs(buf, maxPages) {
    var R = root.LY_PDFIN;
    if (!R) return Promise.resolve(null);
    return R.loadLib().then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = lib.GlobalWorkerOptions.workerSrc || "../vendor/pdfjs/pdf.worker.min.js";
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: false, fontExtraProperties: true }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, maxPages || 300), pages = [], chain = Promise.resolve();
        for (var k = 1; k <= n; k++) (function (k) {
          chain = chain.then(function () { return pdf.getPage(k); }).then(function (page) {
            return page.getOperatorList().then(function (ops) {
              var vp = page.getViewport({ scale: 1 }), list = pageGlyphs(lib, page, ops);
              list.w = vp.width; list.h = vp.height; list.page = page;
              pages.push(list);
              return inkWidths(list, page);
            });
          });
        })(k);
        // the PDF stays open for its pictures: close() when done
        return chain.then(function () { pages.close = function () { try { pdf.destroy(); } catch (e) {} }; return pages; });
      });
    }).then(null, function () { return null; });
  }

  // ---------- 4. Into a design ----------
  // doc: a design just built from Canva's PowerPoint; pages: glyphs()
  // of Canva's PDF of it; AX, M: Atelier's. Gives text boxes their
  // effect and curve; returns { n: boxes changed, pics: [{ it, k (page),
  // im }] Canva's effect pictures to put under them }. A page whose
  // shape differs from the PDF's is left as it is.
  function apply(doc, pages, AX, M) {
    var n = 0, pics = [];
    if (!doc || !pages || !doc.setup) return { n: 0, pics: pics };
    M.pagesInOrder(doc).forEach(function (pg, k) {
      var gl = pages[k];
      if (!gl || !(gl.w > 0) || !(gl.h > 0)) return;
      var sc = doc.setup.w / gl.w;
      if (!(sc > 0) || Math.abs(doc.setup.h / gl.h - sc) > sc * 0.02) return;
      var G = gl.map(function (g) {
        return { i: g.i, ch: g.ch, x: g.x * sc, y: g.y * sc, rot: g.rot, size: g.size * sc, adv: g.adv * sc, fill: g.fill, stroke: g.stroke, mode: g.mode, lw: g.lw * sc, a: g.a, t3: g.t3, inkw: g.inkw > 0 ? g.inkw * sc : undefined };
      });
      var I = (gl.imgs || []).map(function (im) { return { at: im.at, id: im.id, img: im.img, straight: im.straight, x: im.x * sc, y: im.y * sc, w: im.w * sc, h: im.h * sc }; });
      var its = doc.items.filter(function (it) { return it.pg === pg.id && it.ax && it.ax.k === "text" && !it.hide; }).sort(M.byZ);
      var looks = pageLooks(its.map(function (it) {
        return { tx: it.ax.tx, caps: it.ax.caps, fc: it.ax.fc || "#000000", size: it.ax.size || 48, x: it.x, y: it.y, w: it.w, h: it.h };
      }), G, I);
      looks.forEach(function (lk, i) {
        if (!lk) return;
        var it = its[i], did = 0;
        (lk.pics || []).forEach(function (im) { pics.push({ it: it, k: k, im: im }); });
        if (lk.tfx && lk.tfx.type !== "none" && !it.ax.tfx) { it.ax.tfx = lk.tfx; did = 1; }
        if (lk.arc && !it.ax.cv && !it.rot && !AX.tpOf(it) && String(it.ax.tx).indexOf("\n") < 0 && bend(it, lk.arc, AX)) did = 1;
        else if (!lk.arc && !it.ax.cv && !it.rot && !AX.tpOf(it) && snap(it, lk.main, AX)) did = 1;
        n += did;
      });
    });
    return { n: n, pics: pics };
  }
  // ---------- 5. Lines where Canva sets them (CV-F4) ----------
  function med(a) { a = a.slice().sort(function (p, q) { return p - q; }); return a.length ? a[a.length >> 1] : 0; }
  // Canva's lines of one text: its letters grouped by baseline
  function linesOf(main, size) {
    var out = [], cur = null;
    main.forEach(function (g) {
      if (!cur || Math.abs(g.y - cur.y) > size * 0.4) { cur = { y: g.y, n: 0, x0: Infinity, x1: -Infinity }; out.push(cur); }
      cur.n++; cur.x0 = Math.min(cur.x0, g.x); cur.x1 = Math.max(cur.x1, g.x + g.adv);
    });
    return out;
  }
  // Atelier's lines: letters (no spaces) and ink extent per line
  function atLines(it, AX) {
    return AX.textLayout(it).lines.map(function (ln) {
      var n = 0, x0 = Infinity, x1 = -Infinity;
      ln.runs.forEach(function (r) {
        var k = String(r.t || "").replace(/\s+/g, "").length;
        if (!k) return;
        n += k; x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w);
      });
      return { y: ln.y, n: n, x0: x0, x1: x1 };
    }).filter(function (l) { return l.n > 0; });
  }
  // The text set as Canva set it: same size (Canva shrinks text to fit
  // its box), same pitch, same line breaks (a space where Canva broke
  // becomes a line end), the first baseline and the line's side on
  // Canva's. Returns whether anything changed.
  function snap(it, main, AX) {
    var ax = it.ax, size0 = ax.size || 48, tx = String(ax.tx || "");
    if (!main || main.length < 1 || main.some(function (g) { return Math.abs(g.rot) > 0.01; })) return false;
    var cl = linesOf(main, size0);
    for (var i = 1; i < cl.length; i++) if (!(cl[i].y > cl[i - 1].y)) return false;
    var before = JSON.stringify([it.x, it.y, it.w, ax.size, ax.lh, ax.tx]);
    // size: only for a text in one size (a text of several sizes keeps
    // them, its pitch and breaks; its first line still moves)
    var sz = main.map(function (g) { return g.size; }), one = Math.max.apply(null, sz) <= Math.min.apply(null, sz) * 1.05;
    var gs = med(sz);
    if (one && gs > 0 && Math.abs(gs - size0) > size0 * 0.015) ax.size = Math.round(gs * 100) / 100;
    var size = ax.size || 48;
    // pitch: the steps from line to line, without the gaps of empty
    // lines and paragraphs
    var steps = cl.slice(1).map(function (l, k) { return l.y - cl[k].y; }), least = Math.min.apply(null, steps);
    steps = steps.filter(function (d) { return d <= least * 1.4; });
    // one step over empty lines: how many lines it spans is not known
    if (cl.length === 2 && /\n[ \t]*\n/.test(tx)) steps = [];
    if (one && steps.length) {
      var pitch = med(steps);
      var lh = Math.max(70, Math.min(300, Math.round(pitch / size * 1000) / 10));
      if (Math.abs(lh - (ax.lh || 120)) >= 0.2) ax.lh = lh;
    }
    // line breaks
    var al = atLines(it, AX), same = al.length === cl.length && al.every(function (l, k) { return l.n === cl[k].n; });
    if (!same && one) {
      var chars = Array.from(tx), ends = [], c = 0, k2 = 0;
      cl.forEach(function (l) { c += l.n; ends.push(c); });
      var cut = [], ok = true, letters = 0;
      for (var j = 0; j < chars.length && k2 < ends.length - 1; j++) {
        if (/\s/.test(chars[j])) continue;
        letters++;
        if (letters === ends[k2]) {
          var q = j + 1, ws = [];
          while (q < chars.length && /\s/.test(chars[q])) { ws.push(q); q++; }
          if (!ws.length) { ok = false; break; }                     // Canva split a word: leave it
          if (!ws.some(function (w) { return chars[w] === "\n"; })) cut.push(ws[0]);
          k2++;
        }
      }
      if (ok && cut.length && cut.every(function (w) { return chars[w] === " "; })) {
        cut.forEach(function (w) { chars[w] = "\n"; });
        ax.tx = chars.join("");
        // the longest line must fit: widen the box (about its own side)
        var nat = AX.textWidth(ax, it, true) + 0.5;
        if (nat > it.w && nat < it.w * 1.25) {
          var grow = nat - it.w;
          it.x -= ax.al === "c" ? grow / 2 : ax.al === "r" ? grow : 0;
          it.w = Math.round(nat * 100) / 100;
        }
        al = atLines(it, AX);
        if (!(al.length === cl.length && al.every(function (l, k) { return l.n === cl[k].n; }))) { ax.tx = tx; al = atLines(it, AX); }
      }
    }
    // first baseline, and the first line's side
    if (al.length) {
      var dy = cl[0].y - (it.y + al[0].y);
      if (Math.abs(dy) < size) it.y = Math.round((it.y + dy) * 100) / 100;
      // the side: the median over the lines (a line that ends in a space
      // sits a little apart in one of them), the first line alone when
      // the lines differ
      var a = ax.al || "l", pairs = al.length === cl.length ? al.map(function (l, k) { return [l, cl[k]]; }).filter(function (p) { return p[0].n === p[1].n; }) : [];
      if (!pairs.length) pairs = [[al[0], cl[0]]];
      var dx = med(pairs.map(function (p) {
        var A = p[0], C = p[1];
        return a === "c" ? (C.x0 + C.x1) / 2 - (it.x + (A.x0 + A.x1) / 2) : a === "r" ? C.x1 - (it.x + A.x1) : C.x0 - (it.x + A.x0);
      }));
      if (a !== "j" && Math.abs(dx) < size * 0.5) it.x = Math.round((it.x + dx) * 100) / 100;
    }
    it.h = Math.round(AX.textHeight(it) * 100) / 100;
    return JSON.stringify([it.x, it.y, it.w, ax.size, ax.lh, ax.tx]) !== before;
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

  var api = { letters: letters, spots: spots, pageLooks: pageLooks, classify: classify, curveFor: curveFor, pageGlyphs: pageGlyphs, glyphs: glyphs, offFor: offFor, apply: apply, snap: snap, linesOf: linesOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierCanvaFx = api;
})(typeof window !== "undefined" ? window : this);
