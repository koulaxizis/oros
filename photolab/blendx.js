// ============================================================
// orOS Photo Lab — blend modes the canvas does not have (wave PS-5)
// Photoshop's dissolve, linear burn, darker colour, linear dodge
// (add), lighter colour, vivid light, linear light, pin light, hard
// mix, subtract and divide, done per pixel. The other modes stay
// native (core.js BLENDS op), so the screen and the export mix them
// exactly as before.
//
// Pixels are straight-alpha RGBA (ImageData). A layer goes over its
// backdrop with the W3C compositing rule Photoshop follows:
//   Cm = (1 - ab) Cs + ab B(Cb, Cs)
//   ao = as + ab (1 - as)
//   Co = (as Cm + ab (1 - as) Cb) / ao
// Dissolve keeps a pixel fully or not at all, by a fixed noise of
// the document pixel, like Photoshop's.
// ============================================================
(function (root) {
  "use strict";

  var IDS = ["dissolve", "linearburn", "darkercolor", "lineardodge", "lightercolor",
             "vivid", "linearlight", "pin", "hardmix", "subtract", "divide"];

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function burn(b, s) { return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s); }
  function dodge(b, s) { return b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)); }

  // One channel, 0..1 (the colour-wide modes are done per pixel).
  var CH = {
    linearburn:  function (b, s) { return clamp(b + s - 1); },
    lineardodge: function (b, s) { return clamp(b + s); },
    vivid:       function (b, s) { return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1); },
    linearlight: function (b, s) { return clamp(b + 2 * s - 1); },
    pin:         function (b, s) { return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1); },
    hardmix:     function (b, s) { return b + s >= 1 ? 1 : 0; },
    subtract:    function (b, s) { return clamp(b - s); },
    divide:      function (b, s) { return b <= 0 ? 0 : s <= 0 ? 1 : clamp(b / s); }
  };

  function isSoft(id) { return IDS.indexOf(id) >= 0; }

  // A fixed noise 0..1 of a document pixel (dissolve).
  function noise(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // dst, src: RGBA arrays of the same w × h rect. alpha: the layer's
  // opacity 0..1. docAt(i) → [x, y] document pixel of pixel i (for
  // dissolve; default: the rect's own x, y from x0, y0).
  function blendPixels(dst, src, alpha, id, w, x0, y0, docAt) {
    var n = Math.min(dst.length, src.length) >> 2, f = CH[id];
    x0 = x0 || 0; y0 = y0 || 0;
    for (var p = 0; p < n; p++) {
      var i = p * 4, as = src[i + 3] / 255 * alpha;
      if (as <= 0) continue;
      var ab = dst[i + 3] / 255;
      var sr = src[i] / 255, sg = src[i + 1] / 255, sb = src[i + 2] / 255;
      var br = dst[i] / 255, bg = dst[i + 1] / 255, bb = dst[i + 2] / 255;
      var mr, mg, mb;
      if (id === "dissolve") {
        var at = docAt ? docAt(p) : [x0 + p % w, y0 + Math.floor(p / w)];
        if (noise(at[0], at[1]) >= as) continue;
        as = 1; mr = sr; mg = sg; mb = sb;
      } else if (id === "darkercolor" || id === "lightercolor") {
        var ts = sr + sg + sb, tb = br + bg + bb;
        var pickS = id === "darkercolor" ? ts < tb : ts > tb;
        mr = pickS ? sr : br; mg = pickS ? sg : bg; mb = pickS ? sb : bb;
      } else if (f) {
        mr = f(br, sr); mg = f(bg, sg); mb = f(bb, sb);
      } else { mr = sr; mg = sg; mb = sb; }
      // backdrop transparent → the source's own colour
      mr = (1 - ab) * sr + ab * mr; mg = (1 - ab) * sg + ab * mg; mb = (1 - ab) * sb + ab * mb;
      var ao = as + ab * (1 - as), kb = ab * (1 - as);
      dst[i]     = Math.round((as * mr + kb * br) / ao * 255);
      dst[i + 1] = Math.round((as * mg + kb * bg) / ao * 255);
      dst[i + 2] = Math.round((as * mb + kb * bb) / ao * 255);
      dst[i + 3] = Math.round(ao * 255);
    }
    return dst;
  }

  // Draws canvas src onto 2D context g at device (dx, dy), identity
  // transform, with opacity alpha and blend id. Native modes go
  // through the canvas (op from core.js); the others per pixel, only
  // inside box (device rect, optional) and the canvas. docOf(x, y)
  // → [x, y] document pixel for dissolve (optional).
  function drawOver(g, src, dx, dy, alpha, id, op, box, docOf) {
    if (!isSoft(id)) {
      g.globalAlpha = alpha;
      g.globalCompositeOperation = op || "source-over";
      g.drawImage(src, dx, dy);
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      return;
    }
    var W = g.canvas.width, H = g.canvas.height;
    var x0 = Math.max(0, dx), y0 = Math.max(0, dy);
    var x1 = Math.min(W, dx + src.width), y1 = Math.min(H, dy + src.height);
    if (box) {
      x0 = Math.max(x0, Math.floor(box.x)); y0 = Math.max(y0, Math.floor(box.y));
      x1 = Math.min(x1, Math.ceil(box.x + box.w)); y1 = Math.min(y1, Math.ceil(box.y + box.h));
    }
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    var D = g.getImageData(x0, y0, w, h);
    var S = src.getContext("2d").getImageData(x0 - dx, y0 - dy, w, h);
    var docAt = docOf ? function (p) { return docOf(x0 + p % w, y0 + Math.floor(p / w)); } : null;
    blendPixels(D.data, S.data, alpha, id, w, x0, y0, docAt);
    g.putImageData(D, x0, y0);
  }

  var API = { IDS: IDS, isSoft: isSoft, blendPixels: blendPixels, drawOver: drawOver, noise: noise };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.blendx = API; }
})(typeof window !== "undefined" ? window : this);
