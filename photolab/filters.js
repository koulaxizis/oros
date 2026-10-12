// ============================================================
// orOS Photo Lab — filters (no DOM)
// Filters that look at neighbouring pixels (blur, sharpen, noise,
// pixelate, emboss, edges, vignette). They run on { w, h, data RGBA }
// and return a new image of the same size. Blurs work on
// premultiplied colour so transparent edges never turn dark.
//
//   run(img, id, p, at) → img'   at = { x, y, cw, ch }: where img sits
//                                on the canvas and the canvas size
//                                (pixelate grid, vignette centre)
//   reach(id, p) → px   how far a pixel's result looks around it; the
//                       caller reads that much extra around the area
//
// Ids and parameters (all clamped):
//   gauss { r 0.1-250 }            motion { a -180..180, d 1-500 }
//   unsharp { amt 1-500, r 0.1-250, th 0-255 }
//   noise { amt 1-100, mono, seed } median { r 1-10 }
//   pixelate { s 2-200 }           emboss { a, h 1-10, amt 1-500 }
//   edges {}                       vignette { amt -100..100, size 0-100 }
//   lens { r 1-60 }
//
// UMD: module.exports in Node (tests), window.PhotoLab.filters in the app.
// ============================================================
(function (root) {
  "use strict";

  var IDS = ["gauss", "motion", "unsharp", "noise", "median", "pixelate", "emboss", "edges", "vignette", "lens"];
  var MAX_REACH = 300;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? clamp(v, lo, hi) : d; }
  function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  // ---------- premultiplied float copies ----------
  function premul(img) {
    var d = img.data, n = d.length, f = new Float32Array(n);
    for (var i = 0; i < n; i += 4) {
      var a = d[i + 3] / 255;
      f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3];
    }
    return f;
  }
  function unpremul(f, w, h) {
    var out = new Uint8ClampedArray(f.length);
    for (var i = 0; i < f.length; i += 4) {
      var a = f[i + 3];
      if (a <= 0.5) continue;
      var k = 255 / a;
      out[i] = f[i] * k; out[i + 1] = f[i + 1] * k; out[i + 2] = f[i + 2] * k; out[i + 3] = a;
    }
    return { w: w, h: h, data: out };
  }

  // Box blur of radius r along one axis (edges repeat), src → dst;
  // the four channels move together (one running sum each).
  function boxLine(src, dst, w, h, r, horiz) {
    if (r < 1) { dst.set(src); return; }
    var len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4, k = 1 / (r * 2 + 1);
    for (var l = 0; l < lines; l++) {
      var o = horiz ? l * w * 4 : l * 4, last = o + (len - 1) * step;
      var s0 = src[o] * (r + 1), s1 = src[o + 1] * (r + 1), s2 = src[o + 2] * (r + 1), s3 = src[o + 3] * (r + 1);
      for (var j = 1; j <= r; j++) {
        var q = o + (j < len ? j : len - 1) * step;
        s0 += src[q]; s1 += src[q + 1]; s2 += src[q + 2]; s3 += src[q + 3];
      }
      for (var i = 0, at = o; i < len; i++, at += step) {
        dst[at] = s0 * k; dst[at + 1] = s1 * k; dst[at + 2] = s2 * k; dst[at + 3] = s3 * k;
        var add = i + r + 1, sub = i - r;
        var pa = add < len ? o + add * step : last, ps = sub > 0 ? o + sub * step : o;
        s0 += src[pa] - src[ps]; s1 += src[pa + 1] - src[ps + 1]; s2 += src[pa + 2] - src[ps + 2]; s3 += src[pa + 3] - src[ps + 3];
      }
    }
  }
  // Gaussian of sigma s as three box blurs (each axis).
  function boxSizes(s) {
    var wl = Math.floor(Math.sqrt(12 * s * s / 3 + 1));
    if (wl % 2 === 0) wl--;
    var wu = wl + 2, m = Math.round((12 * s * s - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4)), out = [];
    for (var i = 0; i < 3; i++) out.push(((i < m ? wl : wu) - 1) / 2);
    return out;
  }
  function gaussF(f, w, h, s) {
    var a = f, b = new Float32Array(f.length);
    if (s < 0.3) return f;
    boxSizes(s).forEach(function (r) { boxLine(a, b, w, h, r, true); boxLine(b, a, w, h, r, false); });
    return a;
  }

  function gauss(img, p) {
    var f = gaussF(premul(img), img.w, img.h, num(p.r, 0.1, 250, 2));
    return unpremul(f, img.w, img.h);
  }

  // Motion blur: up to 32 samples along the direction (bilinear).
  function motion(img, p) {
    var w = img.w, h = img.h, f = premul(img), out = new Float32Array(f.length);
    var ang = num(p.a, -180, 180, 0) * Math.PI / 180, dist = num(p.d, 1, 500, 10);
    var n = Math.max(2, Math.min(32, Math.ceil(dist))), ux = Math.cos(ang), uy = -Math.sin(ang);
    var offs = [];
    for (var k = 0; k < n; k++) { var t = (k / (n - 1) - 0.5) * dist; offs.push([ux * t, uy * t]); }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0, a = 0;
        for (var q = 0; q < n; q++) {
          var sx = clamp(x + offs[q][0], 0, w - 1), sy = clamp(y + offs[q][1], 0, h - 1);
          var x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
          var fx = sx - x0, fy = sy - y0;
          var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
          var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += f[i00] * w00 + f[i10] * w10 + f[i01] * w01 + f[i11] * w11;
          g += f[i00 + 1] * w00 + f[i10 + 1] * w10 + f[i01 + 1] * w01 + f[i11 + 1] * w11;
          b += f[i00 + 2] * w00 + f[i10 + 2] * w10 + f[i01 + 2] * w01 + f[i11 + 2] * w11;
          a += f[i00 + 3] * w00 + f[i10 + 3] * w10 + f[i01 + 3] * w01 + f[i11 + 3] * w11;
        }
        var o = (y * w + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
      }
    }
    return unpremul(out, w, h);
  }

  // Unsharp mask: colour + amount × (colour − blurred) where the
  // difference passes the threshold. Alpha stays.
  function unsharp(img, p) {
    var bl = gauss(img, { r: num(p.r, 0.1, 250, 1) }).data, d = img.data, out = new Uint8ClampedArray(d);
    var amt = num(p.amt, 1, 500, 100) / 100, th = num(p.th, 0, 255, 0);
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      for (var c = 0; c < 3; c++) {
        var diff = d[i + c] - bl[i + c];
        if (Math.abs(diff) * 2 >= th) out[i + c] = d[i + c] + diff * amt;
      }
    }
    return { w: img.w, h: img.h, data: out };
  }

  // Random 0-1 from a canvas position and a seed (integer hash), so
  // the grain is the same in the preview and the result, and stays
  // put whatever part of the canvas is worked on.
  function hash(seed, x, y, c) {
    var t = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(c + 1, 2246822519) + Math.imul(seed, 3266489917)) | 0;
    t = Math.imul(t ^ (t >>> 15), 2246822519);
    t = Math.imul(t ^ (t >>> 13), 3266489917);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }
  function noise(img, p, at) {
    var d = img.data, out = new Uint8ClampedArray(d), amt = num(p.amt, 1, 100, 10) * 2.55, mono = !!p.mono;
    var seed = Math.round(num(p.seed, 0, 1e9, 1)), w = img.w, ax = at ? at.x : 0, ay = at ? at.y : 0;
    for (var y = 0; y < img.h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (!d[i + 3]) continue;
        if (mono) { var v = (hash(seed, x + ax, y + ay, 0) - 0.5) * 2 * amt; out[i] = d[i] + v; out[i + 1] = d[i + 1] + v; out[i + 2] = d[i + 2] + v; }
        else for (var c = 0; c < 3; c++) out[i + c] = d[i + c] + (hash(seed, x + ax, y + ay, c) - 0.5) * 2 * amt;
      }
    }
    return { w: img.w, h: img.h, data: out };
  }

  // Median of a (2r+1)² square per channel, with a running histogram
  // per row (Huang), so the cost grows with r, not r².
  function median(img, p) {
    var r = Math.round(num(p.r, 1, 10, 1)), w = img.w, h = img.h, d = img.data, out = new Uint8ClampedArray(d.length);
    var half = ((2 * r + 1) * (2 * r + 1)) >> 1, hist = new Int32Array(256);
    function px(x, y, c) { return d[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4 + c]; }
    for (var c = 0; c < 4; c++) {
      for (var y = 0; y < h; y++) {
        hist.fill(0);
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) hist[px(dx, y + dy, c)]++;
        for (var x = 0; x < w; x++) {
          var acc = 0, m = 0;
          while (m < 255 && acc + hist[m] <= half) acc += hist[m++];
          out[(y * w + x) * 4 + c] = m;
          if (x + 1 < w) for (var ey = -r; ey <= r; ey++) { hist[px(x - r, y + ey, c)]--; hist[px(x + r + 1, y + ey, c)]++; }
        }
      }
    }
    return { w: w, h: h, data: out };
  }

  // Pixelate: average squares on a grid fixed to the canvas.
  function pixelate(img, p, at) {
    var s = Math.round(num(p.s, 2, 200, 10)), w = img.w, h = img.h, f = premul(img), out = new Float32Array(f.length);
    var ax = at ? at.x : 0, ay = at ? at.y : 0;
    var gx0 = -(((ax % s) + s) % s), gy0 = -(((ay % s) + s) % s);
    for (var by = gy0; by < h; by += s) {
      for (var bx = gx0; bx < w; bx += s) {
        var x0 = Math.max(0, bx), y0 = Math.max(0, by), x1 = Math.min(w, bx + s), y1 = Math.min(h, by + s);
        var sum = [0, 0, 0, 0], n = (x1 - x0) * (y1 - y0);
        if (n <= 0) continue;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var i = (y * w + x) * 4; sum[0] += f[i]; sum[1] += f[i + 1]; sum[2] += f[i + 2]; sum[3] += f[i + 3]; }
        for (var y2 = y0; y2 < y1; y2++) for (var x2 = x0; x2 < x1; x2++) {
          var o = (y2 * w + x2) * 4;
          out[o] = sum[0] / n; out[o + 1] = sum[1] / n; out[o + 2] = sum[2] / n; out[o + 3] = sum[3] / n;
        }
      }
    }
    return unpremul(out, w, h);
  }

  function lumAt(d, w, h, x, y) {
    var i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
    return lum(d[i], d[i + 1], d[i + 2]);
  }
  // Emboss: grey relief lit from angle a.
  function emboss(img, p) {
    var w = img.w, h = img.h, d = img.data, out = new Uint8ClampedArray(d);
    var a = num(p.a, -180, 180, 135) * Math.PI / 180, ht = num(p.h, 1, 10, 3), amt = num(p.amt, 1, 500, 100) / 100;
    var dx = Math.round(Math.cos(a) * ht), dy = Math.round(-Math.sin(a) * ht);
    if (!dx && !dy) dx = 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (!d[i + 3]) continue;
        var v = 128 + (lumAt(d, w, h, x + dx, y + dy) - lumAt(d, w, h, x - dx, y - dy)) * amt;
        out[i] = out[i + 1] = out[i + 2] = v;
      }
    }
    return { w: w, h: h, data: out };
  }

  // Find edges: Sobel per channel, dark lines on white.
  function edges(img) {
    var w = img.w, h = img.h, d = img.data, out = new Uint8ClampedArray(d);
    function v(x, y, c) { return d[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4 + c]; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (!d[i + 3]) continue;
        for (var c = 0; c < 3; c++) {
          var gx = v(x + 1, y - 1, c) + 2 * v(x + 1, y, c) + v(x + 1, y + 1, c) - v(x - 1, y - 1, c) - 2 * v(x - 1, y, c) - v(x - 1, y + 1, c);
          var gy = v(x - 1, y + 1, c) + 2 * v(x, y + 1, c) + v(x + 1, y + 1, c) - v(x - 1, y - 1, c) - 2 * v(x, y - 1, c) - v(x + 1, y - 1, c);
          out[i + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy) / 2);
        }
      }
    }
    return { w: w, h: h, data: out };
  }

  // Vignette around the canvas centre: amt < 0 darkens, > 0 lightens;
  // size moves where the fall-off starts.
  function vignette(img, p, at) {
    var w = img.w, h = img.h, d = img.data, out = new Uint8ClampedArray(d);
    var amt = num(p.amt, -100, 100, -50) / 100, size = num(p.size, 0, 100, 50) / 100;
    var cw = at && at.cw || w, ch = at && at.ch || h, ax = at ? at.x : 0, ay = at ? at.y : 0;
    var start = 0.2 + size * 0.8, end = start + 0.6;
    for (var y = 0; y < h; y++) {
      var ny = ((y + ay + 0.5) / ch - 0.5) * 2;
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (!d[i + 3]) continue;
        var nx = ((x + ax + 0.5) / cw - 0.5) * 2, dd = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2 * 1.42;
        var t = clamp((dd - start) / (end - start), 0, 1);
        t = t * t * (3 - 2 * t) * Math.abs(amt);
        for (var c = 0; c < 3; c++) out[i + c] = amt < 0 ? d[i + c] * (1 - t) : d[i + c] + (255 - d[i + c]) * t;
      }
    }
    return { w: w, h: h, data: out };
  }

  // Lens blur: a flat disc of radius r (row prefix sums).
  function lens(img, p) {
    var r = Math.round(num(p.r, 1, 60, 5)), w = img.w, h = img.h, f = premul(img), out = new Float32Array(f.length);
    var pre = new Float64Array((w + 1) * 4 * h);
    for (var y = 0; y < h; y++) {
      var rb = y * (w + 1) * 4;
      for (var x = 0; x < w; x++) for (var c = 0; c < 4; c++) pre[rb + (x + 1) * 4 + c] = pre[rb + x * 4 + c] + f[(y * w + x) * 4 + c];
    }
    var span = [];
    for (var k = -r; k <= r; k++) span.push(Math.floor(Math.sqrt(r * r - k * k)));
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
        for (var j = -r; j <= r; j++) {
          var yy = clamp(y2 + j, 0, h - 1), sp = span[j + r];
          var lo = x2 - sp, hi = x2 + sp, rb2 = yy * (w + 1) * 4;
          var a0 = clamp(lo, 0, w - 1), b0 = clamp(hi, 0, w - 1);
          var cnt = b0 - a0 + 1;
          s0 += pre[rb2 + (b0 + 1) * 4] - pre[rb2 + a0 * 4];
          s1 += pre[rb2 + (b0 + 1) * 4 + 1] - pre[rb2 + a0 * 4 + 1];
          s2 += pre[rb2 + (b0 + 1) * 4 + 2] - pre[rb2 + a0 * 4 + 2];
          s3 += pre[rb2 + (b0 + 1) * 4 + 3] - pre[rb2 + a0 * 4 + 3];
          n += cnt;
        }
        var o = (y2 * w + x2) * 4;
        out[o] = s0 / n; out[o + 1] = s1 / n; out[o + 2] = s2 / n; out[o + 3] = s3 / n;
      }
    }
    return unpremul(out, w, h);
  }

  function reach(id, p) {
    p = p || {};
    var r = 0;
    switch (id) {
      case "gauss": r = Math.ceil(num(p.r, 0.1, 250, 2) * 3); break;
      case "unsharp": r = Math.ceil(num(p.r, 0.1, 250, 1) * 3); break;
      case "motion": r = Math.ceil(num(p.d, 1, 500, 10) / 2) + 1; break;
      case "median": r = Math.round(num(p.r, 1, 10, 1)); break;
      case "lens": r = Math.round(num(p.r, 1, 60, 5)); break;
      case "emboss": r = Math.ceil(num(p.h, 1, 10, 3)) + 1; break;
      case "edges": r = 1; break;
    }
    return Math.min(MAX_REACH, r);
  }

  function run(img, id, p, at) {
    p = p || {};
    switch (id) {
      case "gauss": return gauss(img, p);
      case "motion": return motion(img, p);
      case "unsharp": return unsharp(img, p);
      case "noise": return noise(img, p, at);
      case "median": return median(img, p);
      case "pixelate": return pixelate(img, p, at);
      case "emboss": return emboss(img, p);
      case "edges": return edges(img);
      case "vignette": return vignette(img, p, at);
      case "lens": return lens(img, p);
    }
    throw new Error("filter");
  }

  // Crops the middle of img: the rectangle (x, y, w, h).
  function crop(img, x, y, w, h) {
    if (!x && !y && w === img.w && h === img.h) return img;
    var out = new Uint8ClampedArray(w * h * 4);
    for (var r = 0; r < h; r++) out.set(img.data.subarray(((r + y) * img.w + x) * 4, ((r + y) * img.w + x + w) * 4), r * w * 4);
    return { w: w, h: h, data: out };
  }

  var API = { IDS: IDS, run: run, reach: reach, crop: crop, boxSizes: boxSizes };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.filters = API; }
})(typeof window !== "undefined" ? window : this);
