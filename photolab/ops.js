// ============================================================
// orOS Photo Lab — commands (v1.0.0)
// What the menus, the Layers panel and the shortcuts do: layer
// commands, selection commands, whole-picture commands (resize,
// canvas size, rotate, flip, trim) and adjustments. Every command
// is one undo step (PL.docChange / PL.pushPaint) and says why when
// it cannot run (R28).
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, R = PL.R;
  var st = PL.st;
  function t(k, p) { return PL.t(k, p); }
  function view() { return PL.view; }

  function needDoc() { if (!st.doc) return false; return true; }
  // allowMask: while a mask is being edited, the command works on the
  // mask (a raster stand-in, see PL.paintLayer).
  function activeOr(msgKey, allowMask) {
    var L = allowMask ? PL.paintLayer() : PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return null; }
    if (L.lock) { PL.toast(t("msg.locked")); return null; }
    if (msgKey && L.k !== "raster") { PL.toast(t(msgKey)); return null; }
    return L;
  }
  // Content of a raster layer: { img, x, y } in doc px, or null.
  function content(L) {
    var s = PL.surface(L.id), b = T.contentBounds(s);
    if (!b) return null;
    return { img: T.readRect(s, b.x, b.y, b.w, b.h), x: b.x + L.x, y: b.y + L.y };
  }
  // Reads a rect (layer grid) of L's surface; a mask reads as opaque
  // grey (its bg where nothing is painted).
  function readFor(L, x, y, w, h) {
    var img = T.readRect(PL.surface(L.id), x, y, w, h);
    if (L.mask) {
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3], v = Math.round((d[i] * a + L.bg * (255 - a)) / 255);
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return img;
  }
  // Where a command may change pixels (layer grid): the content, or
  // for a mask the whole canvas.
  function workBounds(L) {
    if (L.mask) return { x: -L.x, y: -L.y, w: st.doc.w, h: st.doc.h };
    return T.contentBounds(PL.surface(L.id));
  }
  function replacePixels(L, img, x, y) {
    var s = PL.surface(L.id);
    T.clear(s);
    T.writeRect(s, x - L.x, y - L.y, img);
  }
  function layerName(base) {
    var n = 1, names = {};
    st.doc.layers.forEach(function (L) { names[L.name] = 1; });
    while (names[base + " " + n]) n++;
    return base + " " + n;
  }
  // A vector layer drawn into pixels: { img, x, y }.
  function vectorPixels(L) {
    var v = view().vector(L);
    var g = v.cv.getContext("2d");
    var d = g.getImageData(0, 0, v.cv.width, v.cv.height);
    return { img: { w: d.width, h: d.height, data: d.data }, x: L.x - v.pad, y: L.y - v.pad };
  }

  // ---------- Layers ----------
  function newLayer() {
    if (!needDoc()) return;
    PL.addLayer({ k: "raster", name: layerName(t("layer.base")) }, t("step.newLayer"));
  }
  function duplicate() {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return; }
    var raw = JSON.parse(JSON.stringify(L));
    raw.id = C.newLayerId(); raw.name = C.cleanName(L.name + " " + t("layer.copySuffix"));
    if (L.k === "raster") { raw.surface = T.clone(PL.surface(L.id)); raw.t = {}; }
    if (L.mk) { raw.mk.id = C.newLayerId(); raw.mk.t = {}; raw.maskSurface = T.clone(PL.surface(L.mk.id)); }
    PL.addLayer(raw, t("step.duplicate"));
  }
  function remove() {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return; }
    if (st.doc.layers.length < 2) { PL.toast(t("msg.lastLayer")); return; }
    PL.docChange(t("step.deleteLayer"), function () {
      var i = C.findLayer(st.doc, L.id);
      st.doc.layers.splice(i, 1);
      st.active = st.doc.layers[Math.max(0, i - 1)].id;
    }, ownIds(L));
  }
  // The tile surfaces a layer owns (pixels, mask).
  function ownIds(L) {
    return (L.k === "raster" ? [L.id] : []).concat(L.mk ? [L.mk.id] : []);
  }
  function moveBy(dir) {
    var L = PL.layer();
    if (!L) return;
    var i = C.findLayer(st.doc, L.id), j = i + dir;
    if (j < 0 || j >= st.doc.layers.length) { PL.toast(t(dir > 0 ? "msg.top" : "msg.bottom")); return; }
    PL.docChange(t("step.order"), function () { st.doc.layers = C.moveLayer(st.doc.layers, i, j); }, []);
  }
  function setProp(L, k, v, label) {
    if (L[k] === v) return;
    PL.docChange(label, function () { L[k] = v; }, []);
  }
  function rasterize(L, silent) {
    if (L.k === "raster") return;
    if (L.k === "adj") { PL.toast(t("msg.adjNoPixels")); return; }
    var px = vectorPixels(L);
    PL.docChange(t("step.rasterize"), function () {
      L.k = "raster"; delete L.tx; delete L.sh; L.t = {}; L.x = px.x; L.y = px.y;
      var s = T.create(); st.surfaces[L.id] = s;
      T.writeRect(s, 0, 0, px.img);
    }, [L.id]);
    if (!silent) PL.toast(t("msg.rasterized"));
  }
  // Merge the active layer into the one below (keeps the lower
  // layer's opacity and blend mode, like Photoshop).
  function mergeDown() {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return; }
    var i = C.findLayer(st.doc, L.id);
    if (i < 1) { PL.toast(t("msg.nothingBelow")); return; }
    var B = st.doc.layers[i - 1];
    if (B.lock) { PL.toast(t("msg.locked")); return; }
    if (B.k === "adj") { PL.toast(t("msg.mergeAdj")); return; }
    // B's own mask and styles are baked in; L comes on top with its
    // opacity, blend, mask and styles (an adjustment changes B).
    var bb = view().fxBounds(B), bu = L.k === "adj" ? bb : view().fxBounds(L);
    var u = bu && bb ? { x: Math.min(bu.x, bb.x), y: Math.min(bu.y, bb.y),
                         w: Math.max(bu.x + bu.w, bb.x + bb.w) - Math.min(bu.x, bb.x),
                         h: Math.max(bu.y + bu.h, bb.y + bb.h) - Math.min(bu.y, bb.y) } : (bu || bb);
    var ids = ownIds(L).concat(ownIds(B));
    PL.docChange(t("step.merge"), function () {
      var s = T.create();
      if (u) {
        var solo = Object.assign({}, B, { op: 100, bl: "normal", vis: 1 });
        var c = view().flatten(u, 1, [solo, L]);
        var d = c.getContext("2d").getImageData(0, 0, u.w, u.h);
        c.width = c.height = 0;
        T.writeRect(s, 0, 0, { w: u.w, h: u.h, data: d.data });
      }
      B.k = "raster"; delete B.tx; delete B.sh; delete B.mk; delete B.fx;
      B.t = {}; B.x = u ? u.x : 0; B.y = u ? u.y : 0;
      st.surfaces[B.id] = s;
      st.doc.layers.splice(i, 1);
      st.active = B.id;
    }, ids);
  }
  function flatten() {
    if (!needDoc()) return;
    var L0 = st.doc.layers[0];
    if (st.doc.layers.length < 2 && L0.k === "raster" && !L0.mk && !L0.fx) { PL.toast(t("msg.flat")); return; }
    var d = st.doc;
    var c = view().flatten(null, 1), px = c.getContext("2d").getImageData(0, 0, d.w, d.h);
    c.width = c.height = 0;
    PL.docChange(t("step.flatten"), function () {
      var L = C.normLayer({ id: C.newLayerId(), k: "raster", name: t("layer.bg") });
      var s = T.create();
      T.writeRect(s, 0, 0, { w: d.w, h: d.h, data: px.data });
      st.doc.layers = [L];
      st.surfaces = {}; st.surfaces[L.id] = s;
      st.active = L.id;
    }, "all");
  }
  // Ctrl+J: the selection (or the whole layer) as a new layer.
  function viaCopy(cut) {
    var L = activeOr("msg.notRaster");
    if (!L) return;
    if (!st.sel) { if (cut) { PL.toast(t("msg.noSel")); return; } duplicate(); return; }
    var s = PL.surface(L.id), b = S.bounds(st.sel);
    var img = T.readRect(s, b.x - L.x, b.y - L.y, b.w, b.h);
    maskImage(img, st.sel, b.x, b.y);
    var ns = T.create();
    T.writeRect(ns, b.x, b.y, img);
    PL.docChange(t(cut ? "step.viaCut" : "step.viaCopy"), function () {
      if (cut) eraseSel(L, s);
      var NL = C.normLayer({ id: C.newLayerId(), k: "raster", name: layerName(t("layer.base")) });
      var i = C.findLayer(st.doc, L.id);
      st.doc.layers.splice(i + 1, 0, NL);
      st.surfaces[NL.id] = ns;
      st.active = NL.id;
    }, cut ? [L.id] : []);
  }
  function maskImage(img, m, x, y) {
    for (var yy = 0; yy < img.h; yy++) for (var xx = 0; xx < img.w; xx++) {
      var cx = xx + x, cy = yy + y;
      var a = cx < 0 || cy < 0 || cx >= m.w || cy >= m.h ? 0 : m.data[cy * m.w + cx];
      var i = (yy * img.w + xx) * 4 + 3;
      img.data[i] = Math.round(img.data[i] * a / 255);
    }
  }
  function eraseSel(L, s) {
    var b = S.bounds(st.sel);
    var img = T.readRect(s, b.x - L.x, b.y - L.y, b.w, b.h);
    for (var yy = 0; yy < b.h; yy++) for (var xx = 0; xx < b.w; xx++) {
      var a = st.sel.data[(yy + b.y) * st.sel.w + xx + b.x], i = (yy * b.w + xx) * 4 + 3;
      img.data[i] = Math.round(img.data[i] * (255 - a) / 255);
    }
    T.writeRect(s, b.x - L.x, b.y - L.y, img);
  }

  // ---------- Edit ----------
  function clearSel() {
    var L = activeOr("msg.notRaster", true);
    if (!L) return;
    if (!st.sel) { PL.toast(t("msg.noSel")); return; }
    PL.docChange(t("step.clear"), function () { eraseSel(L, PL.surface(L.id)); }, [L.id]);
  }
  function fillSel(color) {
    var L = activeOr("msg.notRaster", true);
    if (!L) return;
    var area = st.sel || S.all(st.doc.w, st.doc.h);
    var s = PL.surface(L.id), rgb = PL.P.rgbOf(color || st.fg);
    if (L.mask) { var v = Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]); rgb = [v, v, v]; }
    var r = PL.P.fillArea(T, s, area, { color: rgb, opacity: 100, ox: L.x, oy: L.y });
    PL.pushPaint(t("step.fill"), L, s, r);
  }
  function copy(cut) {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return; }
    if (L.k !== "raster") { PL.toast(t("msg.notRaster")); return; }
    var s = PL.surface(L.id), b = st.sel ? S.bounds(st.sel) : (function (cb) { return cb && { x: cb.x + L.x, y: cb.y + L.y, w: cb.w, h: cb.h }; })(T.contentBounds(s));
    if (!b) { PL.toast(t("msg.emptyLayer")); return; }
    var img = T.readRect(s, b.x - L.x, b.y - L.y, b.w, b.h);
    if (st.sel) maskImage(img, st.sel, b.x, b.y);
    PL.io.setClipboard(img, b.x, b.y);
    if (cut) {
      if (L.lock) { PL.toast(t("msg.locked")); return; }
      PL.docChange(t("step.cut"), function () {
        if (st.sel) eraseSel(L, s); else T.clear(s);
      }, [L.id]);
    }
  }
  // Pasted pixels become a new layer, at their old place when they
  // fit, else centred.
  function pasteImage(img, x, y, name) {
    if (!st.doc) { PL.newFromImage(img, name || t("doc.pasted")); return; }
    var d = st.doc;
    if (x == null || x + img.w <= 0 || y + img.h <= 0 || x >= d.w || y >= d.h) {
      x = Math.round((d.w - img.w) / 2); y = Math.round((d.h - img.h) / 2);
    }
    var s = T.create();
    T.writeRect(s, 0, 0, img);
    PL.addLayer({ k: "raster", name: name || layerName(t("layer.base")), x: x, y: y, surface: s }, t("step.paste"));
    PL.setTool("move");
  }

  // ---------- Select ----------
  function selectAll() { if (needDoc()) PL.setSel(S.all(st.doc.w, st.doc.h), t("step.selectAll")); }
  function deselect() { if (st.sel) PL.setSel(null, t("step.deselect")); }
  function invertSel() {
    if (!needDoc()) return;
    PL.setSel(st.sel ? S.invert(st.sel) : null, t("step.invertSel"));
    if (!st.sel) PL.toast(t("msg.noSel"));
  }
  function selectLayerPixels() {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return; }
    var d = st.doc, img = L.k === "raster" ? T.readRect(PL.surface(L.id), -L.x, -L.y, d.w, d.h) : null;
    if (!img) {
      var c = view().canvas(d.w, d.h), g = c.getContext("2d");
      view().drawLayer(g, L, null);
      var id = g.getImageData(0, 0, d.w, d.h); img = { w: d.w, h: d.h, data: id.data };
    }
    var m = S.make(d.w, d.h);
    for (var i = 0; i < m.data.length; i++) m.data[i] = img.data[i * 4 + 3];
    PL.setSel(m, t("step.select"));
    if (!st.sel) PL.toast(t("msg.emptyLayer"));
  }
  function featherSel(r) {
    if (!st.sel) { PL.toast(t("msg.noSel")); return; }
    PL.busy(true);
    PL.job("feather", { mask: st.sel, r: r }).then(function (m) { PL.busy(false); PL.setSel(m, t("step.feather")); },
      function () { PL.busy(false); PL.toast(t("msg.failed")); });
  }
  function growSel(px) {
    if (!st.sel) { PL.toast(t("msg.noSel")); return; }
    PL.busy(true);
    PL.job("grow", { mask: st.sel, px: px }).then(function (m) { PL.busy(false); PL.setSel(m, t(px > 0 ? "step.grow" : "step.shrink")); },
      function () { PL.busy(false); PL.toast(t("msg.failed")); });
  }

  // ---------- Whole picture ----------
  // Runs fn(L, content) for every raster layer with pixels, as jobs,
  // then applies all results in ONE undo step.
  function eachRaster(label, jobFor, place, vec, docFn) {
    var d = st.doc, jobs = [];
    d.layers.forEach(function (L) {
      // Pixels and mask, each in the layer's grid (a mask's stand-in
      // shares the layer's x, y).
      var own = (L.k === "raster" ? [L] : []).concat(L.mk ? [{ id: L.mk.id, x: L.x, y: L.y }] : []);
      if (L === d.layers[d.layers.length - 1]) (d.sels || []).forEach(function (v) { own.push({ id: v.id, x: v.x, y: v.y }); });
      own.forEach(function (O) {
        var c = content(O);
        if (!c) return;
        jobs.push(jobFor(c).then(function (img) { return { L: O, img: img, c: c }; }));
      });
    });
    PL.busy(true);
    return Promise.all(jobs).then(function (res) {
      PL.busy(false);
      PL.docChange(label, function () {
        res.forEach(function (r) { var p = place(r.c, r.img); replacePixels(r.L, r.img, p.x, p.y); });
        d.layers.forEach(function (L) { if (L.k !== "raster" && L.k !== "adj" && vec) vec(L); });
        docFn();
        st.sel = null; view().selChanged();
      }, "all");
      view().fit();
    }, function () { PL.busy(false); PL.toast(t("msg.failed")); });
  }
  function resizeImage(w, h) {
    var d = st.doc;
    var fit = C.fitSize(w, h, PL.limits);
    if (fit.scaled) PL.toast(t("msg.scaled", { w: fit.w, h: fit.h }));
    w = fit.w; h = fit.h;
    if (w === d.w && h === d.h) return;
    var kx = w / d.w, ky = h / d.h;
    eachRaster(t("step.resize"), function (c) {
      return PL.job("resize", { img: c.img, w: Math.max(1, Math.round(c.img.w * kx)), h: Math.max(1, Math.round(c.img.h * ky)) });
    }, function (c) { return { x: Math.round(c.x * kx), y: Math.round(c.y * ky) }; }, function (L) {
      L.x = Math.round(L.x * kx); L.y = Math.round(L.y * ky);
      if (L.k === "text") L.tx.z = Math.max(4, Math.min(2000, Math.round(L.tx.z * Math.min(kx, ky))));
      else { L.sh.w = Math.max(1, Math.round(L.sh.w * kx)); L.sh.h = Math.max(1, Math.round(L.sh.h * ky)); L.sh.sw = Math.round(L.sh.sw * Math.min(kx, ky)); }
    }, function () {
      mapGuides(function (x) { return x * kx; }, function (y) { return y * ky; });
      d.w = w; d.h = h;
    });
  }
  function canvasSize(w, h, anchor) {
    var d = st.doc;
    var fit = C.normSize(Math.round(w), Math.round(h));
    if (!fit) { PL.toast(t("msg.badSize")); return; }
    var off = R.anchorOffset(d.w, d.h, fit.w, fit.h, anchor);
    PL.docChange(t("step.canvasSize"), function () {
      d.w = fit.w; d.h = fit.h;
      d.layers.forEach(function (L) { L.x += off.dx; L.y += off.dy; });
      (d.sels || []).forEach(function (v) { v.x += off.dx; v.y += off.dy; });
      mapGuides(function (x) { return x + off.dx; }, function (y) { return y + off.dy; });
      st.sel = null; view().selChanged();
    }, []);
    view().fit();
  }
  // turns: 1 = 90° clockwise, 2 = 180°, 3 = 90° counter-clockwise.
  function rotateImage(turns) {
    var d = st.doc, W = d.w, Hh = d.h;
    function mapRect(x, y, w, h) {
      if (turns === 1) return { x: Hh - (y + h), y: x };
      if (turns === 2) return { x: W - (x + w), y: Hh - (y + h) };
      return { x: y, y: W - (x + w) };
    }
    eachRaster(t("step.rotate"), function (c) {
      return Promise.resolve(R.rot90(c.img, turns));
    }, function (c) { return mapRect(c.x, c.y, c.img.w, c.img.h); }, function (L) {
      var b = view().layerBounds(L), p = mapRect(b.x, b.y, b.w, b.h);
      var nb = turns === 2 ? { w: b.w, h: b.h } : { w: b.h, h: b.w };
      L.x += Math.round(p.x + (nb.w - b.w) / 2 - b.x); L.y += Math.round(p.y + (nb.h - b.h) / 2 - b.y);
    }, function () {
      var g = d.gd;
      if (g) {
        if (turns === 1) d.gd = C.normGuides({ x: g.y.map(function (y) { return Hh - y; }), y: g.x });
        else if (turns === 3) d.gd = C.normGuides({ x: g.y, y: g.x.map(function (x) { return W - x; }) });
        else mapGuides(function (x) { return W - x; }, function (y) { return Hh - y; });
        if (!d.gd) delete d.gd;
      }
      if (turns !== 2) { d.w = Hh; d.h = W; }
    });
  }
  function flipImage(horiz) {
    var d = st.doc;
    eachRaster(t("step.flip"), function (c) {
      return Promise.resolve(R.flip(c.img, horiz));
    }, function (c) {
      return horiz ? { x: d.w - (c.x + c.img.w), y: c.y } : { x: c.x, y: d.h - (c.y + c.img.h) };
    }, function (L) {
      var b = view().layerBounds(L);
      if (horiz) L.x += d.w - (b.x + b.w) - b.x; else L.y += d.h - (b.y + b.h) - b.y;
    }, function () {
      if (horiz) mapGuides(function (x) { return d.w - x; }, null);
      else mapGuides(null, function (y) { return d.h - y; });
    });
  }
  function rotateAny(deg) {
    var d = st.doc;
    deg = Number(deg) || 0;
    if (!deg) return;
    if (deg % 90 === 0) { rotateImage(((deg / 90) % 4 + 4) % 4); return; }
    var rad = deg * Math.PI / 180, co = Math.cos(rad), si = Math.sin(rad);
    var nw = Math.ceil(Math.abs(d.w * co) + Math.abs(d.h * si) - 1e-9), nh = Math.ceil(Math.abs(d.w * si) + Math.abs(d.h * co) - 1e-9);
    var fit = C.normSize(nw, nh);
    if (!fit) { PL.toast(t("msg.badSize")); return; }
    function mapPt(x, y) {                      // around the old centre, into the new canvas
      var dx = x - d.w / 2, dy = y - d.h / 2;
      return { x: nw / 2 + dx * co - dy * si, y: nh / 2 + dx * si + dy * co };
    }
    eachRaster(t("step.rotate"), function (c) {
      return PL.job("rotate", { img: c.img, deg: deg });
    }, function (c, img) {
      var ctr = mapPt(c.x + c.img.w / 2, c.y + c.img.h / 2);
      return { x: Math.round(ctr.x - img.w / 2), y: Math.round(ctr.y - img.h / 2) };
    }, function (L) {
      var b = view().layerBounds(L), ctr = mapPt(b.x + b.w / 2, b.y + b.h / 2);
      L.x += Math.round(ctr.x - (b.x + b.w / 2)); L.y += Math.round(ctr.y - (b.y + b.h / 2));
    }, function () { d.w = nw; d.h = nh; });
  }
  function trim() {
    var d = st.doc, c = view().flatten(null, 1);
    var px = c.getContext("2d").getImageData(0, 0, d.w, d.h);
    c.width = c.height = 0;
    var r = R.trimRect({ w: d.w, h: d.h, data: px.data });
    if (!r) { PL.toast(t("msg.emptyDoc")); return; }
    if (r.w === d.w && r.h === d.h) { PL.toast(t("msg.nothingToTrim")); return; }
    PL.cropTo(r, t("step.trim"));
    view().fit();
  }
  function cropToSel() {
    if (!st.sel) { PL.toast(t("msg.noSel")); return; }
    PL.cropTo(S.bounds(st.sel), t("step.crop"));
    view().fit();
  }
  // Layer: flip / rotate 90° in place (around its own centre).
  function layerFlip(horiz) {
    var L = activeOr("msg.notRaster");
    if (!L) return;
    var c = content(L);
    if (!c) { PL.toast(t("msg.emptyLayer")); return; }
    PL.docChange(t("step.flip"), function () { replacePixels(L, R.flip(c.img, horiz), c.x, c.y); }, [L.id]);
  }
  function layerRotate(turns) {
    var L = activeOr("msg.notRaster");
    if (!L) return;
    var c = content(L);
    if (!c) { PL.toast(t("msg.emptyLayer")); return; }
    var img = R.rot90(c.img, turns);
    PL.docChange(t("step.rotate"), function () {
      replacePixels(L, img, Math.round(c.x + (c.img.w - img.w) / 2), Math.round(c.y + (c.img.h - img.h) / 2));
    }, [L.id]);
  }

  // ---------- Adjustments ----------
  // The pixels an adjustment works on: the active raster layer's
  // content, limited to the selection's bounds.
  function adjustTarget() {
    var L = activeOr("msg.notRaster", true);
    if (!L) return null;
    var cb = workBounds(L);
    if (!cb) { PL.toast(t("msg.emptyLayer")); return null; }
    var r = { x: cb.x + L.x, y: cb.y + L.y, w: cb.w, h: cb.h };
    if (st.sel) {
      var sb = S.bounds(st.sel);
      var x0 = Math.max(r.x, sb.x), y0 = Math.max(r.y, sb.y);
      var x1 = Math.min(r.x + r.w, sb.x + sb.w), y1 = Math.min(r.y + r.h, sb.y + sb.h);
      if (x1 <= x0 || y1 <= y0) { PL.toast(t("msg.selEmptyHere")); return null; }
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { L: L, r: r, img: readFor(L, r.x - L.x, r.y - L.y, r.w, r.h) };
  }
  function copyImg(img) { return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) }; }
  // → Promise of the adjusted copy (the selection mixed in).
  function adjusted(tg, id, p) {
    return PL.job("adjust", { img: copyImg(tg.img), id: id, p: p, before: st.sel ? tg.img : null,
                              mask: st.sel, ox: tg.r.x, oy: tg.r.y });
  }
  function applyAdjust(tg, id, p, label) {
    PL.busy(true);
    return adjusted(tg, id, p).then(function (img) {
      PL.busy(false);
      PL.docChange(label, function () {
        T.writeRect(PL.surface(tg.L.id), tg.r.x - tg.L.x, tg.r.y - tg.L.y, img);
      }, [tg.L.id]);
    }, function () { PL.busy(false); PL.toast(t("msg.failed")); });
  }
  function quickAdjust(id, p, label) {
    var tg = adjustTarget();
    if (tg) applyAdjust(tg, id, p, label);
  }

  // ---------- Filters ----------
  // A filter may spread pixels (blur): without a selection the result
  // may grow past the layer's content (inside the canvas); with one,
  // it covers the selection. Pixels around the area are read too, so
  // the edges look at their real neighbours.
  function filterTarget() {
    var L = activeOr("msg.notRaster", true);
    if (!L) return null;
    var cb = workBounds(L);
    if (!cb) { PL.toast(t("msg.emptyLayer")); return null; }
    var r = { x: cb.x + L.x, y: cb.y + L.y, w: cb.w, h: cb.h };
    if (st.sel) {
      var d = st.doc, sb = S.bounds(st.sel);
      var x0 = Math.max(0, sb.x), y0 = Math.max(0, sb.y), x1 = Math.min(d.w, sb.x + sb.w), y1 = Math.min(d.h, sb.y + sb.h);
      if (x1 <= x0 || y1 <= y0) { PL.toast(t("msg.selEmptyHere")); return null; }
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { L: L, r: r };
  }
  // → Promise of { r, img }: the filtered area and where it goes.
  function filtered(tg, id, p) {
    var d = st.doc, L = tg.L, s = PL.surface(L.id), e = PL.F.reach(id, p), r = tg.r;
    if (!st.sel && e) {
      var x0 = Math.min(r.x, Math.max(0, r.x - e)), y0 = Math.min(r.y, Math.max(0, r.y - e));
      var x1 = Math.max(r.x + r.w, Math.min(d.w, r.x + r.w + e)), y1 = Math.max(r.y + r.h, Math.min(d.h, r.y + r.h + e));
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    var img = readFor(L, r.x - e - L.x, r.y - e - L.y, r.w + 2 * e, r.h + 2 * e);
    var before = st.sel ? readFor(L, r.x - L.x, r.y - L.y, r.w, r.h) : null;
    return PL.job("filter", { img: img, id: id, p: p, pad: e, at: { x: r.x - e, y: r.y - e, cw: d.w, ch: d.h },
                              before: before, mask: st.sel, ox: r.x, oy: r.y }).then(function (out) { return { r: r, img: out }; });
  }
  function applyFilter(tg, id, p, label) {
    PL.busy(true);
    return filtered(tg, id, p).then(function (res) {
      PL.busy(false);
      PL.docChange(label, function () {
        T.writeRect(PL.surface(tg.L.id), res.r.x - tg.L.x, res.r.y - tg.L.y, res.img);
      }, [tg.L.id]);
    }, function () { PL.busy(false); PL.toast(t("msg.failed")); });
  }

  // ---------- Layer masks ----------
  // A mask hides (black) or shows (white) its layer; it lives in its
  // own tile surface (L.mk.id) in the layer's grid.
  function maskable(L) {
    if (!L) { PL.toast(t("msg.noLayer")); return false; }
    if (L.lock) { PL.toast(t("msg.locked")); return false; }
    if (L.k !== "raster" && L.k !== "adj") { PL.toast(t("msg.maskKinds")); return false; }
    return true;
  }
  // fromSel: show only the selection; else show everything.
  function addMask(fromSel) {
    var L = PL.layer();
    if (!maskable(L)) return;
    if (L.mk) { PL.toast(t("msg.hasMask")); return; }
    if (fromSel && !st.sel) { PL.toast(t("msg.noSel")); return; }
    var id = C.newLayerId(), sel = fromSel ? st.sel : null;
    PL.docChange(t(fromSel ? "step.maskSel" : "step.mask"), function () {
      var s = T.create();
      if (sel) {
        var b = S.bounds(sel), img = { w: b.w, h: b.h, data: new Uint8ClampedArray(b.w * b.h * 4) };
        for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) {
          var i = (y * b.w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = sel.data[(y + b.y) * sel.w + x + b.x];
        }
        T.writeRect(s, b.x - L.x, b.y - L.y, img);
        st.sel = null; view().selChanged();
      }
      st.surfaces[id] = s;
      L.mk = { id: id, t: {}, on: 1, bg: sel ? 0 : 255 };
      st.maskEdit = true;
    }, [id]);
    PL.toast(t("msg.maskEditing"));
  }
  function withMask() {
    var L = PL.layer();
    if (!L) { PL.toast(t("msg.noLayer")); return null; }
    if (!L.mk) { PL.toast(t("msg.noMask")); return null; }
    if (L.lock) { PL.toast(t("msg.locked")); return null; }
    return L;
  }
  function deleteMask() {
    var L = withMask();
    if (!L) return;
    var id = L.mk.id;
    PL.docChange(t("step.maskDelete"), function () { delete L.mk; delete st.surfaces[id]; st.maskEdit = false; }, [id]);
  }
  // Bakes the mask into the layer's alpha.
  function applyMask() {
    var L = withMask();
    if (!L) return;
    if (L.k !== "raster") { PL.toast(t("msg.maskApplyAdj")); return; }
    var mk = L.mk, s = PL.surface(L.id), b = T.contentBounds(s);
    PL.docChange(t("step.maskApply"), function () {
      if (b) {
        var img = T.readRect(s, b.x, b.y, b.w, b.h), m = readFor({ id: mk.id, mask: 1, bg: mk.bg }, b.x, b.y, b.w, b.h);
        for (var i = 3; i < img.data.length; i += 4) img.data[i] = Math.round(img.data[i] * m.data[i - 3] / 255);
        T.writeRect(s, b.x, b.y, img);
      }
      delete L.mk; delete st.surfaces[mk.id]; st.maskEdit = false;
    }, [L.id, mk.id]);
  }
  function toggleMask() {
    var L = withMask();
    if (!L) return;
    PL.docChange(t(L.mk.on ? "step.maskOff" : "step.maskOn"), function () { L.mk.on = L.mk.on ? 0 : 1; }, []);
  }
  // on: true / false / undefined (toggle). Not an undo step.
  function editMask(on) {
    var L = PL.layer();
    if (!L || !L.mk) { PL.toast(t("msg.noMask")); return; }
    st.maskEdit = on == null ? !st.maskEdit : !!on;
    PL.emit("layers");
  }

  // ---------- Adjustment layers ----------
  function newAdjLayer(id, p) {
    if (!needDoc()) return null;
    return PL.addLayer({ k: "adj", name: t("adjk." + id), aj: { id: id, p: p || {} } }, t("step.newAdj"));
  }
  // Several adjustment layers above the active one as ONE step (a
  // Lightroom preset). list: [{ id, p }] bottom → top. → how many.
  function addAdjLayers(list, label, prefix) {
    if (!needDoc() || !list.length) return 0;
    if (st.doc.layers.length + list.length > C.MAX_LAYERS) { PL.toast(t("msg.maxLayers")); return 0; }
    var Ls = list.map(function (a) {
      var name = t("adjk." + a.id);
      return C.normLayer({ id: C.newLayerId(), vis: 1, op: 100, bl: "normal", k: "adj", name: prefix ? prefix + " · " + name : name, aj: a });
    }).filter(Boolean);
    if (!Ls.length) return 0;
    PL.docChange(label, function () {
      var i = C.findLayer(st.doc, st.active);
      var at = i < 0 ? st.doc.layers.length : i + 1;
      Array.prototype.splice.apply(st.doc.layers, [at, 0].concat(Ls));
      st.active = Ls[Ls.length - 1].id;
    }, []);
    return Ls.length;
  }
  function setAdj(L, aj) {
    var n = C.normAdj(aj);
    if (JSON.stringify(n) === JSON.stringify(L.aj)) return;
    PL.docChange(t("step.editAdj"), function () { L.aj = n; }, []);
  }

  // ---------- Layer styles ----------
  function setFx(L, fx) {
    if (L.k === "adj") { PL.toast(t("msg.fxAdj")); return; }
    var n = C.normFx(fx);
    if (JSON.stringify(n) === JSON.stringify(L.fx || null)) return;
    PL.docChange(t("step.fx"), function () { if (n) L.fx = n; else delete L.fx; }, []);
  }

  // ---------- Guides ----------
  // Moves the guides with the canvas (crop, canvas size, resize, flip).
  function mapGuides(fx, fy) {
    var g = st.doc.gd;
    if (!g) return;
    var n = C.normGuides({ x: fx ? g.x.map(fx) : g.x, y: fy ? g.y.map(fy) : g.y });
    if (n) st.doc.gd = n; else delete st.doc.gd;
  }
  function setGuides(gd, label) {
    PL.docChange(label, function () {
      var n = C.normGuides(gd);
      if (n) st.doc.gd = n; else delete st.doc.gd;
    }, []);
  }
  // axis "x": a vertical guide at x px; "y": a horizontal one.
  function newGuide(axis, v) {
    if (!needDoc()) return;
    var gd = st.doc.gd || { x: [], y: [] }, n = { x: gd.x.slice(), y: gd.y.slice() };
    n[axis].push(Math.round(v));
    if (!PL.prefs.guides) { PL.prefs.guides = true; PL.savePrefs(); }
    setGuides(n, t("step.guideAdd"));
  }
  function clearGuides() {
    if (!st.doc || !st.doc.gd) { PL.toast(t("msg.noGuides")); return; }
    setGuides(null, t("step.guideClear"));
  }

  // ---------- Saved selections ----------
  // Kept in the project as tile surfaces (white, alpha = selection),
  // so they save and sync like layers.
  function saveSelection(name) {
    if (!st.sel) { PL.toast(t("msg.noSel")); return; }
    var list = st.doc.sels || [];
    if (list.length >= C.MAX_SELS) { PL.toast(t("msg.maxSels", { n: C.MAX_SELS })); return; }
    var id = C.newLayerId(), sel = st.sel, b = S.bounds(sel);
    PL.docChange(t("step.selSave"), function () {
      var s = T.create(), img = { w: b.w, h: b.h, data: new Uint8ClampedArray(b.w * b.h * 4) };
      for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) {
        var i = (y * b.w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = sel.data[(y + b.y) * sel.w + x + b.x];
      }
      T.writeRect(s, b.x, b.y, img);
      st.surfaces[id] = s;
      st.doc.sels = (st.doc.sels || []).concat([{ id: id, name: C.cleanName(name) || t("sel.default"), t: {}, x: 0, y: 0 }]);
    }, [id]);
  }
  function savedMask(id) {
    var d = st.doc, v = (d.sels || []).filter(function (x) { return x.id === id; })[0] || { x: 0, y: 0 };
    var img = T.readRect(PL.surface(id), -v.x, -v.y, d.w, d.h), m = S.make(d.w, d.h);
    for (var i = 0; i < m.data.length; i++) m.data[i] = img.data[i * 4 + 3];
    return m;
  }
  // mode: "replace" | "add" | "sub" | "and"
  function loadSelection(id, mode) {
    var v = (st.doc.sels || []).filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var m = savedMask(id);
    PL.setSel(S.combine(st.sel, m, mode || "replace"), t("step.selLoad"));
  }
  function deleteSavedSelection(id) {
    PL.docChange(t("step.selDelete"), function () {
      st.doc.sels = (st.doc.sels || []).filter(function (x) { return x.id !== id; });
      if (!st.doc.sels.length) delete st.doc.sels;
      delete st.surfaces[id];
    }, [id]);
  }

  PL.ops = {
    newLayer: newLayer, duplicate: duplicate, remove: remove, moveBy: moveBy, setProp: setProp,
    rasterize: rasterize, mergeDown: mergeDown, flatten: flatten, viaCopy: viaCopy,
    clearSel: clearSel, fillSel: fillSel, copy: copy, pasteImage: pasteImage,
    selectAll: selectAll, deselect: deselect, invertSel: invertSel, selectLayerPixels: selectLayerPixels,
    featherSel: featherSel, growSel: growSel,
    resizeImage: resizeImage, canvasSize: canvasSize, rotateImage: rotateImage, flipImage: flipImage,
    rotateAny: rotateAny, trim: trim, cropToSel: cropToSel, layerFlip: layerFlip, layerRotate: layerRotate,
    adjustTarget: adjustTarget, adjusted: adjusted,
    filterTarget: filterTarget, filtered: filtered, applyFilter: applyFilter, applyAdjust: applyAdjust, quickAdjust: quickAdjust,
    layerName: layerName, vectorPixels: vectorPixels,
    addMask: addMask, deleteMask: deleteMask, applyMask: applyMask, toggleMask: toggleMask, editMask: editMask,
    newGuide: newGuide, mapGuides: mapGuides, clearGuides: clearGuides, setGuides: setGuides,
    saveSelection: saveSelection, loadSelection: loadSelection, deleteSavedSelection: deleteSavedSelection, savedMask: savedMask,
    newAdjLayer: newAdjLayer, addAdjLayers: addAdjLayers, setAdj: setAdj, setFx: setFx, maskable: maskable
  };
})();
