// ============================================================
// orOS Layout — bleedfill.js: pixels for the bleed of a picture that
// stops at the trim (LY-PRO W1, item 13). Pure: works on RGBA arrays
// ({ w, h, data: Uint8ClampedArray }), so Node tests run it; Layout
// (assist.js) reads the picture into a canvas, calls extend() and
// stores the result as a new asset. The original is never changed.
//   extend(src, need { l, t, r, b } px, mode, seed) → { w, h, data }
//   mode mirror  the edge reflected outwards
//        stretch the last row / column of pixels repeated
//        smart   texture carried on from the edge band: patches taken
//                a little inside the picture, at random places along
//                the edge, blended with feathered seams and faded in
//                from the mirror near the trim, so paper, wood or
//                cloth go on without a visible mirror line or repeated
//                shapes. Corners take the same patches in both axes.
// Exposes window.LayoutBleedFill (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  function rng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function clampI(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  // mirror index into [0, n): -1 → 0, -2 → 1 … (edge pixel kept once)
  function mir(i, n) {
    if (n === 1) return 0;
    var p = 2 * n;
    i = ((i % p) + p) % p;
    return i < n ? i : p - 1 - i;
  }

  // The source coordinate of an outside pixel (ox, oy in source space,
  // may be < 0 or ≥ w/h) for mirror and stretch.
  function srcOf(mode, ox, oy, w, h) {
    if (mode === "stretch") return [clampI(ox, 0, w - 1), clampI(oy, 0, h - 1)];
    return [ox < 0 ? mir(-ox - 1, w) : ox >= w ? mir(2 * w - ox - 1, w) : ox, oy < 0 ? mir(-oy - 1, h) : oy >= h ? mir(2 * h - oy - 1, h) : oy];
  }

  // Smart: for each side, the band is cut into tiles along the edge;
  // each tile copies a patch from inside the picture (mirrored so its
  // inner end meets the edge), its place along the edge shifted at
  // random. Neighbour tiles overlap and cross-fade; the first rows
  // next to the trim fade from the plain mirror into the patch.
  function smartPicker(w, h, need, seed) {
    var R = rng(seed), plans = {};
    ["l", "r", "t", "b"].forEach(function (sd) {
      var depth = need[sd];
      if (!depth) return;
      var along = sd === "l" || sd === "r" ? h : w, across = sd === "l" || sd === "r" ? w : h;
      var tile = Math.max(16, Math.min(along, depth * 6));
      var n = Math.ceil(along / tile) + 1, shifts = [], deep = [];
      var maxShift = Math.max(1, Math.min(along / 3, tile * 2));
      var inner = Math.max(0, Math.min(across - depth - 1, Math.round(depth * 1.5)));
      for (var i = 0; i < n; i++) {
        shifts.push(Math.round((R() * 2 - 1) * maxShift));
        deep.push(Math.round(R() * inner));   // how far inside the patch starts
      }
      plans[sd] = { tile: tile, shifts: shifts, deep: deep, along: along, across: across, depth: depth };
    });
    return plans;
  }
  // The source of an outside pixel at distance d (1-based) from side
  // sd, at position a along that side, from tile k.
  function patchSrc(pl, sd, a, d, k) {
    var along = pl.along, across = pl.across;
    var sa = clampI(a + pl.shifts[k], 0, along - 1);
    var inner = pl.deep[k] + d - 1;                 // mirrored: d = 1 takes the pixel next to the edge (+ deep)
    inner = clampI(inner, 0, across - 1);
    if (sd === "l") return [inner, sa];
    if (sd === "r") return [across - 1 - inner, sa];
    if (sd === "t") return [sa, inner];
    return [sa, across - 1 - inner];
  }
  function smartPixel(plans, sd, a, d, out) {
    var pl = plans[sd], t = pl.tile, k = Math.floor(a / t), f = (a - k * t) / t;
    var ov = 0.3, wA = 1, wB = 0;
    if (f > 1 - ov && k + 1 < pl.shifts.length) { wB = (f - (1 - ov)) / ov; wA = 1 - wB; }
    var pa = patchSrc(pl, sd, a, d, k);
    out[0] = pa[0]; out[1] = pa[1]; out[2] = wA;
    if (wB > 0) { var pb = patchSrc(pl, sd, a, d, k + 1); out[3] = pb[0]; out[4] = pb[1]; out[5] = wB; }
    else out[5] = 0;
    return out;
  }

  function extend(src, need, mode, seed) {
    var w = src.w, h = src.h, sd = src.data;
    var L = need.l | 0, T = need.t | 0, Rr = need.r | 0, B = need.b | 0;
    var W = w + L + Rr, H = h + T + B, out = new Uint8ClampedArray(W * H * 4);
    var plans = mode === "smart" ? smartPicker(w, h, { l: L, t: T, r: Rr, b: B }, seed || 1) : null;
    var tmp = [0, 0, 0, 0, 0, 0], acc = [0, 0, 0, 0];
    function addSrc(x, y, wt) {
      var i = (y * w + x) * 4;
      acc[0] += sd[i] * wt; acc[1] += sd[i + 1] * wt; acc[2] += sd[i + 2] * wt; acc[3] += sd[i + 3] * wt;
    }
    // the smart value of an outside pixel on one side (band coords)
    function smartSide(side, a, d, wt) {
      smartPixel(plans, side, a, d, tmp);
      var fade = Math.min(1, d / 3);                 // near the trim: the mirror first
      var m = side === "l" ? srcOf("mirror", -d, a, w, h) : side === "r" ? srcOf("mirror", w - 1 + d, a, w, h) : side === "t" ? srcOf("mirror", a, -d, w, h) : srcOf("mirror", a, h - 1 + d, w, h);
      addSrc(m[0], m[1], wt * (1 - fade));
      addSrc(tmp[0], tmp[1], wt * fade * tmp[2]);
      if (tmp[5] > 0) addSrc(tmp[3], tmp[4], wt * fade * tmp[5]);
    }
    for (var y = 0; y < H; y++) {
      var oy = y - T;
      for (var x = 0; x < W; x++) {
        var ox = x - L, o = (y * W + x) * 4;
        if (ox >= 0 && ox < w && oy >= 0 && oy < h) {
          var i = (oy * w + ox) * 4;
          out[o] = sd[i]; out[o + 1] = sd[i + 1]; out[o + 2] = sd[i + 2]; out[o + 3] = sd[i + 3];
          continue;
        }
        if (!plans) {
          var p = srcOf(mode, ox, oy, w, h), j = (p[1] * w + p[0]) * 4;
          out[o] = sd[j]; out[o + 1] = sd[j + 1]; out[o + 2] = sd[j + 2]; out[o + 3] = sd[j + 3];
          continue;
        }
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        var inX = ox >= 0 && ox < w, inY = oy >= 0 && oy < h;
        if (inY) smartSide(ox < 0 ? "l" : "r", oy, ox < 0 ? -ox : ox - w + 1, 1);
        else if (inX) smartSide(oy < 0 ? "t" : "b", ox, oy < 0 ? -oy : oy - h + 1, 1);
        else {
          // a corner: the side patches of the nearest edge pixels, half each
          var cx = clampI(ox, 0, w - 1), cy = clampI(oy, 0, h - 1);
          var dx = ox < 0 ? -ox : ox - w + 1, dy = oy < 0 ? -oy : oy - h + 1;
          var sx = ox < 0 ? "l" : "r", sy = oy < 0 ? "t" : "b";
          // reflect the corner pixel into each band and take the side value there
          var yy = mir(oy < 0 ? -oy - 1 : 2 * h - oy - 1, h), xx = mir(ox < 0 ? -ox - 1 : 2 * w - ox - 1, w);
          void cx; void cy;
          smartSide(sx, yy, dx, 0.5);
          smartSide(sy, xx, dy, 0.5);
        }
        out[o] = acc[0]; out[o + 1] = acc[1]; out[o + 2] = acc[2]; out[o + 3] = acc[3] || 255;
      }
    }
    return { w: W, h: H, data: out };
  }

  var api = { extend: extend, MODES: ["mirror", "stretch", "smart"] };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LayoutBleedFill = api;
})(typeof window !== "undefined" ? window : this);
