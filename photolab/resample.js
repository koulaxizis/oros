// ============================================================
// orOS Photo Lab — resampling and geometry (no DOM)
// Pure functions over images { w, h, data: Uint8ClampedArray RGBA,
// straight alpha }. Used for Image › Resize, rotate, flip, canvas
// size, trim, and the free transform of a layer.
//
//   resize(img, w, h)          area average when shrinking, then
//                              Catmull-Rom bicubic (alpha-weighted, so
//                              transparent pixels do not darken edges)
//   rot90(img, turns), flip(img, horiz)
//   canvasResize(img, w, h, anchor)   anchor "tl"…"c"…"br" → { img, dx, dy }
//   trimRect(img)              bounds of the non-transparent pixels
//   rotate(img, deg)           any angle, bilinear, grows the canvas
//   transform(img, m, w, h)    affine (inverse-mapped, bilinear)
//
// UMD: module.exports in Node (tests), window.PhotoLab.resample in the app.
// ============================================================
(function (root) {
  "use strict";

  function make(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }

  // Box (area) average to an integer factor fx × fy smaller.
  function boxDown(img, fx, fy) {
    var w = Math.max(1, Math.floor(img.w / fx)), h = Math.max(1, Math.floor(img.h / fy));
    var out = make(w, h), s = img.data, d = out.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0, a = 0, n = 0;
        for (var yy = y * fy; yy < Math.min(img.h, (y + 1) * fy); yy++) {
          for (var xx = x * fx; xx < Math.min(img.w, (x + 1) * fx); xx++) {
            var i = (yy * img.w + xx) * 4, al = s[i + 3];
            r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n++;
          }
        }
        var o = (y * w + x) * 4;
        if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; }
        d[o + 3] = a / n;
      }
    }
    return out;
  }

  function cubic(t) {                       // Catmull-Rom weight
    t = Math.abs(t);
    if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
    if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
    return 0;
  }

  function bicubic(img, w, h) {
    var out = make(w, h), s = img.data, d = out.data, sw = img.w, sh = img.h;
    var kx = sw / w, ky = sh / h;
    for (var y = 0; y < h; y++) {
      var sy = (y + 0.5) * ky - 0.5, iy = Math.floor(sy);
      for (var x = 0; x < w; x++) {
        var sx = (x + 0.5) * kx - 0.5, ix = Math.floor(sx);
        var r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (var m = -1; m <= 2; m++) {
          var yy = Math.min(sh - 1, Math.max(0, iy + m)), wy = cubic(sy - (iy + m));
          for (var n = -1; n <= 2; n++) {
            var xx = Math.min(sw - 1, Math.max(0, ix + n)), wt = wy * cubic(sx - (ix + n));
            var i = (yy * sw + xx) * 4, al = s[i + 3] * wt;
            r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; wsum += wt;
          }
        }
        var o = (y * w + x) * 4;
        if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; }
        d[o + 3] = a / wsum;
      }
    }
    return out;
  }

  function resize(img, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === img.w && h === img.h) return { w: w, h: h, data: new Uint8ClampedArray(img.data) };
    var src = img;
    // Shrink by the whole factor first (area average), so the bicubic
    // pass never skips source pixels.
    var fx = Math.max(1, Math.floor(img.w / w)), fy = Math.max(1, Math.floor(img.h / h));
    if (fx > 1 || fy > 1) src = boxDown(img, fx, fy);
    return bicubic(src, w, h);
  }

  // turns: 1 = 90° clockwise, 2 = 180°, 3 = 90° counter-clockwise.
  function rot90(img, turns) {
    turns = ((turns % 4) + 4) % 4;
    if (!turns) return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
    var sw = img.w, sh = img.h, out = turns === 2 ? make(sw, sh) : make(sh, sw), s = img.data, d = out.data;
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        var nx, ny;
        if (turns === 1) { nx = sh - 1 - y; ny = x; }
        else if (turns === 2) { nx = sw - 1 - x; ny = sh - 1 - y; }
        else { nx = y; ny = sw - 1 - x; }
        var i = (y * sw + x) * 4, o = (ny * out.w + nx) * 4;
        d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
      }
    }
    return out;
  }

  function flip(img, horiz) {
    var out = make(img.w, img.h), s = img.data, d = out.data, w = img.w, h = img.h;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var nx = horiz ? w - 1 - x : x, ny = horiz ? y : h - 1 - y;
        var i = (y * w + x) * 4, o = (ny * w + nx) * 4;
        d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
      }
    }
    return out;
  }

  // Where the old picture lands in a new w × h canvas.
  var ANCHORS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  function anchorOffset(ow, oh, w, h, anchor) {
    var i = ANCHORS.indexOf(anchor);
    if (i < 0) i = 4;
    var col = i % 3, row = Math.floor(i / 3);
    return { dx: col === 0 ? 0 : col === 1 ? Math.round((w - ow) / 2) : w - ow,
             dy: row === 0 ? 0 : row === 1 ? Math.round((h - oh) / 2) : h - oh };
  }
  function canvasResize(img, w, h, anchor) {
    var off = anchorOffset(img.w, img.h, w, h, anchor), out = make(w, h);
    for (var y = 0; y < img.h; y++) {
      var ny = y + off.dy;
      if (ny < 0 || ny >= h) continue;
      var x0 = Math.max(0, -off.dx), x1 = Math.min(img.w, w - off.dx);
      if (x1 <= x0) continue;
      out.data.set(img.data.subarray((y * img.w + x0) * 4, (y * img.w + x1) * 4), (ny * w + x0 + off.dx) * 4);
    }
    return { img: out, dx: off.dx, dy: off.dy };
  }

  function trimRect(img) {
    var x0 = img.w, y0 = img.h, x1 = -1, y1 = -1, d = img.data;
    for (var y = 0; y < img.h; y++) {
      for (var x = 0; x < img.w; x++) {
        if (!d[(y * img.w + x) * 4 + 3]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function crop(img, r) {
    var out = make(r.w, r.h);
    for (var y = 0; y < r.h; y++) {
      var sy = y + r.y;
      if (sy < 0 || sy >= img.h) continue;
      var x0 = Math.max(0, -r.x), x1 = Math.min(r.w, img.w - r.x);
      if (x1 <= x0) continue;
      out.data.set(img.data.subarray((sy * img.w + r.x + x0) * 4, (sy * img.w + r.x + x1) * 4), (y * r.w + x0) * 4);
    }
    return out;
  }

  // Bilinear sample at (x, y) (pixel centres at .5), alpha-weighted;
  // outside = transparent. → [r, g, b, a]
  function sample(img, x, y, out) {
    var w = img.w, h = img.h, s = img.data;
    x -= 0.5; y -= 0.5;
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var r = 0, g = 0, b = 0, a = 0;
    for (var k = 0; k < 4; k++) {
      var px = ix + (k & 1), py = iy + (k >> 1);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      var wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      var i = (py * w + px) * 4, al = s[i + 3] * wt;
      r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al;
    }
    if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else { out[0] = out[1] = out[2] = 0; }
    out[3] = a;
    return out;
  }

  // m = [a, b, c, d, e, f] maps source → destination like canvas
  // setTransform (x' = a x + c y + e, y' = b x + d y + f). The result
  // is a w × h image; each output pixel is inverse-mapped.
  function transform(img, m, w, h) {
    var det = m[0] * m[3] - m[1] * m[2];
    var out = make(w, h);
    if (!det) return out;
    var ia = m[3] / det, ib = -m[1] / det, ic = -m[2] / det, id = m[0] / det;
    var ie = -(ia * m[4] + ic * m[5]), iff = -(ib * m[4] + id * m[5]);
    var px = [0, 0, 0, 0], d = out.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var cx = x + 0.5, cy = y + 0.5;
        sample(img, ia * cx + ic * cy + ie, ib * cx + id * cy + iff, px);
        if (!px[3]) continue;
        var o = (y * w + x) * 4;
        d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
      }
    }
    return out;
  }

  // Any angle (degrees, clockwise), canvas grows to fit.
  function rotate(img, deg) {
    var q = ((deg % 360) + 360) % 360;
    if (q % 90 === 0) return rot90(img, q / 90);
    var t = q * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    var w = Math.ceil(Math.abs(img.w * c) + Math.abs(img.h * s) - 1e-9);
    var h = Math.ceil(Math.abs(img.w * s) + Math.abs(img.h * c) - 1e-9);
    // centre to centre
    var e = w / 2 - (c * img.w / 2 - s * img.h / 2), f = h / 2 - (s * img.w / 2 + c * img.h / 2);
    return transform(img, [c, s, -s, c, e, f], w, h);
  }

  var API = {
    ANCHORS: ANCHORS, resize: resize, rot90: rot90, flip: flip, anchorOffset: anchorOffset,
    canvasResize: canvasResize, trimRect: trimRect, crop: crop, sample: sample,
    transform: transform, rotate: rotate
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.resample = API; }
})(typeof window !== "undefined" ? window : this);
