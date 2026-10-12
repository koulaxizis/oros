// ============================================================
// orOS Photo Lab — the view (v1.0.0)
// Draws the open document on the screen canvas: zoom and pan, the
// transparency checkerboard, every visible layer with its opacity
// and blend mode, the selection outline and the tool overlays.
//
// Composition: layers are drawn one by one into a viewport-sized
// layer buffer, which is blended into a viewport-sized document
// buffer (transparent, so blend modes see only the layers below,
// never the checkerboard), which goes over the checkerboard. The
// buffers are the size of the screen, never of the picture.
//
// Tiles are cached as small canvases (one per 256 px tile) and
// refreshed only when the engine says they changed. The same
// drawLayer() serves the screen, the export and Merge down.
//
// Coordinates: doc px → screen CSS px: sx = x * z + ox.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, FX = PL.FX;
  var TILE = T.TILE;

  var cv, ctx, docBuf, docCtx, layBuf, layCtx;
  var W = 1, H = 1, DPR = 1;
  var vw = { z: 1, ox: 0, oy: 0 };
  var docDirty = true, raf = 0, antOffset = 0, antTimer = null;
  var tileCache = {};                    // layerId → Map(key → canvas)
  var vecCache = {};                     // layerId → { sig, cv, x, y, w, h }
  var selPath = null;
  var checker = null;

  var FONTS = {
    sans: 'system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
    mono: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
    hand: '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive',
    display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif'
  };
  var FONT_IDS = ["sans", "serif", "mono", "hand", "display"];

  function canvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }

  // ---------- Tile canvases ----------
  function tileCanvas(layerId, k, tile) {
    var m = tileCache[layerId] || (tileCache[layerId] = new Map());
    var c = m.get(k);
    if (!c) {
      c = canvas(TILE, TILE);
      c.getContext("2d").putImageData(new ImageData(tile, TILE, TILE), 0, 0);
      m.set(k, c);
    }
    return c;
  }
  function dirtyTiles(layerId, keys) {
    var m = tileCache[layerId];
    if (m) {
      if (keys) keys.forEach(function (k) { m.delete(k); });
      else m.clear();
    }
    if (!keys) delete vecCache[layerId];
    docDirty = true; schedule();
  }
  function dropLayer(layerId) { delete tileCache[layerId]; delete vecCache[layerId]; }
  function resetCaches() { tileCache = {}; vecCache = {}; docDirty = true; schedule(); }

  // ---------- Text and shape layers ----------
  function textLines(spec) { return (spec.s || "").split("\n"); }
  function fontOf(spec) {
    return (spec.i ? "italic " : "") + (spec.b ? "bold " : "") + spec.z + "px " + (FONTS[spec.f] || FONTS.sans);
  }
  // → { cv, w, h } the text drawn at the layer's own scale, top-left at 0, 0.
  function renderText(spec) {
    var probe = canvas(1, 1).getContext("2d");
    probe.font = fontOf(spec);
    var lines = textLines(spec), lh = Math.round(spec.z * spec.lh / 100), w = 1;
    lines.forEach(function (l) { w = Math.max(w, Math.ceil(probe.measureText(l).width)); });
    var pad = Math.ceil(spec.z * 0.25);
    var h = Math.max(1, lh * lines.length) + pad * 2;
    w += pad * 2;
    var c = canvas(w, h), g = c.getContext("2d");
    g.font = fontOf(spec);
    g.fillStyle = spec.c;
    g.textBaseline = "middle";
    g.textAlign = spec.a === "c" ? "center" : spec.a === "r" ? "right" : "left";
    var x = spec.a === "c" ? w / 2 : spec.a === "r" ? w - pad : pad;
    lines.forEach(function (l, i) { g.fillText(l, x, pad + lh * i + lh / 2); });
    return { cv: c, w: w, h: h };
  }
  function shapePath(sh) {
    return new Path2D(FX.toSvgPath(FX.shapePath(sh.id, sh.w, sh.h, {})));
  }
  function renderShape(sh) {
    var pad = Math.ceil(sh.sw / 2) + 1;
    var c = canvas(sh.w + pad * 2, sh.h + pad * 2), g = c.getContext("2d");
    g.translate(pad, pad);
    var p = shapePath(sh);
    if (sh.f) { g.fillStyle = sh.f; g.fill(p); }
    if (sh.s && sh.sw) { g.strokeStyle = sh.s; g.lineWidth = sh.sw; g.lineJoin = "round"; g.stroke(p); }
    return { cv: c, w: c.width, h: c.height, pad: pad };
  }
  function vector(L) {
    var sig = JSON.stringify(L.k === "text" ? L.tx : L.sh);
    var v = vecCache[L.id];
    if (v && v.sig === sig) return v;
    var r = L.k === "text" ? renderText(L.tx) : renderShape(L.sh);
    v = vecCache[L.id] = { sig: sig, cv: r.cv, w: r.w, h: r.h, pad: r.pad || 0 };
    return v;
  }
  // Bounds of a layer's content in doc px, or null (empty raster).
  function layerBounds(L) {
    if (L.k === "raster") {
      var s = PL.st.surfaces[L.id], b = s && T.tileBounds(s);
      return b ? { x: b.x + L.x, y: b.y + L.y, w: b.w, h: b.h } : null;
    }
    var v = vector(L);
    return { x: L.x - v.pad, y: L.y - v.pad, w: v.w, h: v.h };
  }

  // Draws one layer's pixels (no opacity / blend) with ctx's current
  // transform in doc px. clip = { x, y, w, h } doc rect worth drawing.
  function drawLayer(g, L, clip) {
    if (L.k !== "raster") {
      var v = vector(L);
      g.drawImage(v.cv, L.x - v.pad, L.y - v.pad);
      return;
    }
    var s = PL.st.surfaces[L.id];
    if (!s) return;
    var keys = clip ? T.keysIn(clip.x - L.x, clip.y - L.y, clip.w, clip.h) : Array.from(s.tiles.keys());
    keys.forEach(function (k) {
      var t = s.tiles.get(k);
      if (!t) return;
      var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
      g.drawImage(tileCanvas(L.id, k, t), tx * TILE + L.x, ty * TILE + L.y);
    });
  }

  // Composites the document's visible layers into g (transform set by
  // the caller, doc px), clipped to `clip` doc rect. layerBuf: a
  // canvas the size of g's canvas. preview(L, g): optional override
  // to draw one layer differently (transform tool).
  function composite(g, lb, clip, preview) {
    var lg = lb.getContext("2d");
    var tf = g.getTransform();
    PL.st.doc.layers.forEach(function (L) {
      if (!L.vis || !L.op) return;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, lb.width, lb.height);
      lg.setTransform(tf);
      lg.imageSmoothingEnabled = g.imageSmoothingEnabled;
      if (!(preview && preview(L, lg))) drawLayer(lg, L, clip);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = L.op / 100;
      g.globalCompositeOperation = C.blendOp(L.bl);
      g.drawImage(lb, 0, 0);
      g.restore();
    });
  }

  // The whole picture (or a rect of it) at a scale, as a canvas.
  function flatten(rect, scale) {
    var d = PL.st.doc;
    rect = rect || { x: 0, y: 0, w: d.w, h: d.h };
    scale = scale || 1;
    var w = Math.max(1, Math.round(rect.w * scale)), h = Math.max(1, Math.round(rect.h * scale));
    var out = canvas(w, h), g = out.getContext("2d"), lb = canvas(w, h);
    g.imageSmoothingQuality = "high";
    g.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
    composite(g, lb, rect);
    lb.width = lb.height = 0;
    return out;
  }

  // ---------- Viewport ----------
  function attach(canvasEl) {
    cv = canvasEl; ctx = cv.getContext("2d");
    docBuf = canvas(1, 1); docCtx = docBuf.getContext("2d");
    layBuf = canvas(1, 1); layCtx = layBuf.getContext("2d");
    resize();
  }
  function resize() {
    if (!cv) return;
    var r = cv.parentNode.getBoundingClientRect();
    DPR = Math.min(3, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    docBuf.width = layBuf.width = cv.width; docBuf.height = layBuf.height = cv.height;
    checker = null;
    docDirty = true; schedule();
  }
  function fit() {
    var d = PL.st.doc;
    if (!d) return;
    var pad = W < 500 ? 12 : 40;
    var z = Math.min((W - pad * 2) / d.w, (H - pad * 2) / d.h, 1);
    setView(z, (W - d.w * z) / 2, (H - d.h * z) / 2);
  }
  function setView(z, ox, oy) {
    vw.z = Math.max(0.01, Math.min(32, z));
    vw.ox = ox; vw.oy = oy;
    docDirty = true; schedule();
    PL.emit("view");
  }
  function zoomAt(z, sx, sy) {
    z = Math.max(0.01, Math.min(32, z));
    var dx = (sx - vw.ox) / vw.z, dy = (sy - vw.oy) / vw.z;
    setView(z, sx - dx * z, sy - dy * z);
  }
  var STEPS = [0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  function zoomStep(dir, sx, sy) {
    var z = vw.z, next = z;
    if (dir > 0) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i] > z * 1.01) { next = STEPS[i]; break; } }
    else { for (var j = STEPS.length - 1; j >= 0; j--) if (STEPS[j] < z / 1.01) { next = STEPS[j]; break; } }
    zoomAt(next, sx == null ? W / 2 : sx, sy == null ? H / 2 : sy);
  }
  function pan(dx, dy) { setView(vw.z, vw.ox + dx, vw.oy + dy); }
  function toDoc(clientX, clientY) {
    var r = cv.getBoundingClientRect();
    return { x: (clientX - r.left - vw.ox) / vw.z, y: (clientY - r.top - vw.oy) / vw.z };
  }
  function toScreen(x, y) { return { x: x * vw.z + vw.ox, y: y * vw.z + vw.oy }; }
  function screenPoint(clientX, clientY) {
    var r = cv.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ---------- Selection outline ----------
  function selChanged() {
    selPath = null;
    var m = PL.st.sel;
    if (m) {
      selPath = new Path2D();
      PL.S.outline(m).forEach(function (s) { selPath.moveTo(s[0], s[1]); selPath.lineTo(s[2], s[3]); });
    }
    clearInterval(antTimer); antTimer = null;
    if (selPath && !reducedMotion()) {
      antTimer = setInterval(function () { antOffset = (antOffset + 1) % 8; schedule(); }, 140);
    }
    schedule();
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  // ---------- Painting the screen ----------
  function schedule() { if (!raf) raf = requestAnimationFrame(paint); }
  function invalidate() { docDirty = true; schedule(); }

  function checkerPattern() {
    if (checker) return checker;
    var c = canvas(16, 16), g = c.getContext("2d");
    var dark = document.documentElement.getAttribute("data-theme") !== "light";
    g.fillStyle = dark ? "#3a3a3a" : "#ffffff"; g.fillRect(0, 0, 16, 16);
    g.fillStyle = dark ? "#2c2c2c" : "#d9d9d9"; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    checker = ctx.createPattern(c, "repeat");
    return checker;
  }

  function visibleDocRect() {
    var d = PL.st.doc;
    var x0 = Math.max(0, Math.floor(-vw.ox / vw.z)), y0 = Math.max(0, Math.floor(-vw.oy / vw.z));
    var x1 = Math.min(d.w, Math.ceil((W - vw.ox) / vw.z)), y1 = Math.min(d.h, Math.ceil((H - vw.oy) / vw.z));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  function paint() {
    raf = 0;
    var d = PL.st.doc;
    if (!cv || !d) return;
    var dx = vw.ox * DPR, dy = vw.oy * DPR, z = vw.z * DPR;
    if (docDirty) {
      docDirty = false;
      docCtx.setTransform(1, 0, 0, 1, 0, 0);
      docCtx.clearRect(0, 0, docBuf.width, docBuf.height);
      var vis = visibleDocRect();
      if (vis.w > 0 && vis.h > 0) {
        docCtx.save();
        docCtx.setTransform(z, 0, 0, z, dx, dy);
        docCtx.beginPath(); docCtx.rect(0, 0, d.w, d.h); docCtx.clip();
        docCtx.imageSmoothingEnabled = vw.z < 2;
        docCtx.imageSmoothingQuality = "medium";
        composite(docCtx, layBuf, vis, PL.tools && PL.tools.preview);
        docCtx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // checkerboard under the picture
    ctx.save();
    ctx.beginPath(); ctx.rect(dx, dy, d.w * z, d.h * z); ctx.clip();
    ctx.fillStyle = checkerPattern();
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
    ctx.drawImage(docBuf, 0, 0);
    // picture edge
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(dx) - 0.5, Math.round(dy) - 0.5, Math.round(d.w * z) + 1, Math.round(d.h * z) + 1);
    // selection: marching ants in doc space
    if (selPath) {
      ctx.save();
      ctx.setTransform(z, 0, 0, z, dx, dy);
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeStyle = "#000"; ctx.lineDashOffset = -antOffset / z; ctx.stroke(selPath);
      ctx.strokeStyle = "#fff"; ctx.lineDashOffset = (4 - antOffset) / z; ctx.stroke(selPath);
      ctx.restore();
    }
    if (PL.tools && PL.tools.overlay) {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      PL.tools.overlay(ctx, vw);
      ctx.restore();
    }
  }

  PL.view = {
    FONTS: FONTS, FONT_IDS: FONT_IDS,
    attach: attach, resize: resize, fit: fit, setView: setView, zoomAt: zoomAt, zoomStep: zoomStep,
    pan: pan, toDoc: toDoc, toScreen: toScreen, screenPoint: screenPoint, state: function () { return vw; },
    size: function () { return { w: W, h: H }; },
    dirtyTiles: dirtyTiles, dropLayer: dropLayer, resetCaches: resetCaches, invalidate: invalidate,
    schedule: schedule, selChanged: selChanged, themeChanged: function () { checker = null; schedule(); },
    drawLayer: drawLayer, composite: composite, flatten: flatten, layerBounds: layerBounds,
    renderText: renderText, shapePath: shapePath, canvas: canvas, vector: vector
  };
})();
