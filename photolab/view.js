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
// Per layer (composite): its pixels → its mask (destination-in) →
// its styles (fx: shadow and outer glow under it, stroke around it,
// colour overlay and inner glow on it) → blended into the picture.
// An adjustment layer instead reads the picture below it, changes
// the colours and mixes the result back by opacity × mask.
//
// Coordinates: doc px → screen CSS px: sx = x * z + ox.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, FX = PL.FX, A = PL.A;
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
  // Styles (fx) are not included; see fxBounds.
  function layerBounds(L) {
    if (L.k === "adj") return { x: 0, y: 0, w: PL.st.doc.w, h: PL.st.doc.h };
    if (L.k === "raster") {
      var s = PL.st.surfaces[L.id], b = s && T.tileBounds(s);
      return b ? { x: b.x + L.x, y: b.y + L.y, w: b.w, h: b.h } : null;
    }
    var v = vector(L);
    return { x: L.x - v.pad, y: L.y - v.pad, w: v.w, h: v.h };
  }
  function fxBounds(L) {
    var b = layerBounds(L), p = C.fxPad(L.fx);
    return b && p ? { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 } : b;
  }

  // Draws one layer's pixels (no opacity / blend) with ctx's current
  // transform in doc px. clip = { x, y, w, h } doc rect worth drawing.
  function drawLayer(g, L, clip) {
    if (L.k === "adj") return;
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

  // ---------- Buffers ----------
  // Scratch canvases the size of the layer buffer, made on demand
  // (only documents with masks, styles or adjustments need them).
  var pool = [];
  function buf(i, w, h) {
    var c = pool[i] || (pool[i] = canvas(w, h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    else { var g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); }
    return c;
  }
  function freePool() { pool.forEach(function (c) { c.width = c.height = 0; }); pool = []; }

  // ---------- Layer masks ----------
  var solid = null;                     // a tile of mask value 255
  function solidTile() {
    if (solid) return solid;
    solid = canvas(TILE, TILE);
    var g = solid.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, TILE, TILE);
    return solid;
  }
  // Draws L's mask as alpha (with g's transform, doc px) over clip.
  function drawMask(g, L, clip) {
    var mk = L.mk, s = PL.st.surfaces[mk.id];
    var m = tileCache[mk.id] || (tileCache[mk.id] = new Map());
    T.keysIn(Math.floor(clip.x - L.x), Math.floor(clip.y - L.y), Math.ceil(clip.w) + 1, Math.ceil(clip.h) + 1).forEach(function (k) {
      var t = s && s.tiles.get(k), c;
      if (!t) {
        if (!mk.bg) return;
        c = solidTile();
      } else {
        c = m.get(k);
        if (!c) {
          c = canvas(TILE, TILE);
          c.getContext("2d").putImageData(new ImageData(T.maskAlpha(t, mk.bg), TILE, TILE), 0, 0);
          m.set(k, c);
        }
      }
      var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
      g.drawImage(c, tx * TILE + L.x, ty * TILE + L.y);
    });
  }
  function maskBuffer(lb, L, clip, tf, smooth) {
    var mb = buf(1, lb.width, lb.height), mg = mb.getContext("2d");
    mg.setTransform(tf);
    mg.imageSmoothingEnabled = smooth;
    drawMask(mg, L, clip);
    return mb;
  }

  // ---------- Layer styles ----------
  function rgba(hex, a) {
    var v = parseInt(String(hex).slice(1), 16) || 0;
    return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
  }
  // Draws only the (blurred, offset, coloured) shadow of src's box:
  // the source itself is pushed out of the canvas.
  function shadowOf(g, src, box, dx, dy, blur, color) {
    var B = src.width + 64 + Math.ceil(Math.abs(dx));
    g.save();
    g.shadowColor = color; g.shadowBlur = blur;
    g.shadowOffsetX = B + dx; g.shadowOffsetY = dy;
    g.drawImage(src, box.x, box.y, box.w, box.h, box.x - B, box.y, box.w, box.h);
    g.restore();
  }
  function grow(box, n, w, h) {
    var x0 = Math.max(0, Math.floor(box.x - n)), y0 = Math.max(0, Math.floor(box.y - n));
    var x1 = Math.min(w, Math.ceil(box.x + box.w + n)), y1 = Math.min(h, Math.ceil(box.y + box.h + n));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  // lb: the layer's (masked) pixels, identity transform, device px;
  // z: device px per doc px; box: the device rect the styled layer
  // can cover (work stays inside it). → a canvas with the styled layer.
  function applyFx(lb, fx, z, box) {
    var w = lb.width, h = lb.height, lg = lb.getContext("2d");
    lg.setTransform(1, 0, 0, 1, 0, 0);
    if (fx.co) {
      lg.save();
      lg.globalCompositeOperation = "source-atop";
      lg.globalAlpha = fx.co.op / 100; lg.fillStyle = fx.co.c;
      lg.fillRect(box.x, box.y, box.w, box.h);
      lg.restore();
    }
    if (fx.ig) {
      var blur = Math.max(1, fx.ig.s * z), ibox = grow(box, blur * 2, w, h);
      var ib = buf(2, w, h), ig = ib.getContext("2d");    // everything but the layer
      ig.fillStyle = "#000"; ig.fillRect(ibox.x, ibox.y, ibox.w, ibox.h);
      ig.globalCompositeOperation = "destination-out"; ig.drawImage(lb, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
      ig.globalCompositeOperation = "source-over";
      lg.save();
      lg.globalCompositeOperation = "source-atop";
      shadowOf(lg, ib, ibox, 0, 0, blur, rgba(fx.ig.c, fx.ig.op / 100));
      lg.restore();
    }
    var rb = buf(3, w, h), rg = rb.getContext("2d");
    if (fx.sh) {
      var ang = fx.sh.a * Math.PI / 180;                 // light angle: shadow falls away
      shadowOf(rg, lb, box, -Math.cos(ang) * fx.sh.d * z, Math.sin(ang) * fx.sh.d * z, fx.sh.s * z, rgba(fx.sh.c, fx.sh.op / 100));
    }
    if (fx.gl) shadowOf(rg, lb, box, 0, 0, Math.max(1, fx.gl.s * z), rgba(fx.gl.c, fx.gl.op / 100));
    if (fx.st) {
      var sb = buf(2, w, h), sg = sb.getContext("2d"), r = fx.st.w * z;
      // Dilate: the layer drawn around rings of radius r, 2r/3, r/3
      // (fewer for thin strokes).
      var rings = r <= 1.5 ? 1 : r <= 4 ? 2 : 3;
      for (var q = rings; q >= 1; q--) {
        var rr = r * q / rings, n = Math.min(32, Math.max(8, Math.ceil(rr * 2)));
        for (var j = 0; j < n; j++) {
          var a = j / n * Math.PI * 2;
          sg.drawImage(lb, box.x, box.y, box.w, box.h, box.x + Math.cos(a) * rr, box.y + Math.sin(a) * rr, box.w, box.h);
        }
      }
      sg.globalCompositeOperation = "source-in";
      sg.fillStyle = fx.st.c; sg.fillRect(box.x, box.y, box.w, box.h);
      sg.globalCompositeOperation = "source-over";
      rg.globalAlpha = fx.st.op / 100; rg.drawImage(sb, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); rg.globalAlpha = 1;
    }
    rg.drawImage(lb, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    return rb;
  }

  // A doc rect → device px (axis-aligned transform), clipped to w×h.
  function devRect(b, tf, w, h) {
    var x0 = Math.max(0, Math.floor(tf.a * b.x + tf.e)), y0 = Math.max(0, Math.floor(tf.d * b.y + tf.f));
    var x1 = Math.min(w, Math.ceil(tf.a * (b.x + b.w) + tf.e)), y1 = Math.min(h, Math.ceil(tf.d * (b.y + b.h) + tf.f));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ---------- Adjustment layers ----------
  // Changes what g already holds (the layers below) inside clip.
  function adjustBelow(g, lb, L, clip, tf, smooth) {
    var W0 = g.canvas.width, H0 = g.canvas.height;
    var x0 = Math.max(0, Math.floor(tf.a * clip.x + tf.e)), y0 = Math.max(0, Math.floor(tf.d * clip.y + tf.f));
    var x1 = Math.min(W0, Math.ceil(tf.a * (clip.x + clip.w) + tf.e)), y1 = Math.min(H0, Math.ceil(tf.d * (clip.y + clip.h) + tf.f));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    var before = g.getImageData(x0, y0, w, h), b = before.data;
    var img = { w: w, h: h, data: new Uint8ClampedArray(b) };
    A.run(img, L.aj.id, L.aj.p, FX);
    var a = img.data, k0 = L.op / 100;
    var m = L.mk && L.mk.on ? maskBuffer(lb, L, clip, tf, smooth).getContext("2d").getImageData(x0, y0, w, h).data : null;
    for (var i = 0; i < b.length; i += 4) {
      if (!b[i + 3]) continue;
      var k = m ? k0 * m[i + 3] / 255 : k0;
      if (k >= 1) { b[i] = a[i]; b[i + 1] = a[i + 1]; b[i + 2] = a[i + 2]; continue; }
      if (k <= 0) continue;
      b[i] += (a[i] - b[i]) * k; b[i + 1] += (a[i + 1] - b[i + 1]) * k; b[i + 2] += (a[i + 2] - b[i + 2]) * k;
    }
    g.putImageData(before, x0, y0);
  }

  // Composites the document's visible layers (or `layers`) into g
  // (transform set by the caller: an axis-aligned scale + offset, doc
  // px), clipped to `clip` doc rect. lb: a canvas the size of g's
  // canvas. preview(L, g): optional override to draw one layer
  // differently (transform tool).
  function composite(g, lb, clip, preview, layers) {
    var lg = lb.getContext("2d");
    var tf = g.getTransform(), z = Math.hypot(tf.a, tf.b), smooth = g.imageSmoothingEnabled;
    clip = clip || { x: 0, y: 0, w: PL.st.doc.w, h: PL.st.doc.h };
    (layers || PL.st.doc.layers).forEach(function (L) {
      if (!L.vis || !L.op) return;
      if (L.k === "adj") { adjustBelow(g, lb, L, clip, tf, smooth); return; }
      var pad = C.fxPad(L.fx), cl = pad ? { x: clip.x - pad, y: clip.y - pad, w: clip.w + pad * 2, h: clip.h + pad * 2 } : clip;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, lb.width, lb.height);
      lg.setTransform(tf);
      lg.imageSmoothingEnabled = smooth;
      var moved = !!(preview && preview(L, lg));
      if (!moved) drawLayer(lg, L, cl);
      var src = lb;
      if (L.mk && L.mk.on) {
        var mb = maskBuffer(lb, L, cl, tf, smooth);
        lg.save();
        lg.setTransform(1, 0, 0, 1, 0, 0);
        lg.globalCompositeOperation = "destination-in";
        lg.drawImage(mb, 0, 0);
        lg.restore();
      }
      if (L.fx) {
        // Device rect the styles can reach (all of it while a tool
        // previews the layer elsewhere).
        var fb = moved ? null : fxBounds(L), box = fb && devRect(fb, tf, lb.width, lb.height);
        if (moved) box = { x: 0, y: 0, w: lb.width, h: lb.height };
        if (box) src = applyFx(lb, L.fx, z, box);
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = L.op / 100;
      g.globalCompositeOperation = C.blendOp(L.bl);
      g.drawImage(src, 0, 0);
      g.restore();
    });
  }

  // The whole picture (or a rect of it) at a scale, as a canvas.
  // layers: optional list to composite instead of the document's.
  function flatten(rect, scale, layers) {
    var d = PL.st.doc;
    rect = rect || { x: 0, y: 0, w: d.w, h: d.h };
    scale = scale || 1;
    var w = Math.max(1, Math.round(rect.w * scale)), h = Math.max(1, Math.round(rect.h * scale));
    var out = canvas(w, h), g = out.getContext("2d"), lb = canvas(w, h);
    g.imageSmoothingQuality = "high";
    g.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
    composite(g, lb, rect, null, layers);
    lb.width = lb.height = 0;
    freePool();
    return out;
  }

  // One layer as the export sees it (doc size, 1:1): its pixels with
  // mask and styles baked in, at full opacity, normal blend. An
  // adjustment layer becomes the picture below it, adjusted, with its
  // mask as alpha (so it looks the same over the layers below).
  function renderLayer(L) {
    var d = PL.st.doc, i = C.findLayer(d, L.id);
    var solo = Object.assign({}, L, { op: 100, bl: "normal", vis: 1 });
    if (L.k !== "adj") return flatten(null, 1, [solo]);
    var below = d.layers.slice(0, i), c = flatten(null, 1, below);
    var g = c.getContext("2d");
    var lb = canvas(d.w, d.h);
    adjustBelow(g, lb, Object.assign({}, solo, { mk: null }), { x: 0, y: 0, w: d.w, h: d.h }, new DOMMatrix(), true);
    if (L.mk && L.mk.on) {
      var mb = maskBuffer(lb, L, { x: 0, y: 0, w: d.w, h: d.h }, new DOMMatrix(), true);
      g.globalCompositeOperation = "destination-in"; g.drawImage(mb, 0, 0);
      g.globalCompositeOperation = "source-over";
    }
    lb.width = lb.height = 0;
    freePool();
    return c;
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
    fxBounds: fxBounds, renderLayer: renderLayer, drawMask: drawMask,
    renderText: renderText, shapePath: shapePath, canvas: canvas, vector: vector
  };
})();
