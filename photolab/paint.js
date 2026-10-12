// ============================================================
// orOS Photo Lab — painting (no DOM)
// Brush, eraser, fill bucket and gradient, drawn straight into a
// layer's tiles (photolab/tiles.js), clipped by the selection mask.
//
// Coordinates are CANVAS pixels; the layer's offset (ox, oy) maps
// them to the layer's own grid (layer = canvas - offset).
//
// A brush stroke keeps, per touched tile, the pixels as they were
// before the stroke and a coverage map. Every dab raises coverage
// (flow) and the pixel is recomposited from the ORIGINAL with
// coverage × opacity, so overlapping dabs of one stroke never go
// past the stroke's opacity (Photoshop behaviour), and the "before"
// tiles are the undo step for free.
//
//   stroke(T, surface, o) → { dab(x, y, p), lineTo(x, y, p), end() }
//     o = { color: [r,g,b], size px, hard 0-100, opacity 0-100,
//           flow 0-100, erase, mask, ox, oy, lockAlpha }
//     end() → { keys, before } (before = tiles.snapshot shape)
//   fillArea(T, surface, area, o) → { keys, before }
//     area = mask (canvas-sized) of what to fill, o = { color, opacity,
//     mask, ox, oy }
//   gradient(T, surface, w, h, o) → { keys, before }
//     o = { type: "linear"|"radial", x0, y0, x1, y1, c0: [r,g,b,a],
//           c1: [r,g,b,a], opacity, mask, ox, oy }
//
// UMD: module.exports in Node (tests), window.PhotoLab.paint in the app.
// ============================================================
(function (root) {
  "use strict";

  var TILE = 256;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  // Composites colour (straight RGB) with effective alpha e (0-1) over
  // the original pixel o at index i of t (or erases with e).
  function put(t, i, src, si, rgb, e, erase, lockAlpha) {
    var oa = src[si + 3] / 255;
    if (erase) {
      t[i] = src[si]; t[i + 1] = src[si + 1]; t[i + 2] = src[si + 2];
      t[i + 3] = Math.round(oa * (1 - e) * 255);
      return;
    }
    if (lockAlpha) {
      t[i]     = Math.round(src[si]     + (rgb[0] - src[si])     * e);
      t[i + 1] = Math.round(src[si + 1] + (rgb[1] - src[si + 1]) * e);
      t[i + 2] = Math.round(src[si + 2] + (rgb[2] - src[si + 2]) * e);
      t[i + 3] = src[si + 3];
      return;
    }
    var na = e + oa * (1 - e);
    if (na <= 0) { t[i] = t[i + 1] = t[i + 2] = t[i + 3] = 0; return; }
    var k = oa * (1 - e);
    t[i]     = Math.round((rgb[0] * e + src[si]     * k) / na);
    t[i + 1] = Math.round((rgb[1] * e + src[si + 1] * k) / na);
    t[i + 2] = Math.round((rgb[2] * e + src[si + 2] * k) / na);
    t[i + 3] = Math.round(na * 255);
  }

  // Per-tile "before" copies, taken the first time a tile is touched.
  function tracker(T, surface) {
    var before = {}, keys = [];
    return {
      tile: function (tx, ty, create) {
        var k = T.key(tx, ty);
        if (!(k in before)) {
          var cur = T.get(surface, tx, ty);
          if (!cur && !create) return null;
          before[k] = cur ? new Uint8ClampedArray(cur) : null;
          keys.push(k);
        }
        return { k: k, t: T.ensure(surface, tx, ty), src: before[k] };
      },
      orig: function (k) { return before[k]; },
      done: function () {
        T.prune(surface, keys);
        keys.forEach(function (k) { T.markDirty(surface, k); });
        return { keys: keys.slice(), before: before };
      }
    };
  }

  var EMPTY = new Uint8ClampedArray(TILE * TILE * 4);

  function stroke(T, surface, o) {
    var size = Math.max(1, Math.min(5000, o.size || 20));
    var hard = clamp01((o.hard == null ? 80 : o.hard) / 100);
    var opacity = clamp01((o.opacity == null ? 100 : o.opacity) / 100);
    var flow = clamp01((o.flow == null ? 100 : o.flow) / 100);
    var rgb = o.color || [0, 0, 0], ox = o.ox || 0, oy = o.oy || 0, mask = o.mask || null;
    var tr = tracker(T, surface), cov = {};
    var last = null, rest = 0;

    function dab(cx, cy, p) {
      var r = size * (p == null ? 1 : clamp01(p)) / 2;
      if (r < 0.5) r = 0.5;
      var inner = r * hard;
      var x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), x1 = Math.ceil(cx + r), y1 = Math.ceil(cy + r);
      if (mask) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(mask.w, x1); y1 = Math.min(mask.h, y1); }
      if (x1 <= x0 || y1 <= y0) return;
      var keys = T.keysIn(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
      keys.forEach(function (k) {
        var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
        var tl = tr.tile(tx, ty, !o.erase && !o.lockAlpha);
        if (!tl) return;
        var c = cov[k] || (cov[k] = new Float32Array(TILE * TILE));
        var src = tl.src || EMPTY, t = tl.t;
        var lx0 = tx * TILE + ox, ly0 = ty * TILE + oy;       // tile origin, canvas coords
        var ax = Math.max(x0, lx0), ay = Math.max(y0, ly0);
        var bx = Math.min(x1, lx0 + TILE), by = Math.min(y1, ly0 + TILE);
        for (var y = ay; y < by; y++) {
          var dy = y + 0.5 - cy;
          for (var x = ax; x < bx; x++) {
            var dx = x + 0.5 - cx, d = Math.sqrt(dx * dx + dy * dy);
            if (d >= r) continue;
            var a = d <= inner ? 1 : 1 - (d - inner) / (r - inner);
            a = a * a * (3 - 2 * a);                           // smooth edge
            var pi = (y - ly0) * TILE + (x - lx0);
            var cv = c[pi];
            cv = cv + (1 - cv) * a * flow;
            c[pi] = cv;
            var mk = mask ? mask.data[y * mask.w + x] / 255 : 1;
            put(t, pi * 4, src, pi * 4, rgb, cv * opacity * mk, !!o.erase, !!o.lockAlpha);
          }
        }
      });
    }

    return {
      dab: function (x, y, p) { dab(x, y, p); last = { x: x, y: y }; rest = 0; },
      lineTo: function (x, y, p) {
        if (!last) { this.dab(x, y, p); return; }
        var sp = Math.max(1, size * (p == null ? 1 : clamp01(p)) * 0.25);
        var dx = x - last.x, dy = y - last.y, len = Math.sqrt(dx * dx + dy * dy);
        var t = sp - rest;
        while (t <= len) {
          dab(last.x + dx * t / len, last.y + dy * t / len, p);
          t += sp;
        }
        rest = len - (t - sp);
        last = { x: x, y: y };
      },
      end: function () { return tr.done(); }
    };
  }

  // Walks the canvas rectangle r tile by tile (no per-pixel lookups):
  // fn(tile, src, pixelIndex, x, y) with canvas x, y.
  function eachPixel(tr, r, ox, oy, create, fn) {
    if (!r || r.w <= 0 || r.h <= 0) return;
    var tx0 = Math.floor((r.x - ox) / TILE), ty0 = Math.floor((r.y - oy) / TILE);
    var tx1 = Math.floor((r.x + r.w - 1 - ox) / TILE), ty1 = Math.floor((r.y + r.h - 1 - oy) / TILE);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var cx0 = tx * TILE + ox, cy0 = ty * TILE + oy;
        var ax = Math.max(r.x, cx0), ay = Math.max(r.y, cy0);
        var bx = Math.min(r.x + r.w, cx0 + TILE), by = Math.min(r.y + r.h, cy0 + TILE);
        var tl = null, tried = false;
        for (var y = ay; y < by; y++) {
          for (var x = ax; x < bx; x++) {
            if (!tried) { tl = tr.tile(tx, ty, create); tried = true; }
            if (!tl) break;
            var pi = ((y - cy0) * TILE + (x - cx0)) * 4;
            fn(tl.t, tl.src || EMPTY, pi, x, y);
          }
          if (tried && !tl) break;
        }
      }
    }
  }

  function boundsOf(m) {
    var x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
    for (var y = 0; y < m.h; y++) {
      for (var x = 0; x < m.w; x++) {
        if (!m.data[y * m.w + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Fills where `area` (canvas-sized mask) is set, scaled by the
  // selection mask and opacity.
  function fillArea(T, surface, area, o) {
    var rgb = o.color || [0, 0, 0], ox = o.ox || 0, oy = o.oy || 0, mask = o.mask || null;
    var opacity = clamp01((o.opacity == null ? 100 : o.opacity) / 100);
    var tr = tracker(T, surface), w = area.w;
    eachPixel(tr, boundsOf(area), ox, oy, !o.lockAlpha, function (t, src, pi, x, y) {
      var av = area.data[y * w + x];
      var mk = mask ? mask.data[y * mask.w + x] : 255;
      if (!av || !mk) return;
      put(t, pi, src, pi, rgb, (av / 255) * (mk / 255) * opacity, false, !!o.lockAlpha);
    });
    return tr.done();
  }

  // Colour at t (0-1) between c0 and c1 (straight RGBA, 0-255).
  function lerpColor(c0, c1, t) {
    return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t,
            c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t];
  }
  function gradientAt(o, x, y) {
    var dx = o.x1 - o.x0, dy = o.y1 - o.y0, L2 = dx * dx + dy * dy, t;
    if (L2 === 0) t = 1;
    else if (o.type === "radial") t = Math.sqrt(((x - o.x0) * (x - o.x0) + (y - o.y0) * (y - o.y0)) / L2);
    else t = ((x - o.x0) * dx + (y - o.y0) * dy) / L2;
    return clamp01(t);
  }

  // Gradient over the whole canvas (w × h), or the selection.
  function gradient(T, surface, w, h, o) {
    var ox = o.ox || 0, oy = o.oy || 0, mask = o.mask || null;
    var opacity = clamp01((o.opacity == null ? 100 : o.opacity) / 100);
    var c0 = o.c0 || [0, 0, 0, 255], c1 = o.c1 || [255, 255, 255, 255];
    var tr = tracker(T, surface);
    var r = mask ? boundsOf(mask) : { x: 0, y: 0, w: w, h: h };
    eachPixel(tr, r, ox, oy, true, function (t, src, pi, x, y) {
      var mk = mask ? mask.data[y * mask.w + x] : 255;
      if (!mk) return;
      var c = lerpColor(c0, c1, gradientAt(o, x + 0.5, y + 0.5));
      var e = (c[3] / 255) * (mk / 255) * opacity;
      if (e > 0) put(t, pi, src, pi, c, e, false, false);
    });
    return tr.done();
  }

  // "#rrggbb" → [r, g, b]
  function rgbOf(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  }

  var API = { stroke: stroke, fillArea: fillArea, gradient: gradient, gradientAt: gradientAt, rgbOf: rgbOf };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.paint = API; }
})(typeof window !== "undefined" ? window : this);
