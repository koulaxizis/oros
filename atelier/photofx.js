// ============================================================
// orOS Atelier — photofx.js: Canva's photo effects (wave CV-2, v1.0.0)
// On a photo element, ext.pfx (R39: a new field lives in ext):
//   sh   shadow { t: "drop" | "glow", c: "#rrggbb", op 0..100,
//        bl blur, d distance (both % of the element's shorter side,
//        0..50), ang 0..359 (drop only, 0 = right, 90 = down) }
//   duo  duotone { a: shadows colour, b: highlights colour }
//   eb   blur edges 1..100 (the photo fades out towards its outline)
//   fr   frame { t: "border" | "polaroid", c: "#rrggbb", w 1..30 (%
//        of the shorter side; polaroid keeps a wider bottom) }
// Older copies keep ext.pfx untouched (designkit normX) and draw the
// plain photo. norm() is the only reader; defaults are omitted, keys
// come in a fixed order (R26).
// Pure parts (norm, pad, inner, duotone) run in Node for the tests;
// paint() needs a 2D context.
// ============================================================
(function (root) {
  "use strict";

  var HEX = /^#[0-9a-f]{6}$/;
  var SH_T = ["drop", "glow"], FR_T = ["border", "polaroid"];
  var DEF = {
    sh: { drop: { t: "drop", c: "#000000", op: 40, bl: 6, d: 3, ang: 45 }, glow: { t: "glow", c: "#ffde59", op: 80, bl: 10, d: 0, ang: 0 } },
    duo: { a: "#1b2a6b", b: "#ff8fa3" },
    eb: 30,
    fr: { border: { t: "border", c: "#ffffff", w: 4 }, polaroid: { t: "polaroid", c: "#ffffff", w: 5 } }
  };
  // Canva-like duotone pairs (shadows, highlights)
  var DUO = [["#1b2a6b", "#ff8fa3"], ["#000000", "#ffde59"], ["#3d1c5c", "#38b6ff"], ["#0b3d2e", "#c1ff72"],
             ["#5c1a1a", "#ffbd59"], ["#14213d", "#e5e5e5"], ["#2d0036", "#ff66c4"], ["#003049", "#fcbf49"]];

  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; }
  function col(v, d) { v = typeof v === "string" ? v.toLowerCase() : ""; return HEX.test(v) ? v : d; }

  function norm(v) {
    if (!v || typeof v !== "object") return null;
    var o = {};
    if (v.sh && SH_T.indexOf(v.sh.t) >= 0) {
      var s = v.sh, d = DEF.sh[s.t];
      o.sh = { t: s.t, c: col(s.c, d.c), op: num(s.op, 0, 100, d.op), bl: num(s.bl, 0, 50, d.bl), d: num(s.d, 0, 50, d.d), ang: num(s.ang, 0, 359, d.ang) };
      if (s.t === "glow") { o.sh.d = 0; o.sh.ang = 0; }
    }
    if (v.duo && typeof v.duo === "object") o.duo = { a: col(v.duo.a, DEF.duo.a), b: col(v.duo.b, DEF.duo.b) };
    var eb = num(v.eb, 0, 100, 0);
    if (eb) o.eb = eb;
    if (v.fr && FR_T.indexOf(v.fr.t) >= 0) {
      var f = DEF.fr[v.fr.t];
      o.fr = { t: v.fr.t, c: col(v.fr.c, f.c), w: num(v.fr.w, 1, 30, f.w) };
    }
    return Object.keys(o).length ? o : null;
  }
  function of(it) { return it && it.ax && it.ax.k === "photo" && it.ext ? norm(it.ext.pfx) : null; }
  // Needs the element drawn as one picture (shadow, edges, frame).
  function composite(p) { return !!(p && (p.sh || p.eb || p.fr)); }

  // Room the shadow needs outside the box (element units).
  function pad(it, p) {
    if (!p || !p.sh) return 0;
    var m = Math.min(it.w, it.h);
    return Math.ceil(m * (p.sh.bl / 100) * 1.2 + m * (p.sh.d / 100)) + 1;
  }
  // The photo's own rect inside a frame (element units).
  function inner(it, p) {
    var w = it.w, h = it.h;
    if (!p || !p.fr) return { x: 0, y: 0, w: w, h: h };
    var b = Math.min(w, h) * p.fr.w / 100, bot = p.fr.t === "polaroid" ? b * 3.5 : b;
    var iw = Math.max(1, w - 2 * b), ih = Math.max(1, h - b - bot);
    return { x: b, y: b, w: iw, h: ih };
  }
  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  // In place on RGBA data: luminance picks between the two colours.
  function duotone(data, a, b) {
    var A = rgb(a), B = rgb(b);
    for (var i = 0; i < data.length; i += 4) {
      var l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      data[i] = Math.round(A[0] + (B[0] - A[0]) * l);
      data[i + 1] = Math.round(A[1] + (B[1] - A[1]) * l);
      data[i + 2] = Math.round(A[2] + (B[2] - A[2]) * l);
    }
    return data;
  }
  function rgba(h, op) { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (op / 100) + ")"; }

  // Draws a photo element with its effects onto ctx (element space,
  // origin at the element's top-left). shape: Path2D of the element's
  // outline; body(g, r): draws the photo, cut to its outline, into
  // rect r of g (element units). The element is first made on a canvas
  // of its own at the device scale, so the shadow follows its real
  // outline (frame, faded edges).
  function paint(ctx, it, p, shape, body) {
    var m = ctx.getTransform(), k = Math.sqrt(m.a * m.a + m.b * m.b) || 1;
    var s = Math.min(k, 4096 / Math.max(1, it.w), 4096 / Math.max(1, it.h));
    var W = Math.max(1, Math.round(it.w * s)), H = Math.max(1, Math.round(it.h * s));
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    var r = inner(it, p);
    if (p.fr) {
      g.save(); g.clip(shape); g.fillStyle = p.fr.c; g.fillRect(0, 0, it.w, it.h); g.restore();
      body(g, r);
    } else body(g, r);
    if (p.eb) {
      var mk = document.createElement("canvas"); mk.width = W; mk.height = H;
      var mg = mk.getContext("2d"), rad = Math.min(it.w, it.h) * s * p.eb / 640;
      mg.filter = "blur(" + rad.toFixed(2) + "px)";
      // the outline shrunk by the blur's reach, then blurred: it fades out at the edge
      var kx = Math.max(0.05, 1 - 2 * 1.4 * rad / W), ky = Math.max(0.05, 1 - 2 * 1.4 * rad / H);
      mg.setTransform(s * kx, 0, 0, s * ky, W * (1 - kx) / 2, H * (1 - ky) / 2);
      mg.fillStyle = "#fff"; mg.fill(shape);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(mk, 0, 0);
      g.globalCompositeOperation = "source-over";
      mk.width = mk.height = 0;
    }
    ctx.save();
    if (p.sh && p.sh.op) {
      var mn = Math.min(it.w, it.h), dist = mn * p.sh.d / 100, a = p.sh.ang * Math.PI / 180;
      var dx = Math.cos(a) * dist, dy = Math.sin(a) * dist;
      ctx.shadowColor = rgba(p.sh.c, p.sh.op);
      ctx.shadowBlur = mn * p.sh.bl / 100 * k;
      ctx.shadowOffsetX = m.a * dx + m.c * dy; ctx.shadowOffsetY = m.b * dx + m.d * dy;
    }
    ctx.drawImage(cv, 0, 0, it.w, it.h);
    ctx.restore();
    cv.width = cv.height = 0;
  }

  var API = { DEF: DEF, DUO: DUO, SH_T: SH_T, FR_T: FR_T, norm: norm, of: of, composite: composite, pad: pad, inner: inner,
              duotone: duotone, paint: paint };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.AtelierPhotoFx = API;
})(typeof window !== "undefined" ? window : this);
