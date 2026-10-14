// ============================================================
// orOS Atelier — relayout.js: a design in another size (v1.0.0)
// "Magic resize": the elements are placed again for the new page
// instead of the whole page being shrunk into it.
//   - content scale k = min(new w / old w, new h / old h): sizes,
//     strokes, font sizes and crops scale by k (nothing is distorted)
//   - each element keeps its anchor on each axis: near the left /
//     top edge → the same gap (×k) from that edge; near the right /
//     bottom edge → from that edge; otherwise its centre stays at the
//     same fraction of the page
//   - an element across (almost) the whole width or height (bars,
//     dividers, banners, full-bleed photos) is stretched along that
//     axis; a stretched photo is cropped to fill its new box
//   - page backgrounds cover the new page
//   - an element that was inside the page stays inside it
// Pure: works on a copy of the design. textHeight (AX.textHeight) is
// passed in so this file needs no fonts. Exposes window.AtelierRelayout
// (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var EDGE = 0.06;          // within 6 % of an edge = anchored to it
  var SPAN = 0.9;           // across 90 % of the page = stretched
  var MIN_FONT = 6;

  function r2(v) { return Math.round(v * 100) / 100; }

  // one axis: start a, length l on an old page of size P → new page p.
  // Returns { a, l }.
  function axis(a, l, P, p, k, stretch) {
    if (stretch) return { a: a / P * p, l: l * p / P };
    var nl = l * k, gapA = a, gapB = P - (a + l);
    var na;
    if (gapA <= gapB && gapA < EDGE * P) na = gapA * k;
    else if (gapB < gapA && gapB < EDGE * P) na = p - gapB * k - nl;
    else na = (a + l / 2) / P * p - nl / 2;
    // inside before → inside after (when it fits)
    if (a >= -0.5 && a + l <= P + 0.5 && nl <= p) na = Math.max(0, Math.min(p - nl, na));
    return { a: na, l: nl };
  }

  // doc: an Atelier design (normalized). w, h: the new page (points).
  // opts: { unit "px" | "mm", textHeight(item) }. Returns the new design
  // (the input is not changed). Stamps are left to the caller.
  function relayout(doc, w, h, opts) {
    opts = opts || {};
    var d = JSON.parse(JSON.stringify(doc));
    var W0 = d.setup.w, H0 = d.setup.h;
    if (!(W0 > 0 && H0 > 0 && w > 0 && h > 0)) return d;
    var k = Math.min(w / W0, h / H0);
    d.setup.w = r2(w); d.setup.h = r2(h);
    if (opts.unit) {
      d.setup.unit = opts.unit === "mm" ? "mm" : "pt";
      d.setup.bleed = opts.unit === "mm" ? 3 * 72 / 25.4 : 0;
    }
    d.items.forEach(function (it) {
      var ax = it.ax || {};
      if (ax.bg) { it.x = 0; it.y = 0; it.w = d.setup.w; it.h = d.setup.h; return; }
      var rotated = Math.abs(((it.rot || 0) % 180 + 180) % 180) > 1 && Math.abs(((it.rot || 0) % 180 + 180) % 180 - 180) > 1;
      var isText = ax.k === "text", isPhoto = it.t === "img";
      // text and icons keep their proportions; shapes, lines, photos
      // may stretch along an axis they (almost) fill
      var canStretch = !rotated && !isText && ax.k !== "icon";
      var sx = canStretch && it.w >= SPAN * W0, sy = canStretch && it.h >= SPAN * H0;
      if (isText && !rotated && it.w >= SPAN * W0) sx = true;      // a full-width text box keeps the full width
      var X = axis(it.x, it.w, W0, w, k, sx), Y = axis(it.y, it.h, H0, h, k, sy);
      var ow = it.w, oh = it.h, y0 = it.y;
      it.x = r2(X.a); it.y = r2(Y.a); it.w = Math.max(1, r2(X.l)); it.h = Math.max(1, r2(Y.l));
      if (typeof it.sw === "number") it.sw = r2(it.sw * k);
      if (isPhoto && it.fit === "custom") {
        var even = Math.abs(it.w / ow - it.h / oh) < 0.01;
        if (even) { it.ix = r2(it.ix * k); it.iy = r2(it.iy * k); it.isc = Math.round(it.isc * k * 10000) / 10000; }
        else { it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1; }
      }
      if ((ax.k === "table" || ax.k === "chart") && ax.size) it.ax.size = Math.max(MIN_FONT, Math.round(ax.size * k * 10) / 10);
      else if (ax.k === "table") it.ax.size = Math.max(MIN_FONT, Math.round(24 * k * 10) / 10);
      if (isText) {
        it.ax.size = Math.max(MIN_FONT, Math.round((ax.size || 48) * k * 10) / 10);
        if (typeof opts.textHeight === "function") {
          var nh = opts.textHeight(it);
          // the text's own height at its new size, grown from the same
          // edge (or centre) it was anchored to
          if (nh > 0) {
            var oT = y0, oB = H0 - (y0 + oh);
            if (oB < oT && oB < EDGE * H0) it.y = r2(Y.a + Y.l - nh);
            else if (oT < EDGE * H0) it.y = r2(Y.a);
            else it.y = r2(Y.a + Y.l / 2 - nh / 2);
            it.h = r2(nh);
            if (it.y + it.h > h && it.h <= h) it.y = r2(h - it.h);
            if (it.y < 0) it.y = 0;
          }
        }
      }
    });
    return d;
  }

  var api = { relayout: relayout, EDGE: EDGE, SPAN: SPAN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierRelayout = api;
})(typeof window !== "undefined" ? window : this);
