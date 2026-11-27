// ============================================================
// orOS Photo Lab — upscale.js: Enlarge with AI, the pure steps
// (PL-UP, v1.0.0)
// Real-ESRGAN general x4v3 (Xintao Wang, BSD-3-Clause; ONNX written
// from the official weights in koulaxizis/oros-models-vision) makes a
// picture 4 times larger and sharper, on this device, in ONNX Runtime
// Web. This file holds everything that needs no browser:
//   factor(k)            the model run for a target factor k (1 < k ≤ 4):
//                        { m: 2 | 4, s } = shrink the input by s first
//                        (only when s < 1), run ×4, halve when m is 2
//   plan(w, h)           the tiles (TILE px, each read with PAD px more
//                        around it so the seams do not show)
//   bleed(img)           fully transparent pixels get the colour of the
//                        nearest visible one (the model sees colour only;
//                        black there would darken the edges)
//   tileInput / putTile  RGBA → the model's input (RGB 0..1, CHW) and its
//                        output (×4) → the picture (×4, or ×2 by 2 × 2
//                        averages)
//   run(img, o)          the whole picture through o.infer, tile by tile
// Alpha is never guessed by the model: it is resampled (bicubic) and
// put back. Used by upscale-worker.js (and enlarge.js when no worker
// can run it) and by the Node tests.
// UMD: module.exports in Node, PhotoLab.upscale in the app and worker.
// ============================================================
(function (root) {
  "use strict";

  var TILE = 128, PAD = 12, SCALE = 4;
  var MODEL = {
    url: "https://koulaxizis.github.io/oros-models-vision/realesrgan/realesr-general-x4v3.onnx",
    sha: "10279d50668a171356ee5e4b4cef12d11037eb338c437d900664eb79a29159d5",
    v: "realesr-general-x4v3-1"
  };

  // The run for a target factor k: m (the model's 4, halved to 2 when
  // k ≤ 2, which keeps all the input's detail) and s, the input's
  // scale before the run (1 for exactly 2 or 4).
  function factor(k) {
    k = +k;
    if (!(k > 1)) return null;
    k = Math.min(4, k);
    var m = k <= 2 ? 2 : 4;
    return { m: m, s: k / m };
  }
  // The size an input w × h becomes for a target factor k.
  function outSize(w, h, k) {
    var f = factor(k);
    if (!f) return null;
    var iw = f.s < 0.9999 ? Math.max(1, Math.round(w * f.s)) : w;
    var ih = f.s < 0.9999 ? Math.max(1, Math.round(h * f.s)) : h;
    return { w: iw * f.m, h: ih * f.m, iw: iw, ih: ih, m: f.m };
  }

  // Tiles over w × h: { x, y, w, h } (the part written) and
  // { px, py, pw, ph } (the part read, PAD more on every side inside
  // the picture).
  function plan(w, h, tile, pad) {
    tile = tile || TILE; pad = pad == null ? PAD : pad;
    var out = [];
    for (var y = 0; y < h; y += tile) {
      for (var x = 0; x < w; x += tile) {
        var tw = Math.min(tile, w - x), th = Math.min(tile, h - y);
        var px = Math.max(0, x - pad), py = Math.max(0, y - pad);
        var pw = Math.min(w, x + tw + pad) - px, ph = Math.min(h, y + th + pad) - py;
        out.push({ x: x, y: y, w: tw, h: th, px: px, py: py, pw: pw, ph: ph });
      }
    }
    return out;
  }

  // Does the picture have any pixel that is not fully opaque?
  function hasAlpha(img) {
    var d = img.data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }
  // A copy where every pixel with alpha 0 takes the colour of the
  // nearest pixel with alpha > 0 (breadth first, 4 neighbours). The
  // same picture when nothing is fully transparent or nothing shows.
  function bleed(img) {
    var w = img.w, h = img.h, s = img.data, n = w * h, i;
    var from = new Int32Array(n), queue = new Int32Array(n), head = 0, tail = 0, holes = 0;
    for (i = 0; i < n; i++) {
      if (s[i * 4 + 3] > 0) { from[i] = i; queue[tail++] = i; }
      else { from[i] = -1; holes++; }
    }
    if (!holes || !tail) return img;
    while (head < tail) {
      var p = queue[head++], x = p % w, y = (p - x) / w, src = from[p];
      if (x > 0 && from[p - 1] < 0) { from[p - 1] = src; queue[tail++] = p - 1; }
      if (x < w - 1 && from[p + 1] < 0) { from[p + 1] = src; queue[tail++] = p + 1; }
      if (y > 0 && from[p - w] < 0) { from[p - w] = src; queue[tail++] = p - w; }
      if (y < h - 1 && from[p + w] < 0) { from[p + w] = src; queue[tail++] = p + w; }
    }
    var d = new Uint8ClampedArray(s);
    for (i = 0; i < n; i++) {
      if (s[i * 4 + 3] > 0) continue;
      var j = from[i] * 4;
      d[i * 4] = s[j]; d[i * 4 + 1] = s[j + 1]; d[i * 4 + 2] = s[j + 2];
    }
    return { w: w, h: h, data: d };
  }

  // RGBA (img) → Float32Array 3 × ph × pw (RGB 0..1) of the read part.
  function tileInput(img, t) {
    var plane = t.pw * t.ph, out = new Float32Array(3 * plane), s = img.data;
    for (var y = 0; y < t.ph; y++) {
      for (var x = 0; x < t.pw; x++) {
        var i = ((t.py + y) * img.w + t.px + x) * 4, o = y * t.pw + x;
        out[o] = s[i] / 255; out[plane + o] = s[i + 1] / 255; out[2 * plane + o] = s[i + 2] / 255;
      }
    }
    return out;
  }
  // The model's output for a tile (3 × 4ph × 4pw) → the tile's part of
  // out (RGB; m = 4 copies, m = 2 averages each 2 × 2).
  function putTile(out, t, res, m) {
    var RW = t.pw * SCALE, RH = t.ph * SCALE, plane = RW * RH, d = out.data, q = SCALE / m;
    var ox = (t.x - t.px) * SCALE, oy = (t.y - t.py) * SCALE;
    for (var y = 0; y < t.h * m; y++) {
      for (var x = 0; x < t.w * m; x++) {
        var o = ((t.y * m + y) * out.w + t.x * m + x) * 4;
        for (var c = 0; c < 3; c++) {
          var sum = 0;
          for (var yy = 0; yy < q; yy++) {
            var row = c * plane + (oy + y * q + yy) * RW + ox + x * q;
            for (var xx = 0; xx < q; xx++) sum += res[row + xx];
          }
          var v = sum / (q * q);
          d[o + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        }
        d[o + 3] = 255;
      }
    }
  }

  // img { w, h, data } → Promise<img> about k times larger.
  // o = { k, infer(Float32Array, w, h) → Promise<Float32Array> (×4),
  //       R (resample.js), onTile(done, total), tile, pad }
  function run(img, o) {
    var f = factor(o.k), R = o.R;
    if (!f) return Promise.resolve(img);
    var src = img;
    if (f.s < 0.9999) src = R.resize(img, Math.max(1, Math.round(img.w * f.s)), Math.max(1, Math.round(img.h * f.s)));
    var alpha = hasAlpha(src), col = alpha ? bleed(src) : src;
    var W = src.w * f.m, H = src.h * f.m;
    var out = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
    var tiles = plan(src.w, src.h, o.tile, o.pad), i = 0;
    function next() {
      if (i >= tiles.length) return Promise.resolve();
      var t = tiles[i];
      return Promise.resolve(o.infer(tileInput(col, t), t.pw, t.ph)).then(function (res) {
        if (!res || res.length !== 3 * t.pw * SCALE * t.ph * SCALE) throw new Error("model output");
        putTile(out, t, res, f.m);
        i++;
        if (o.onTile) o.onTile(i, tiles.length);
        return next();
      });
    }
    return next().then(function () {
      if (alpha) {
        var a = R.resize(src, W, H).data, d = out.data;
        for (var j = 3; j < d.length; j += 4) d[j] = a[j];
      }
      return out;
    });
  }

  var api = { TILE: TILE, PAD: PAD, SCALE: SCALE, MODEL: MODEL, factor: factor, outSize: outSize, plan: plan,
    hasAlpha: hasAlpha, bleed: bleed, tileInput: tileInput, putTile: putTile, run: run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.upscale = api; }
})(typeof self !== "undefined" ? self : this);
