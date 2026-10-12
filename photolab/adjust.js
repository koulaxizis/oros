// ============================================================
// orOS Photo Lab — adjustments (no DOM)
// Colour changes on a layer's pixels { w, h, data RGBA }, applied in
// place. The photo sliders and the 13 named looks come from the
// shared designkit/fx.js (Atelier owns it; used read-only here);
// this file adds what a pixel editor needs on top.
//
//   run(img, id, p, FX)   id: "fx" (p = fx adjustment record) |
//                         "preset" (p.id = fx filter id) | "invert" |
//                         "gray" | "threshold" (p.t) | "posterize"
//                         (p.n) | "hsl" (p.h, p.s, p.l) | "levels"
//                         (p.ib, p.iw, p.g, p.ob, p.ow)
//   masked(before, after, mask, ox, oy)  mixes by the selection:
//                         after = before where the mask is 0
//
// Alpha is never changed. UMD: module.exports in Node (tests),
// window.PhotoLab.adjust in the app.
// ============================================================
(function (root) {
  "use strict";

  var IDS = ["fx", "preset", "invert", "gray", "threshold", "posterize", "hsl", "levels"];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? clamp(v, lo, hi) : d; }

  function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  function eachRGB(img, fn) {
    var d = img.data, px = [0, 0, 0];
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      px[0] = d[i]; px[1] = d[i + 1]; px[2] = d[i + 2];
      fn(px);
      d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2];
    }
  }
  function lutRun(img, lut) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  }

  // RGB 0-255 ↔ HSL (h 0-360, s/l 0-1)
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var dd = mx - mn;
      s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / dd + 2;
      else h = (r - g) / dd + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hue2(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function fromHsl(h, s, l, out) {
    if (!s) { out[0] = out[1] = out[2] = Math.round(l * 255); return out; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = h / 360;
    out[0] = Math.round(hue2(p, q, hh + 1 / 3) * 255);
    out[1] = Math.round(hue2(p, q, hh) * 255);
    out[2] = Math.round(hue2(p, q, hh - 1 / 3) * 255);
    return out;
  }

  function levelsLut(p) {
    var ib = num(p.ib, 0, 254, 0), iw = num(p.iw, ib + 1, 255, 255), g = num(p.g, 0.1, 9.99, 1);
    var ob = num(p.ob, 0, 255, 0), ow = num(p.ow, 0, 255, 255), lut = new Uint8ClampedArray(256);
    for (var v = 0; v < 256; v++) {
      var t = clamp((v - ib) / (iw - ib), 0, 1);
      lut[v] = Math.round(ob + Math.pow(t, 1 / g) * (ow - ob));
    }
    return lut;
  }

  function run(img, id, p, FX) {
    p = p || {};
    switch (id) {
      case "fx":
        if (FX && !FX.isIdentity(p)) FX.adjustPixels(img.data, img.w, img.h, FX.normAdjust(p));
        return true;
      case "preset":
        var f = FX && FX.filterById(p.id);
        if (!f) return false;
        if (!FX.isIdentity(f.p)) FX.adjustPixels(img.data, img.w, img.h, f.p);
        return true;
      case "invert":
        eachRGB(img, function (c) { c[0] = 255 - c[0]; c[1] = 255 - c[1]; c[2] = 255 - c[2]; });
        return true;
      case "gray":
        eachRGB(img, function (c) { c[0] = c[1] = c[2] = Math.round(lum(c[0], c[1], c[2])); });
        return true;
      case "threshold":
        var t = num(p.t, 0, 255, 128);
        eachRGB(img, function (c) { c[0] = c[1] = c[2] = lum(c[0], c[1], c[2]) >= t ? 255 : 0; });
        return true;
      case "posterize":
        var n = Math.round(num(p.n, 2, 255, 4)), lut = new Uint8ClampedArray(256);
        for (var v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v / 255 * (n - 1)) * 255 / (n - 1));
        lutRun(img, lut);
        return true;
      case "hsl":
        var dh = num(p.h, -180, 180, 0), ds = num(p.s, -100, 100, 0) / 100, dl = num(p.l, -100, 100, 0) / 100;
        if (!dh && !ds && !dl) return true;
        eachRGB(img, function (c) {
          var x = toHsl(c[0], c[1], c[2]);
          var h = (x[0] + dh + 360) % 360;
          var s = ds >= 0 ? x[1] + (1 - x[1]) * ds * (x[1] > 0 ? 1 : 0) : x[1] * (1 + ds);
          var l = dl >= 0 ? x[2] + (1 - x[2]) * dl : x[2] * (1 + dl);
          fromHsl(h, clamp(s, 0, 1), clamp(l, 0, 1), c);
        });
        return true;
      case "levels":
        lutRun(img, levelsLut(p));
        return true;
    }
    return false;
  }

  // Selection mix. before/after: same-size images at canvas offset
  // (ox, oy); mask: canvas-sized selection or null (= all of it).
  function masked(before, after, mask, ox, oy) {
    if (!mask) return after;
    var w = after.w, h = after.h, a = after.data, b = before.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var cx = x + (ox || 0), cy = y + (oy || 0);
        var m = cx < 0 || cy < 0 || cx >= mask.w || cy >= mask.h ? 0 : mask.data[cy * mask.w + cx];
        if (m === 255) continue;
        var i = (y * w + x) * 4, k = m / 255;
        for (var c = 0; c < 4; c++) a[i + c] = Math.round(b[i + c] + (a[i + c] - b[i + c]) * k);
      }
    }
    return after;
  }

  // Luminance histogram (256 bins) of the opaque-ish pixels, for Levels.
  function histogram(img) {
    var hist = new Uint32Array(256), d = img.data;
    for (var i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
    return hist;
  }

  var API = { IDS: IDS, run: run, masked: masked, histogram: histogram, toHsl: toHsl, fromHsl: fromHsl, levelsLut: levelsLut };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.adjust = API; }
})(typeof window !== "undefined" ? window : this);
