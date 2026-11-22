// ============================================================
// orOS Mockups — goods/small.js (v1.0.0)
// Badges, stickers, keychains, enamel pins and magnets: the pure
// part (no DOM, no three.js; Node-tested in tests/mockups.test.js).
// Registers "badge", "sticker", "keychain", "pin" and "magnet" with
// MockCore.addGood(). A sheet has the book-cover shape of
// MockCore.template() plus a cut: { shape: round | rect | die, r,
// off, edge } (print.js draws it, the PDF carries it as a line) and
// holes. A die cut follows the picture's outline: dieOutline() finds
// it in the picture's see-through pixels, grown by the white edge.
// Every product describes its own options (opts) so the app builds
// the form, the subtitle and the pictures list from here.
// Sizes are common published ones (button cut sizes, sticker and
// magnet sizes); the maker's own template always wins.
// The 3D part is goods/small3d.js.
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  var MM = root.MockMedia || (typeof require === "function" ? require("./media.js") : null);
  if (!C || !MM) return;
  var pick = MM.pick, bit = MM.bit, sheet = MM.sheet, safeOf = MM.safeOf, r3 = C.round3;
  function bleedOf(p) { return p.art && p.art.bleed >= 0 ? p.art.bleed : 2; }

  // ---------- Outlines (pixels) ----------
  // The box of the pixels over thr: { x0, y0, x1, y1 } or null.
  function alphaBox(a, w, h, thr) {
    thr = thr == null ? 32 : thr;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (a[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  // Chamfer distance (3-4) from every pixel to the nearest set one.
  function distance(m, w, h) {
    var INF = 1e9, d = new Float64Array(w * h), x, y, i;
    for (i = 0; i < w * h; i++) d[i] = m[i] ? 0 : INF;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; var v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; var u = d[i];
      if (x < w - 1) u = Math.min(u, d[i + 1] + 3);
      if (y < h - 1) {
        u = Math.min(u, d[i + w] + 3);
        if (x < w - 1) u = Math.min(u, d[i + w + 1] + 4);
        if (x > 0) u = Math.min(u, d[i + w - 1] + 4);
      }
      d[i] = u;
    }
    for (i = 0; i < w * h; i++) d[i] /= 3;
    return d;
  }
  // Pieces of a mask (4-connected): { lab, sizes }.
  function pieces(m, w, h) {
    var lab = new Int32Array(w * h), sizes = [0], st = [];
    for (var s = 0; s < w * h; s++) {
      if (!m[s] || lab[s]) continue;
      var id = sizes.length, n = 0;
      lab[s] = id; st.push(s);
      while (st.length) {
        var i = st.pop(), x = i % w, y = (i - x) / w; n++;
        if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = id; st.push(i - 1); }
        if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = id; st.push(i + 1); }
        if (y > 0 && m[i - w] && !lab[i - w]) { lab[i - w] = id; st.push(i - w); }
        if (y < h - 1 && m[i + w] && !lab[i + w]) { lab[i + w] = id; st.push(i + w); }
      }
      sizes.push(n);
    }
    return { lab: lab, sizes: sizes };
  }
  // The outer edge of a mask, walked clockwise (Moore neighbours).
  var DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  function dirOf(dx, dy) { for (var i = 0; i < 8; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return i; return 0; }
  function trace(m, w, h) {
    var s = -1;
    for (var i = 0; i < w * h; i++) if (m[i]) { s = i; break; }
    if (s < 0) return [];
    var sx = s % w, sy = (s - sx) / w, cx = sx, cy = sy, b = 0, pts = [[sx, sy]], visits = 0;
    for (var it = 0; it < w * h * 4; it++) {
      var found = false;
      for (var k = 1; k <= 8; k++) {
        var d = (b + k) % 8, nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !m[ny * w + nx]) continue;
        var pd = (b + k + 7) % 8;
        b = dirOf(cx + DIRS[pd][0] - nx, cy + DIRS[pd][1] - ny);
        cx = nx; cy = ny; found = true;
        break;
      }
      if (!found) break;
      if (cx === sx && cy === sy) { visits++; if (b === 0 || visits > 2) break; }
      pts.push([cx, cy]);
    }
    return pts;
  }
  // Fewer points, the shape kept within eps (Douglas-Peucker).
  function simplify(pts, eps) {
    if (pts.length < 4) return pts.slice();
    var keep = new Uint8Array(pts.length), st = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (st.length) {
      var r = st.pop(), a = pts[r[0]], z = pts[r[1]], best = -1, bi = -1;
      var dx = z[0] - a[0], dy = z[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
      for (var i = r[0] + 1; i < r[1]; i++) {
        var q = pts[i], dd = Math.abs(dy * (q[0] - a[0]) - dx * (q[1] - a[1])) / L;
        if (L === 1 && !dx && !dy) dd = Math.hypot(q[0] - a[0], q[1] - a[1]);
        if (dd > best) { best = dd; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; st.push([r[0], bi], [bi, r[1]]); }
    }
    return pts.filter(function (p, i) { return keep[i]; });
  }
  // The die line of a picture: its pixels over thr, grown by off
  // pixels, holes filled, the biggest piece. → { path: [[x, y]…]
  // (pixel centres, clockwise), parts } or null.
  function dieOutline(a, w, h, off, thr) {
    thr = thr == null ? 32 : thr;
    var m = new Uint8Array(w * h), i;
    for (i = 0; i < w * h; i++) m[i] = a[i] > thr ? 1 : 0;
    if (off > 0) {
      var d = distance(m, w, h);
      for (i = 0; i < w * h; i++) m[i] = d[i] <= off ? 1 : 0;
    }
    // fill the holes: what the border cannot reach is inside
    var out = new Uint8Array(w * h), st = [];
    for (var x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); }
    for (var y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
    while (st.length) {
      var j = st.pop();
      if (m[j] || out[j]) continue;
      out[j] = 1;
      var jx = j % w, jy = (j - jx) / w;
      if (jx > 0) st.push(j - 1); if (jx < w - 1) st.push(j + 1);
      if (jy > 0) st.push(j - w); if (jy < h - 1) st.push(j + w);
    }
    for (i = 0; i < w * h; i++) m[i] = out[i] ? 0 : 1;
    var P = pieces(m, w, h), big = 0;
    for (i = 1; i < P.sizes.length; i++) if (!big || P.sizes[i] > P.sizes[big]) big = i;
    if (!big) return null;
    for (i = 0; i < w * h; i++) m[i] = P.lab[i] === big ? 1 : 0;
    var path = simplify(trace(m, w, h), 0.75);
    if (path.length < 3) return null;
    return { path: path, parts: P.sizes.length - 1 };
  }
  // The highest point (smallest y) of a closed path at x, or null.
  function topAt(path, x) {
    var best = null;
    for (var i = 0; i < path.length; i++) {
      var a = path[i], b = path[(i + 1) % path.length];
      if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) { if (a[0] === x && (best === null || a[1] < best)) best = a[1]; continue; }
      var y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      if (best === null || y < best) best = y;
    }
    return best;
  }
  function circlePath(cx, cy, r, n) {
    n = n || 96;
    var o = [];
    for (var i = 0; i < n; i++) { var t = i / n * Math.PI * 2; o.push([r3(cx + Math.cos(t) * r), r3(cy + Math.sin(t) * r)]); }
    return o;
  }
  function rectPath(x, y, w, h, r, n) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    n = n || 8;
    var o = [], cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    cs.forEach(function (c) {
      for (var i = 0; i <= n; i++) { var t = c[2] + i / n * Math.PI / 2; o.push([r3(c[0] + Math.cos(t) * r), r3(c[1] + Math.sin(t) * r)]); }
    });
    return o;
  }

  // ---------- Sheets with a cut ----------
  function cutSheet(kind, slot, W, H, p, cut, holes) {
    var T = sheet(kind, [[slot, slot, W]], H, bleedOf(p), safeOf(p));
    T.cut = cut; T.holes = holes || [];
    T.trims = [];
    T.safe = []; T.safeMm = safeOf(p);
    return T;
  }

  // ---------- Badge (pin-back button) ----------
  var BSIZES = [25, 32, 38, 44, 58, 75];
  var BCUT = { 25: 35, 32: 43, 38: 50, 44: 56, 58: 70, 75: 87 };
  var FINS = ["gloss", "matte"];
  var BBACKS = ["pin", "magnet"];
  function badgeNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { d: pick(g.d, BSIZES, 38), fin: pick(g.fin, FINS, "gloss"), back: pick(g.back, BBACKS, "pin"), beside: bit(g.beside) };
  }
  function badgeDims(g) {
    g = badgeNorm(g);
    return { w: g.d, h: g.d, d: r3(3 + g.d * 0.06), cut: BCUT[g.d], dome: r3(1 + g.d * 0.03) };
  }
  function badgeTemplate(p) {
    var D = badgeDims(p.g), cut = D.cut;
    return {
      kind: "badge", W: cut, H: cut, bleed: 0, spine: 0, sheet: { w: cut, h: cut },
      parts: [{ k: "front", a: "front", x: 0, w: cut }], folds: [], bar: null, warn: [], trims: [], punch: [], safe: [],
      circle: { c: cut / 2, print: cut, hub: 0, hole: 0, safeOut: r3(p.g.d - 4), safeIn: 0, fold: p.g.d }
    };
  }

  // ---------- Sticker ----------
  var SSHAPES = ["die", "round", "square", "rounded"];
  var SSIZES = [50, 75, 100, 150];
  var SFINS = ["matte", "gloss", "holo", "clear"];
  var EDGES = [0, 2, 3];
  function stickerNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { shape: pick(g.shape, SSHAPES, "die"), size: pick(g.size, SSIZES, 75), fin: pick(g.fin, SFINS, "gloss"), edge: pick(g.edge, EDGES, 2) };
  }
  function stickerDims(g) { g = stickerNorm(g); return { w: g.size, h: g.size, d: 0.25 }; }
  function shapeCut(shape, S, edge, fill) {
    if (shape === "die") return { shape: "die", r: 0, off: edge, edge: fill };
    if (shape === "round") return { shape: "round", r: S / 2, off: 0, edge: null };
    return { shape: "rect", r: shape === "rounded" ? r3(S * 0.08) : 0, off: 0, edge: null };
  }
  function stickerTemplate(p) {
    var g = p.g;
    return cutSheet("sticker", "front", g.size, g.size, p, shapeCut(g.shape, g.size, g.edge, g.fin === "clear" ? null : "#ffffff"));
  }

  // ---------- Keychain ----------
  var KSHAPES = ["die", "round", "rect"];
  var KMATS = ["acrylic", "metal", "rubber"];
  var KSIZES = [40, 50, 60, 75];
  var RINGS = ["silver", "gold", "black"];
  var TAB = 7;                                  // mm above the art for the hole tab
  function keyNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { shape: pick(g.shape, KSHAPES, "die"), mat: pick(g.mat, KMATS, "acrylic"), size: pick(g.size, KSIZES, 50), ring: pick(g.ring, RINGS, "silver"), two: bit(g.two) };
  }
  function keyDims(g) {
    g = keyNorm(g);
    return { w: g.size, h: g.size, d: g.mat === "acrylic" ? 3 : g.mat === "metal" ? 2 : 4, hole: 3.6, ring: 25 };
  }
  function keyTemplate(p, s) {
    var g = p.g, S = g.size, D = keyDims(g);
    // the back of a die cut is the front's outline, seen from behind
    var cut = g.shape === "die" ? { shape: "die", r: 0, off: 2, edge: g.mat === "acrylic" ? null : "#ffffff", top: TAB, from: s === "kback" ? "front" : "", mirror: s === "kback" ? 1 : 0 }
      : g.shape === "round" ? { shape: "round", r: S / 2, off: 0, edge: null } : { shape: "rect", r: r3(S * 0.1), off: 0, edge: null };
    // round and rectangle: the hole inside, near the top; die: on a tab
    var holes = g.shape === "die" ? [{ x: S / 2, y: TAB / 2, d: D.hole, tab: 9 }] : [{ x: S / 2, y: 4.5, d: D.hole }];
    return cutSheet(s === "kback" ? "kback" : "kfront", s === "kback" ? "back" : "front", S, S, p, cut, holes);
  }

  // ---------- Enamel pin ----------
  var PSHAPES = ["die", "round"];
  var PSIZES = [20, 25, 30, 40, 50];
  var METALS = ["gold", "silver", "black", "rose", "copper"];
  var ENAMELS = ["hard", "soft"];
  function pinNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { shape: pick(g.shape, PSHAPES, "die"), size: pick(g.size, PSIZES, 25), metal: pick(g.metal, METALS, "gold"), enamel: pick(g.enamel, ENAMELS, "hard"), card: bit(g.card), beside: bit(g.beside) };
  }
  function pinDims(g) { g = pinNorm(g); return { w: g.size, h: g.size, d: 1.6, card: { w: 51, h: 76 } }; }
  function pinTemplate(p, s) {
    var g = p.g;
    if (s === "pcard") return cutSheet("pcard", "back", 51, 76, p, { shape: "rect", r: 2, off: 0, edge: null }, [{ x: 25.5, y: 6, d: 6 }]);
    return cutSheet("pin", "front", g.size, g.size, Object.assign({}, p, { art: Object.assign({}, p.art, { bleed: 0 }) }),
      g.shape === "die" ? { shape: "die", r: 0, off: 0.6, edge: null } : { shape: "round", r: g.size / 2, off: 0, edge: null });
  }

  // ---------- Magnet ----------
  var MSHAPES = ["rect", "round", "die"];
  var MSIZES = ["51x51", "76x51", "89x51", "102x76"];
  function magNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { shape: pick(g.shape, MSHAPES, "rect"), size: pick(g.size, MSIZES, "76x51"), fin: pick(g.fin, FINS, "gloss") };
  }
  function magDims(g) {
    g = magNorm(g);
    var s = g.size.split("x").map(Number), w = s[0], h = s[1];
    if (g.shape !== "rect") w = h = Math.max(w, h) === 102 ? 76 : h;
    return { w: w, h: h, d: 0.8 };
  }
  function magTemplate(p) {
    var g = p.g, D = magDims(g);
    var cut = g.shape === "die" ? { shape: "die", r: 0, off: 2, edge: "#ffffff" } : g.shape === "round" ? { shape: "round", r: D.w / 2, off: 0, edge: null } : { shape: "rect", r: 3, off: 0, edge: null };
    return cutSheet("magnet", "front", D.w, D.h, p, cut);
  }

  // ---------- The forms ----------
  // opts: [{ k, t: seg | sel | chk, v: values, p: string key prefix,
  // u: "mm" (values are lengths) | "wxh", l: label key, when(g) }]
  var SM = {
    badge: [{ k: "d", t: "seg", v: BSIZES, u: "mm", l: "f.gsize" }, { k: "fin", t: "seg", v: FINS, p: "fin.", l: "f.fin" },
      { k: "back", t: "seg", v: BBACKS, p: "bback.", l: "f.bback" }, { k: "beside", t: "chk", l: "f.beside.badge" }],
    sticker: [{ k: "shape", t: "seg", v: SSHAPES, p: "shape.", l: "f.shape" }, { k: "size", t: "seg", v: SSIZES, u: "mm", l: "f.gsize" },
      { k: "fin", t: "seg", v: SFINS, p: "fin.", l: "f.fin" }, { k: "edge", t: "seg", v: EDGES, u: "mm", l: "f.wedge", when: function (g) { return g.shape === "die"; } }],
    keychain: [{ k: "shape", t: "seg", v: KSHAPES, p: "shape.", l: "f.shape" }, { k: "mat", t: "seg", v: KMATS, p: "kmat.", l: "f.kmat" },
      { k: "size", t: "seg", v: KSIZES, u: "mm", l: "f.gsize" }, { k: "ring", t: "seg", v: RINGS, p: "metal.", l: "f.ring" }, { k: "two", t: "chk", l: "f.two" }],
    pin: [{ k: "shape", t: "seg", v: PSHAPES, p: "shape.", l: "f.shape" }, { k: "size", t: "seg", v: PSIZES, u: "mm", l: "f.gsize" },
      { k: "metal", t: "sel", v: METALS, p: "metal.", l: "f.metal" }, { k: "enamel", t: "seg", v: ENAMELS, p: "enamel.", l: "f.enamel" },
      { k: "card", t: "chk", l: "f.card" }, { k: "beside", t: "chk", l: "f.beside.pin" }],
    magnet: [{ k: "shape", t: "seg", v: MSHAPES, p: "shape.", l: "f.shape" }, { k: "size", t: "seg", v: MSIZES, u: "wxh", l: "f.gsize" },
      { k: "fin", t: "seg", v: FINS, p: "fin.", l: "f.fin" }]
  };

  var A = {
    VERSION: "1.0.0", BSIZES: BSIZES, BCUT: BCUT, SSHAPES: SSHAPES, SSIZES: SSIZES, SFINS: SFINS, KSHAPES: KSHAPES, KMATS: KMATS,
    KSIZES: KSIZES, RINGS: RINGS, PSHAPES: PSHAPES, PSIZES: PSIZES, METALS: METALS, ENAMELS: ENAMELS, MSHAPES: MSHAPES, MSIZES: MSIZES, TAB: TAB,
    alphaBox: alphaBox, dieOutline: dieOutline, simplify: simplify, topAt: topAt, circlePath: circlePath, rectPath: rectPath,
    badgeNorm: badgeNorm, badgeDims: badgeDims, stickerNorm: stickerNorm, keyNorm: keyNorm, keyDims: keyDims, pinNorm: pinNorm, pinDims: pinDims, magNorm: magNorm, magDims: magDims
  };
  function reg(kind, def) { def.group = "merch"; def.wrap = false; def.opts = SM[kind]; def.place = "lie"; def.cam = { th: -18, ph: 46 }; def.noOpen = true; C.addGood(kind, def); }
  reg("badge", { slots: [], norm: badgeNorm, dims: badgeDims, sheets: function () { return ["badge"]; }, template: badgeTemplate,
    shown: function () { return ["front"]; } });
  reg("sticker", { slots: [], norm: stickerNorm, dims: stickerDims, sheets: function () { return ["sticker"]; }, template: stickerTemplate,
    shown: function () { return ["front"]; } });
  reg("keychain", { slots: [], norm: keyNorm, dims: keyDims, sheets: function (p) { return p.g.two ? ["kfront", "kback"] : ["kfront"]; }, template: keyTemplate,
    shown: function (g) { return g.two ? ["front", "back"] : ["front"]; } });
  reg("pin", { slots: [], norm: pinNorm, dims: pinDims, sheets: function (p) { return p.g.card ? ["pin", "pcard"] : ["pin"]; }, template: pinTemplate,
    shown: function (g) { return g.card ? ["front", "back"] : ["front"]; } });
  reg("magnet", { slots: [], norm: magNorm, dims: magDims, sheets: function () { return ["magnet"]; }, template: magTemplate,
    shown: function () { return ["front"]; } });
  root.MockSmall = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
