// ============================================================
// orOS Atelier — inpaint.js: fill a part of a picture (v1.0.0)
// MI-GAN 512 Places2 (Picsart AI Research, MIT, vendor/migan/) runs in
// the same ONNX Runtime Web as the background tool (cutout.js), on
// this device. It is used by the Magic eraser (paint over something,
// it is gone) and the Magic grab (the subject becomes its own element
// and the hole behind it is filled), both in magic.js.
// The model takes 4 × 512 × 512 floats: [0.5 − hole, picture × (1 −
// hole)] with the picture in −1..1, and gives the picture (3 × 512 ×
// 512, −1..1). Like IOPaint, each painted area is cut out with a
// margin, scaled to fit 512, mirrored to fill the square, and only
// the painted pixels are put back (with a soft edge).
// The pure steps run in Node tests; the rest needs a browser.
// ============================================================
(function (root) {
  "use strict";

  var S = 512, MARGIN = 128, CELL = 8;
  var MODEL = { url: "../vendor/migan/migan512.onnx", v: "migan512-places2-1" };
  var APPROX_MB = 40;                           // runtime + model, the first time

  // ---------- Pure steps ----------
  // The painted areas of a mask (w × h, > 127 = hole) → boxes
  // { x0, y0, x1, y1 } (x1/y1 exclusive), one per area; areas whose
  // boxes come within 2 × MARGIN of each other are one box.
  function boxes(mask, w, h) {
    var gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL), g = new Uint8Array(gw * gh), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (mask[y * w + x] > 127) g[((y / CELL) | 0) * gw + ((x / CELL) | 0)] = 1;
    var seen = new Uint8Array(gw * gh), out = [];
    for (var i = 0; i < g.length; i++) {
      if (!g[i] || seen[i]) continue;
      var st = [i], b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      seen[i] = 1;
      while (st.length) {
        var c = st.pop(), cx = c % gw, cy = (c / gw) | 0;
        if (cx < b.x0) b.x0 = cx; if (cx > b.x1) b.x1 = cx; if (cy < b.y0) b.y0 = cy; if (cy > b.y1) b.y1 = cy;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          var n = ny * gw + nx;
          if (g[n] && !seen[n]) { seen[n] = 1; st.push(n); }
        }
      }
      out.push({ x0: b.x0 * CELL, y0: b.y0 * CELL, x1: Math.min(w, (b.x1 + 1) * CELL), y1: Math.min(h, (b.y1 + 1) * CELL) });
    }
    // merge boxes that are close (their crops would overlap)
    var merged = true;
    while (merged) {
      merged = false;
      for (var a = 0; a < out.length && !merged; a++) for (var c2 = a + 1; c2 < out.length; c2++) {
        var p = out[a], q = out[c2];
        if (p.x0 - 2 * MARGIN < q.x1 && q.x0 - 2 * MARGIN < p.x1 && p.y0 - 2 * MARGIN < q.y1 && q.y0 - 2 * MARGIN < p.y1) {
          out[a] = { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) };
          out.splice(c2, 1); merged = true; break;
        }
      }
    }
    return out;
  }
  // A box with its margin, inside the picture.
  function cropFor(b, w, h) {
    var x0 = Math.max(0, b.x0 - MARGIN), y0 = Math.max(0, b.y0 - MARGIN);
    var x1 = Math.min(w, b.x1 + MARGIN), y1 = Math.min(h, b.y1 + MARGIN);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // The size a crop takes inside the 512 square (long side 512).
  function fitIn(cw, ch) {
    var k = S / Math.max(cw, ch);
    return { w: Math.max(1, Math.min(S, Math.round(cw * k))), h: Math.max(1, Math.min(S, Math.round(ch * k))) };
  }
  // RGBA (S × S) + hole (S × S, > 127 = hole) → the model's input.
  function toInput(rgba, hole) {
    var n = S * S, out = new Float32Array(4 * n);
    for (var i = 0; i < n; i++) {
      var m = hole[i] > 127 ? 1 : 0, k = 1 - m;
      out[i] = 0.5 - m;
      out[n + i] = (rgba[i * 4] / 127.5 - 1) * k;
      out[2 * n + i] = (rgba[i * 4 + 1] / 127.5 - 1) * k;
      out[3 * n + i] = (rgba[i * 4 + 2] / 127.5 - 1) * k;
    }
    return out;
  }
  // The model's output (3 × S × S, −1..1) → RGBA (S × S, opaque).
  function fromOutput(chw) {
    var n = S * S, out = new Uint8ClampedArray(4 * n);
    for (var i = 0; i < n; i++) {
      out[i * 4] = Math.round(chw[i] * 127.5 + 127.5);
      out[i * 4 + 1] = Math.round(chw[n + i] * 127.5 + 127.5);
      out[i * 4 + 2] = Math.round(chw[2 * n + i] * 127.5 + 127.5);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  // Grow a mask by r pixels (square), so a fill covers the edge too.
  function grow(mask, w, h, r) {
    if (r < 1) return mask;
    var tmp = new Uint8ClampedArray(w * h), out = new Uint8ClampedArray(w * h), x, y, k, v;
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) {
        v = 0;
        for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) if (mask[row + k] > 127) v = 255;
        tmp[row + x] = v;
      }
    }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) {
      v = 0;
      for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) if (tmp[k * w + x]) v = 255;
      out[y * w + x] = v;
    }
    return out;
  }
  // Bounding box of what is opaque (alpha > lim) → { x, y, w, h } | null
  function opaqueBox(alpha, w, h, lim) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (alpha[y * w + x] > lim) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  var pure = { S: S, MARGIN: MARGIN, MODEL: MODEL, APPROX_MB: APPROX_MB, boxes: boxes, cropFor: cropFor, fitIn: fitIn,
    toInput: toInput, fromOutput: fromOutput, grow: grow, opaqueBox: opaqueBox };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Runtime ----------
  var CUT = root.AtelierCutout;
  var SPEC = CUT.list(CUT.FILES, CUT.FILES_VER);
  delete SPEC.model;                            // the background model is not needed here
  SPEC.migan = MODEL;
  function ready() { return CUT.readyOf(SPEC); }
  function session(onProgress, signal) { return CUT.sessionOf(SPEC, "migan", APPROX_MB, onProgress, signal); }

  function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function ctx2d(c) { return c.getContext("2d", { willReadFrequently: true }); }

  // The crop scaled into the square, the rest mirrored (a plain edge
  // would show in the fill).
  function square(src, cr, fit) {
    var c = canvas(S, S), g = ctx2d(c);
    g.drawImage(src, cr.x, cr.y, cr.w, cr.h, 0, 0, fit.w, fit.h);
    if (fit.w < S) {
      g.save(); g.translate(2 * fit.w, 0); g.scale(-1, 1);
      g.drawImage(c, 0, 0, fit.w, fit.h, 0, 0, fit.w, fit.h); g.restore();
    }
    if (fit.h < S) {
      g.save(); g.translate(0, 2 * fit.h); g.scale(1, -1);
      g.drawImage(c, 0, 0, S, fit.h, 0, 0, S, fit.h); g.restore();
    }
    return c;
  }

  // Fill the holes of a picture. src: a canvas (the picture, any size);
  // hole: Uint8 mask w × h (> 127 = fill here). → a new canvas.
  function fill(src, hole, opts) {
    opts = opts || {};
    var w = src.width, h = src.height, list = boxes(hole, w, h);
    var out = canvas(w, h), og = ctx2d(out);
    og.drawImage(src, 0, 0);
    if (!list.length) return Promise.resolve(out);
    return session(opts.onProgress, opts.signal).then(function (sess) {
      if (opts.onRun) opts.onRun();
      var holeCv = canvas(w, h), hg = ctx2d(holeCv), hd = hg.createImageData(w, h);
      for (var i = 0; i < hole.length; i++) { var v = hole[i] > 127 ? 255 : 0; hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = 255; hd.data[i * 4 + 3] = v; }
      hg.putImageData(hd, 0, 0);
      return list.reduce(function (p, b) {
        return p.then(function () {
          if (opts.signal && opts.signal.aborted) throw new Error("abort");
          return new Promise(function (r) { setTimeout(r, 20); }).then(function () {
            var cr = cropFor(b, w, h), fit = fitIn(cr.w, cr.h);
            var px = ctx2d(square(out, cr, fit)).getImageData(0, 0, S, S).data;
            var mc = canvas(S, S), mg = ctx2d(mc);
            mg.drawImage(holeCv, cr.x, cr.y, cr.w, cr.h, 0, 0, fit.w, fit.h);
            var md = mg.getImageData(0, 0, S, S).data, m = new Uint8ClampedArray(S * S);
            for (var j = 0; j < m.length; j++) m[j] = md[j * 4 + 3];
            var feeds = {};
            feeds[sess.inputNames[0]] = new root.ort.Tensor("float32", toInput(px, m), [1, 4, S, S]);
            return sess.run(feeds).then(function (res) {
              var rc = canvas(S, S), rg = ctx2d(rc), img = rg.createImageData(S, S);
              img.data.set(fromOutput(res[sess.outputNames[0]].data));
              rg.putImageData(img, 0, 0);
              // back to the crop's size, only where it was painted (soft edge)
              var piece = canvas(cr.w, cr.h), pg = ctx2d(piece);
              pg.drawImage(rc, 0, 0, fit.w, fit.h, 0, 0, cr.w, cr.h);
              pg.globalCompositeOperation = "destination-in";
              pg.filter = "blur(" + Math.max(1, Math.round(Math.max(cr.w, cr.h) / 400)) + "px)";
              pg.drawImage(holeCv, cr.x, cr.y, cr.w, cr.h, 0, 0, cr.w, cr.h);
              og.drawImage(piece, cr.x, cr.y);
            });
          });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  root.AtelierInpaint = { S: S, APPROX_MB: APPROX_MB, ready: ready, fill: fill, grow: grow, opaqueBox: opaqueBox, boxes: boxes };
})(typeof window !== "undefined" ? window : this);
