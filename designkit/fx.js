// ============================================================
// orOS designkit — fx.js (image + text effects, v1.0.0)
// Shared by the design apps (Atelier, Layout). Owner: Atelier.
//
// Pure functions over numbers and pixel arrays, so the same code
// runs in the editor, in the exporter and under node --test. Only
// applyToCanvas() touches a real canvas.
//
// Text effects never measure text: text.js lays the glyphs out
// (canvas measureText, fontKerning "none", same as the PDF) and
// fx.js only says how to paint those glyph positions (passes) or
// where to move them (curveGlyphs).
//
// API (window.orosDK.fx, or module.exports under Node):
//   VER
//   ADJUST                         slider ids with their ranges
//   normAdjust(p)                  canonical adjustment record (R26)
//   isIdentity(p)                  true when nothing would change
//   adjustPixels(data, w, h, p)    applies p in place (RGBA bytes)
//   FILTERS, filterById(id)        named presets (EN/EL names)
//   applyToCanvas(canvas, p)       browser helper
//   fitRect(sw, sh, bw, bh, mode)  image placement in a frame
//   normCrop(c), cropPixels(c, iw, ih), rotatedBounds(w, h, deg)
//   SHAPES, shapePath(id, w, h, o), toSvgPath(cmds)
//   TEXT_FX, normTextFx(fx), textPasses(fx, size, fill), fxPad(fx, size)
//   curveGlyphs(glyphs, curve)
//   normColor(c), paletteOf(data, w, h, n)
// Sections:
//   1. Adjustments
//   2. Filter presets
//   3. Placement + crop
//   4. Shapes (also frame masks)
//   5. Text effects
//   6. Colour
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function int(v, lo, hi, def) {
    var n = Math.round(Number(v));
    return isFinite(n) ? clamp(n, lo, hi) : def;
  }

  // ---------- 1. Adjustments ----------

  // Fixed order = canonical order of the stored record.
  var ADJUST = [
    { id: "bright",   min: -100, max: 100 },
    { id: "contrast", min: -100, max: 100 },
    { id: "sat",      min: -100, max: 100 },
    { id: "warmth",   min: -100, max: 100 },
    { id: "tint",     min: -100, max: 100 },
    { id: "fade",     min: 0,    max: 100 },
    { id: "sepia",    min: 0,    max: 100 },
    { id: "vignette", min: 0,    max: 100 },
    { id: "blur",     min: 0,    max: 100 },
    { id: "sharpen",  min: 0,    max: 100 }
  ];

  function normAdjust(p) {
    p = p && typeof p === "object" ? p : {};
    var out = {};
    ADJUST.forEach(function (a) { out[a.id] = int(p[a.id], a.min, a.max, 0); });
    return out;
  }

  function isIdentity(p) {
    var n = normAdjust(p);
    return ADJUST.every(function (a) { return n[a.id] === 0; });
  }

  // Per-channel tone curve: brightness, contrast, fade (lifted blacks).
  function toneLut(n) {
    var lut = new Uint8ClampedArray(256);
    var b = n.bright / 100 * 64;
    var c = n.contrast / 100;
    var k = c >= 0 ? 1 + c * 2 : 1 + c;          // 0..3
    var f = n.fade / 100;
    for (var i = 0; i < 256; i++) {
      var v = i + b;
      v = (v - 128) * k + 128;
      v = v * (1 - f * 0.25) + f * 60;             // fade: lift blacks, dim whites a little
      lut[i] = clamp(Math.round(v), 0, 255);
    }
    return lut;
  }

  // Separable box blur, 3 passes ≈ Gaussian. radius in pixels.
  function boxBlur(src, w, h, radius) {
    var r = Math.max(1, Math.round(radius));
    var tmp = new Float32Array(w * h * 4);
    var cur = new Float32Array(src);
    for (var pass = 0; pass < 3; pass++) {
      blurDir(cur, tmp, w, h, r, true);
      blurDir(tmp, cur, w, h, r, false);
    }
    return cur;
  }

  function blurDir(inp, out, w, h, r, horiz) {
    var len = horiz ? w : h, lines = horiz ? h : w;
    var stride = horiz ? 4 : w * 4, step = horiz ? w * 4 : 4;
    var norm = 1 / (2 * r + 1);
    for (var l = 0; l < lines; l++) {
      var base = l * step;
      for (var ch = 0; ch < 4; ch++) {
        var acc = 0, i;
        for (i = -r; i <= r; i++) acc += inp[base + clamp(i, 0, len - 1) * stride + ch];
        for (i = 0; i < len; i++) {
          out[base + i * stride + ch] = acc * norm;
          acc += inp[base + clamp(i + r + 1, 0, len - 1) * stride + ch] - inp[base + clamp(i - r, 0, len - 1) * stride + ch];
        }
      }
    }
  }

  // Applies the adjustments to RGBA bytes in place. Alpha is kept.
  // Order: tone → colour → sepia → vignette → blur → sharpen.
  function adjustPixels(data, w, h, p) {
    var n = normAdjust(p);
    if (isIdentity(n) || !(w > 0 && h > 0) || data.length < w * h * 4) return data;
    var lut = toneLut(n);
    var sat = 1 + n.sat / 100;                   // 0..2
    var warm = n.warmth / 100 * 30;
    var tint = n.tint / 100 * 30;
    var sep = n.sepia / 100;
    var vig = n.vignette / 100;
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var rmax = Math.sqrt(cx * cx + cy * cy) || 1;
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i += 4) {
        var r = lut[data[i]], g = lut[data[i + 1]], b = lut[data[i + 2]];
        r += warm; b -= warm; g -= tint;
        if (sat !== 1) {
          var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        }
        if (sep) {
          var sr = 0.393 * r + 0.769 * g + 0.189 * b;
          var sg = 0.349 * r + 0.686 * g + 0.168 * b;
          var sb = 0.272 * r + 0.534 * g + 0.131 * b;
          r += (sr - r) * sep; g += (sg - g) * sep; b += (sb - b) * sep;
        }
        if (vig) {
          var dx = x - cx, dy = y - cy;
          var d = Math.sqrt(dx * dx + dy * dy) / rmax;     // 0 centre .. 1 corner
          var f = 1 - vig * 0.8 * Math.pow(clamp((d - 0.35) / 0.65, 0, 1), 1.6);
          r *= f; g *= f; b *= f;
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b;     // clamped by the array
      }
    }
    var short = Math.min(w, h);
    if (n.blur) {
      var bl = boxBlur(data, w, h, n.blur / 100 * short * 0.03);
      for (var j = 0; j < data.length; j++) data[j] = bl[j];
    }
    if (n.sharpen) {
      var soft = boxBlur(data, w, h, 1);
      var amt = n.sharpen / 100 * 1.5;
      for (var k = 0; k < data.length; k++) {
        if ((k & 3) === 3) continue;
        data[k] = data[k] + (data[k] - soft[k]) * amt;
      }
    }
    return data;
  }

  // ---------- 2. Filter presets ----------

  var FILTERS = [
    { id: "none",    en: "Original",  el: "Πρωτότυπο",      p: {} },
    { id: "vivid",   en: "Vivid",     el: "Ζωντανό",        p: { sat: 35, contrast: 15 } },
    { id: "warm",    en: "Warm",      el: "Ζεστό",          p: { warmth: 30, sat: 10 } },
    { id: "cool",    en: "Cool",      el: "Δροσερό",        p: { warmth: -30, tint: -5 } },
    { id: "aegean",  en: "Aegean",    el: "Αιγαίο",         p: { warmth: -15, tint: -5, sat: 25, contrast: 10 } },
    { id: "summer",  en: "Summer",    el: "Καλοκαίρι",      p: { warmth: 20, bright: 10, sat: 20 } },
    { id: "mono",    en: "Mono",      el: "Ασπρόμαυρο",     p: { sat: -100 } },
    { id: "noir",    en: "Noir",      el: "Νουάρ",          p: { sat: -100, contrast: 45, vignette: 40 } },
    { id: "sepia",   en: "Sepia",     el: "Σέπια",          p: { sepia: 85 } },
    { id: "vintage", en: "Vintage",   el: "Ρετρό",          p: { sepia: 35, fade: 30, vignette: 30, sat: -15 } },
    { id: "faded",   en: "Faded",     el: "Ξεθωριασμένο",   p: { fade: 45, contrast: -10 } },
    { id: "drama",   en: "Dramatic",  el: "Δραματικό",      p: { contrast: 40, sat: -20, vignette: 35, bright: -5 } },
    { id: "soft",    en: "Soft",      el: "Απαλό",          p: { blur: 6, bright: 8, contrast: -12 } }
  ];

  function filterById(id) {
    for (var i = 0; i < FILTERS.length; i++) {
      if (FILTERS[i].id === id) return { id: id, en: FILTERS[i].en, el: FILTERS[i].el, p: normAdjust(FILTERS[i].p) };
    }
    return null;
  }

  // Browser helper: adjusts a canvas in place (same pixels as export).
  function applyToCanvas(canvas, p) {
    if (isIdentity(p)) return canvas;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    adjustPixels(img.data, canvas.width, canvas.height, p);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // ---------- 3. Placement + crop ----------

  // Where to draw an image of sw×sh inside a frame of bw×bh.
  //   fit: whole image visible, letterboxed · fill: frame covered,
  //   overflow cropped · stretch: both axes scaled to the frame.
  function fitRect(sw, sh, bw, bh, mode) {
    if (!(sw > 0 && sh > 0 && bw > 0 && bh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
    if (mode === "stretch") return { x: 0, y: 0, w: bw, h: bh };
    var s = mode === "fill" ? Math.max(bw / sw, bh / sh) : Math.min(bw / sw, bh / sh);
    var w = sw * s, h = sh * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w: w, h: h };
  }

  var MIN_CROP = 0.01;

  // A crop is a rectangle in image fractions (0..1), canonical.
  function normCrop(c) {
    c = c && typeof c === "object" ? c : {};
    var r4 = function (v) { return Math.round(v * 10000) / 10000; };
    var num = function (v, d) { var n = Number(v); return isFinite(n) ? n : d; };
    var x = clamp(num(c.x, 0), 0, 1 - MIN_CROP);
    var y = clamp(num(c.y, 0), 0, 1 - MIN_CROP);
    var w = clamp(num(c.w, 1), MIN_CROP, 1 - x);
    var h = clamp(num(c.h, 1), MIN_CROP, 1 - y);
    return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
  }

  function cropPixels(c, iw, ih) {
    var n = normCrop(c);
    var x = Math.round(n.x * iw), y = Math.round(n.y * ih);
    return { x: x, y: y, w: Math.max(1, Math.min(iw - x, Math.round(n.w * iw))), h: Math.max(1, Math.min(ih - y, Math.round(n.h * ih))) };
  }

  function rotatedBounds(w, h, deg) {
    var a = (Number(deg) || 0) * Math.PI / 180;
    var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    var r = function (v) { return Math.round(v * 1000) / 1000; };
    return { w: r(w * c + h * s), h: r(w * s + h * c) };
  }

  // ---------- 4. Shapes (also frame masks) ----------
  // A shape is a list of absolute commands in a w×h box:
  //   ["M", x, y] ["L", x, y] ["C", x1, y1, x2, y2, x, y] ["Z"]
  // Canvas: new Path2D(toSvgPath(cmds)); PDF: the same commands.

  var KAPPA = 0.5522847498;

  function poly(pts) {
    var c = [["M", pts[0][0], pts[0][1]]];
    for (var i = 1; i < pts.length; i++) c.push(["L", pts[i][0], pts[i][1]]);
    c.push(["Z"]);
    return c;
  }

  // n points on a circle (optionally alternating with an inner
  // radius), then stretched so the bounding box is exactly 0..1.
  function radial(n, inner) {
    var pts = [], k = inner ? 2 * n : n;
    for (var i = 0; i < k; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / k;
      var r = inner && i % 2 ? inner : 1;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return poly(pts.map(function (p) { return [(p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)]; }));
  }

  function ellipseUnit() {
    var k = KAPPA / 2;
    return [["M", 0.5, 0],
      ["C", 0.5 + k, 0, 1, 0.5 - k, 1, 0.5],
      ["C", 1, 0.5 + k, 0.5 + k, 1, 0.5, 1],
      ["C", 0.5 - k, 1, 0, 0.5 + k, 0, 0.5],
      ["C", 0, 0.5 - k, 0.5 - k, 0, 0.5, 0], ["Z"]];
  }

  // Shapes in the unit box (scaled later), except the ones that need
  // the real box (rounded corners stay round on a stretched shape).
  var UNIT = {
    rect: function () { return poly([[0, 0], [1, 0], [1, 1], [0, 1]]); },
    circle: ellipseUnit,
    triangle: function () { return poly([[0.5, 0], [1, 1], [0, 1]]); },
    rtriangle: function () { return poly([[0, 0], [1, 1], [0, 1]]); },
    diamond: function () { return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]); },
    pentagon: function () { return radial(5); },
    hexagon: function () { return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]); },
    octagon: function () { var a = 0.2929; return poly([[a, 0], [1 - a, 0], [1, a], [1, 1 - a], [1 - a, 1], [a, 1], [0, 1 - a], [0, a]]); },
    star: function () { return radial(5, 0.45); },
    burst: function () { return radial(12, 0.78); },
    cross: function () { var a = 1 / 3, b = 2 / 3; return poly([[a, 0], [b, 0], [b, a], [1, a], [1, b], [b, b], [b, 1], [a, 1], [a, b], [0, b], [0, a], [a, a]]); },
    arrow: function () { return poly([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]); },
    chevron: function () { return poly([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]]); },
    parallelogram: function () { return poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]); },
    trapezoid: function () { return poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]); },
    heart: function () {
      return [["M", 0.5, 1],
        ["C", 0.18, 0.74, 0, 0.52, 0, 0.3],
        ["C", 0, 0.13, 0.12, 0, 0.27, 0],
        ["C", 0.38, 0, 0.46, 0.06, 0.5, 0.16],
        ["C", 0.54, 0.06, 0.62, 0, 0.73, 0],
        ["C", 0.88, 0, 1, 0.13, 1, 0.3],
        ["C", 1, 0.52, 0.82, 0.74, 0.5, 1], ["Z"]];
    },
    arch: function () {
      var k = KAPPA / 2;
      return [["M", 0, 1], ["L", 0, 0.5],
        ["C", 0, 0.5 - k, 0.5 - k, 0, 0.5, 0],
        ["C", 0.5 + k, 0, 1, 0.5 - k, 1, 0.5],
        ["L", 1, 1], ["Z"]];
    },
    drop: function () {
      return [["M", 0.5, 0],
        ["C", 0.62, 0.18, 1, 0.45, 1, 0.68],
        ["C", 1, 0.86, 0.78, 1, 0.5, 1],
        ["C", 0.22, 1, 0, 0.86, 0, 0.68],
        ["C", 0, 0.45, 0.38, 0.18, 0.5, 0], ["Z"]];
    },
    shield: function () {
      return [["M", 0.5, 0], ["L", 1, 0.15],
        ["C", 1, 0.6, 0.78, 0.86, 0.5, 1],
        ["C", 0.22, 0.86, 0, 0.6, 0, 0.15], ["Z"]];
    }
  };

  // Rounded rectangle in the real box: r = round% of half the short side.
  function roundedBox(w, h, round, tail) {
    var r = clamp(Number(round) || 0, 0, 100) / 100 * Math.min(w, h) / 2;
    var bh = tail ? h * 0.8 : h;
    r = Math.min(r, bh / 2);
    var k = r * KAPPA;
    var c = [["M", r, 0], ["L", w - r, 0]];
    if (r) c.push(["C", w - r + k, 0, w, r - k, w, r]);
    c.push(["L", w, bh - r]);
    if (r) c.push(["C", w, bh - r + k, w - r + k, bh, w - r, bh]);
    if (tail) c.push(["L", w * 0.36, bh], ["L", w * 0.14, h], ["L", w * 0.2, bh]);
    c.push(["L", r, bh]);
    if (r) c.push(["C", r - k, bh, 0, bh - r + k, 0, bh - r]);
    c.push(["L", 0, r]);
    if (r) c.push(["C", 0, r - k, r - k, 0, r, 0]);
    c.push(["Z"]);
    return c;
  }

  var SHAPES = [
    { id: "rect",          en: "Square",        el: "Τετράγωνο" },
    { id: "rounded",       en: "Rounded",       el: "Στρογγυλεμένο", round: true },
    { id: "circle",        en: "Circle",        el: "Κύκλος" },
    { id: "triangle",      en: "Triangle",      el: "Τρίγωνο" },
    { id: "rtriangle",     en: "Right triangle", el: "Ορθογώνιο τρίγωνο" },
    { id: "diamond",       en: "Diamond",       el: "Ρόμβος" },
    { id: "pentagon",      en: "Pentagon",      el: "Πεντάγωνο" },
    { id: "hexagon",       en: "Hexagon",       el: "Εξάγωνο" },
    { id: "octagon",       en: "Octagon",       el: "Οκτάγωνο" },
    { id: "star",          en: "Star",          el: "Αστέρι" },
    { id: "burst",         en: "Badge",         el: "Σήμα" },
    { id: "heart",         en: "Heart",         el: "Καρδιά" },
    { id: "cross",         en: "Cross",         el: "Σταυρός" },
    { id: "arrow",         en: "Arrow",         el: "Βέλος" },
    { id: "chevron",       en: "Chevron",       el: "Σιρίτι" },
    { id: "parallelogram", en: "Parallelogram", el: "Παραλληλόγραμμο" },
    { id: "trapezoid",     en: "Trapezoid",     el: "Τραπέζιο" },
    { id: "arch",          en: "Arch",          el: "Αψίδα" },
    { id: "drop",          en: "Drop",          el: "Σταγόνα" },
    { id: "shield",        en: "Shield",        el: "Ασπίδα" },
    { id: "bubble",        en: "Speech bubble", el: "Συννεφάκι", round: true }
  ];

  // o.round 0..100 for "rounded" and "bubble" (default 30).
  function shapePath(id, w, h, o) {
    if (!(w > 0 && h > 0)) return [];
    var round = o && o.round != null ? o.round : 30;
    if (id === "rounded") return roundedBox(w, h, round, false);
    if (id === "bubble") return roundedBox(w, h, round, true);
    var f = UNIT[id];
    if (!f) return [];
    return f().map(function (c) {
      var out = [c[0]];
      for (var i = 1; i < c.length; i += 2) out.push(c[i] * w, c[i + 1] * h);
      return out;
    });
  }

  function fmt(v) {
    var s = (Math.round(v * 100) / 100).toString();
    return s === "-0" ? "0" : s;
  }

  function toSvgPath(cmds) {
    return cmds.map(function (c) { return c[0] + c.slice(1).map(fmt).join(" "); }).join("");
  }

  // ---------- 5. Text effects ----------

  var TEXT_FX = [
    { id: "none",       en: "None",       el: "Κανένα" },
    { id: "shadow",     en: "Shadow",     el: "Σκιά" },
    { id: "lift",       en: "Lift",       el: "Ανύψωση" },
    { id: "hollow",     en: "Hollow",     el: "Κούφιο" },
    { id: "outline",    en: "Outline",    el: "Περίγραμμα" },
    { id: "splice",     en: "Splice",     el: "Μετατόπιση" },
    { id: "echo",       en: "Echo",       el: "Ηχώ" },
    { id: "glitch",     en: "Glitch",     el: "Glitch" },
    { id: "neon",       en: "Neon",       el: "Νέον" },
    { id: "background", en: "Background", el: "Φόντο" }
  ];
  var FX_IDS = TEXT_FX.map(function (f) { return f.id; });

  // Canonical record: { type, off, dir, blur, alpha, color, thick, pad, round }
  // off / blur / thick / pad / round 0..100, dir −180..180°, alpha 0..100.
  var FX_DEF = { off: 50, dir: 45, blur: 30, alpha: 50, color: "#000000", thick: 30, pad: 40, round: 30 };

  function normTextFx(fx) {
    fx = fx && typeof fx === "object" ? fx : {};
    var type = FX_IDS.indexOf(fx.type) >= 0 ? fx.type : "none";
    return {
      type: type,
      off: int(fx.off, 0, 100, FX_DEF.off),
      dir: int(fx.dir, -180, 180, FX_DEF.dir),
      blur: int(fx.blur, 0, 100, FX_DEF.blur),
      alpha: int(fx.alpha, 0, 100, FX_DEF.alpha),
      color: normColor(fx.color) || FX_DEF.color,
      thick: int(fx.thick, 0, 100, FX_DEF.thick),
      pad: int(fx.pad, 0, 100, FX_DEF.pad),
      round: int(fx.round, 0, 100, FX_DEF.round)
    };
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // Paint passes for one text box, in drawing order. Each pass draws
  // ALL glyphs of the box (positions from text.js) with:
  //   mode "fill" | "stroke" | "box" (rounded rectangle behind each line)
  //   dx, dy (px), blur (px), color, alpha (0..1), width (stroke px),
  //   pad, radius (box px)
  // `fill` is the text's own colour; size its font size in px.
  function textPasses(fx, size, fill) {
    var f = normTextFx(fx);
    var s = Number(size) > 0 ? Number(size) : 16;
    var col = normColor(fill) || "#000000";
    var main = { mode: "fill", dx: 0, dy: 0, blur: 0, color: col, alpha: 1 };
    var a = f.dir * Math.PI / 180;
    var dist = f.off / 100 * s * 0.2;
    var dx = r2(Math.cos(a) * dist), dy = r2(Math.sin(a) * dist);
    var stroke = r2(Math.max(1, f.thick / 100 * s * 0.12));
    switch (f.type) {
      case "shadow":
        return [{ mode: "fill", dx: dx, dy: dy, blur: r2(f.blur / 100 * s * 0.3), color: f.color, alpha: f.alpha / 100 }, main];
      case "lift":
        return [{ mode: "fill", dx: 0, dy: r2(s * 0.06), blur: r2(s * (0.1 + f.blur / 100 * 0.3)), color: "#000000", alpha: r2(0.15 + f.alpha / 100 * 0.4) }, main];
      case "hollow":
        return [{ mode: "stroke", dx: 0, dy: 0, blur: 0, color: col, alpha: 1, width: stroke }];
      case "outline":
        return [{ mode: "stroke", dx: 0, dy: 0, blur: 0, color: f.color, alpha: 1, width: r2(stroke * 2) }, main];
      case "splice":
        return [{ mode: "fill", dx: dx, dy: dy, blur: 0, color: f.color, alpha: 1 },
                { mode: "stroke", dx: 0, dy: 0, blur: 0, color: col, alpha: 1, width: stroke }];
      case "echo":
        return [3, 2, 1].map(function (k) {
          return { mode: "fill", dx: r2(dx * k / 1.5), dy: r2(dy * k / 1.5), blur: 0, color: col, alpha: r2(0.2 * (4 - k)) };
        }).concat([main]);
      case "glitch":
        var g = r2(Math.max(1, dist / 2));
        return [{ mode: "fill", dx: -g, dy: 0, blur: 0, color: "#00e5ff", alpha: 1 },
                { mode: "fill", dx: g, dy: 0, blur: 0, color: "#ff2bd6", alpha: 1 }, main];
      case "neon":
        var glow = r2(s * (0.08 + f.blur / 100 * 0.4));
        return [{ mode: "fill", dx: 0, dy: 0, blur: glow, color: col, alpha: 1 },
                { mode: "fill", dx: 0, dy: 0, blur: r2(glow / 3), color: col, alpha: 1 },
                { mode: "fill", dx: 0, dy: 0, blur: 0, color: mix(col, "#ffffff", 0.7), alpha: 1 }];
      case "background":
        var pad = r2(f.pad / 100 * s * 0.6);
        return [{ mode: "box", dx: 0, dy: 0, blur: 0, color: f.color, alpha: f.alpha / 100, pad: pad,
                  radius: r2(f.round / 100 * (s / 2 + pad)) }, main];
      default:
        return [main];
    }
  }

  // Extra room the effect needs around the glyph box, in px.
  function fxPad(fx, size) {
    var out = { l: 0, t: 0, r: 0, b: 0 };
    textPasses(fx, size, "#000000").forEach(function (p) {
      var e = (p.blur || 0) * 1.5 + (p.width || 0) / 2 + (p.pad || 0);
      out.l = Math.max(out.l, e - p.dx); out.r = Math.max(out.r, e + p.dx);
      out.t = Math.max(out.t, e - p.dy); out.b = Math.max(out.b, e + p.dy);
    });
    Object.keys(out).forEach(function (k) { out[k] = r2(out[k]); });
    return out;
  }

  // Curved text. glyphs: [{ x, w }] on one baseline (x = left edge,
  // from text.js). curve −100..100: 100 bends the line into a full
  // circle arching up (a rainbow), −100 into one bowing down (a smile).
  // Returns [{ x, y, rot }]: where each glyph's baseline CENTRE goes,
  // relative to the centre of the straight line, and its rotation in
  // radians. Glyph widths are unchanged.
  function curveGlyphs(glyphs, curve) {
    var list = Array.isArray(glyphs) ? glyphs : [];
    if (!list.length) return [];
    var x0 = list[0].x, x1 = list[list.length - 1].x + list[list.length - 1].w;
    var L = x1 - x0, mid = (x0 + x1) / 2;
    var c = int(curve, -100, 100, 0);
    return list.map(function (g) {
      var cx = g.x + g.w / 2 - mid;
      if (!c || !(L > 0)) return { x: r2(cx), y: 0, rot: 0 };
      var span = Math.abs(c) / 100 * 2 * Math.PI * 0.98;   // never quite closes
      var R = L / span;
      var a = cx / R;
      var sign = c > 0 ? 1 : -1;
      return { x: r2(R * Math.sin(a)), y: r2(sign * R * (1 - Math.cos(a))), rot: Math.round(sign * a * 10000) / 10000 };
    });
  }

  // ---------- 6. Colour ----------

  // "#abc" / "#aabbcc" / "aabbcc" → "#aabbcc", else "".
  function normColor(c) {
    if (typeof c !== "string") return "";
    var s = c.trim().toLowerCase().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/.test(s)) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return /^[0-9a-f]{6}$/.test(s) ? "#" + s : "";
  }

  function rgb(c) {
    var s = normColor(c) || "#000000";
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  }

  function hex(r, g, b) {
    return "#" + [r, g, b].map(function (v) { var s = clamp(Math.round(v), 0, 255).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }

  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }

  // The n main colours of a picture ("colours from this photo").
  // Pixels go into 4-bit-per-channel buckets; the biggest buckets win,
  // skipping ones too close to a colour already picked. Transparent
  // pixels are ignored. Deterministic: same pixels, same answer.
  function paletteOf(data, w, h, n) {
    n = int(n, 1, 12, 5);
    var total = w * h;
    var step = Math.max(1, Math.floor(total / 40000));       // sample ≤ ~40k pixels
    var count = {}, sum = {};
    for (var p = 0; p < total; p += step) {
      var i = p * 4;
      if (data[i + 3] < 128) continue;
      var key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
      if (!count[key]) { count[key] = 0; sum[key] = [0, 0, 0]; }
      count[key]++;
      sum[key][0] += data[i]; sum[key][1] += data[i + 1]; sum[key][2] += data[i + 2];
    }
    var keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a - b; });
    var picked = [];
    for (var k = 0; k < keys.length && picked.length < n; k++) {
      var c = count[keys[k]], s = sum[keys[k]];
      var col = [s[0] / c, s[1] / c, s[2] / c];
      var far = picked.every(function (q) {
        var dr = q[0] - col[0], dg = q[1] - col[1], db = q[2] - col[2];
        return dr * dr + dg * dg + db * db > 48 * 48;
      });
      if (far) picked.push(col);
    }
    return picked.map(function (q) { return hex(q[0], q[1], q[2]); });
  }

  var API = {
    VER: VER,
    ADJUST: ADJUST.map(function (a) { return { id: a.id, min: a.min, max: a.max }; }),
    normAdjust: normAdjust,
    isIdentity: isIdentity,
    adjustPixels: adjustPixels,
    FILTERS: FILTERS.map(function (f) { return { id: f.id, en: f.en, el: f.el }; }),
    filterById: filterById,
    applyToCanvas: applyToCanvas,
    fitRect: fitRect,
    normCrop: normCrop,
    cropPixels: cropPixels,
    rotatedBounds: rotatedBounds,
    SHAPES: SHAPES.map(function (s) { return { id: s.id, en: s.en, el: s.el, round: !!s.round }; }),
    shapePath: shapePath,
    toSvgPath: toSvgPath,
    TEXT_FX: TEXT_FX.slice(),
    normTextFx: normTextFx,
    textPasses: textPasses,
    fxPad: fxPad,
    curveGlyphs: curveGlyphs,
    normColor: normColor,
    mix: mix,
    paletteOf: paletteOf
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else {
    root.orosDK = root.orosDK || {};
    root.orosDK.fx = API;
  }
})(typeof window !== "undefined" ? window : this);
