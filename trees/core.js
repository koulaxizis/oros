// ============================================================
// orOS Tree Sketcher — core (v1.0.0)
// Pure logic, no DOM: a seeded tree generator, the drawing of a
// tree through a small "pen" (canvas or SVG), the saved-trees merge,
// and the bridge to the Wallpaper Generator's "Tree" style.
// Loaded by trees.js (window.TreesCore), by the shell and the
// Wallpaper Generator (before wallpaper/art.js), and by the tests.
//
// A tree is a RECIPE, a few bytes that travel through sync:
//   { seed, sp, season, br, ang, rnd, fol, wind, ink, ground }
// The same recipe grows the same tree on every device.
//
// Saved trees (sync slice "trees"):
//   { ver: 1, trees: [{ id, m, name, r }], tombs: { id: deletedAt } }
//
// The grown model is measured in tree units: the trunk starts at
// (0, 0) and grows towards negative y; a tree is about 1 unit tall.
//   { seed, sp, season, ink, ground, leafSet, ever,
//     segs:   [{ x1, y1, x2, y2, w1, w2, d }]   branches, parents first
//     leaves: [{ x, y, r, q, rot, c, s }]       q = width / length
//     blooms: [{ x, y, r, c }]
//     snow:   [{ x1, y1, x2, y2, w }]           snow on branches
//     fallen: [{ x, y, r, rot, c, air }]        fallen leaves
//     flakes: [{ x, y, r }]
//     box:    { x0, y0, x1, y1 }  (tree only), height }
// Sections:
//   1. Recipe
//   2. Random numbers
//   3. Growing
//   4. Looks (colours per drawing style)
//   5. Painting through a pen (canvas, SVG)
//   6. Saved trees: normalize, merge
//   7. Wallpaper bridge
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER  = 1;
  var MAX_TREES = 200;
  var SEED_LEN  = 40;
  var NAME_LEN  = 60;
  var MAX_SEGS  = 3200;
  var MAX_LEAVES = 5000;
  var MAX_BLOOMS = 900;
  var ID_RE     = /^t[a-z0-9]{6,20}$/;
  var TAU       = Math.PI * 2;
  var UP        = -Math.PI / 2;

  var SPECIES = ["oak", "willow", "cypress", "olive", "bonsai", "wild"];
  var SEASONS = ["spring", "summer", "autumn", "winter"];
  var INKS    = ["pencil", "ink", "chalk", "colour"];
  var GROUNDS = ["none", "grass", "hill"];

  // The shape of each kind of tree. br/ang/rnd/fol are the slider
  // values a species starts with; the rest stays with the species.
  //   trunk: trunk length, ratio: child / parent length, kids: children
  //   at a fork (min, max), p3: chance of the extra child, mid: chance
  //   of a side branch half way, up: pull towards the sky, droop: pull
  //   of the twigs towards the ground, twist: how much a branch bends,
  //   width: trunk width, leaf: leaf size, q: leaf width / length.
  var SP = {
    oak:     { br: 9,  ang: 30, rnd: 35, fol: 65, trunk: 0.30, ratio: 0.76, kids: [2, 3], p3: 0.35, mid: 0.30, up: 0.06, droop: 0.00, twist: 0.14, width: 0.060, leaf: 0.020, q: 0.75, ever: false },
    willow:  { br: 9,  ang: 34, rnd: 30, fol: 70, trunk: 0.30, ratio: 0.80, kids: [2, 3], p3: 0.30, mid: 0.25, up: 0.10, droop: 0.55, twist: 0.08, width: 0.055, leaf: 0.022, q: 0.28, ever: false },
    cypress: { br: 9,  ang: 12, rnd: 20, fol: 85, trunk: 0.06, ratio: 0.86, kids: [2, 3], p3: 0.30, mid: 0.70, up: 0.80, droop: 0.00, twist: 0.05, width: 0.040, leaf: 0.013, q: 0.65, ever: true, leafFrom: 2, flame: true },
    olive:   { br: 8,  ang: 42, rnd: 55, fol: 70, trunk: 0.22, ratio: 0.74, kids: [2, 3], p3: 0.30, mid: 0.25, up: 0.03, droop: 0.08, twist: 0.38, width: 0.080, leaf: 0.018, q: 0.32, ever: true },
    bonsai:  { br: 6,  ang: 48, rnd: 50, fol: 80, trunk: 0.20, ratio: 0.70, kids: [2, 3], p3: 0.25, mid: 0.20, up: -0.04, droop: 0.04, twist: 0.45, width: 0.085, leaf: 0.026, q: 0.80, ever: true },
    wild:    { br: 10, ang: 38, rnd: 80, fol: 55, trunk: 0.26, ratio: 0.75, kids: [1, 3], p3: 0.40, mid: 0.35, up: 0.06, droop: 0.10, twist: 0.26, width: 0.055, leaf: 0.020, q: 0.70, ever: false }
  };

  // ---------- 1. Recipe ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function normSeed(s) {
    if (typeof s !== "string" && typeof s !== "number") return "";
    return String(s).replace(/\s+/g, " ").trim().slice(0, SEED_LEN);
  }

  // Canonical form, fixed key order; null when it is not a recipe.
  function normRecipe(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    var seed = normSeed(r.seed);
    if (!seed) return null;
    var sp = SPECIES.indexOf(r.sp) >= 0 ? r.sp : "oak", d = SP[sp];
    return {
      seed:   seed,
      sp:     sp,
      season: SEASONS.indexOf(r.season) >= 0 ? r.season : "summer",
      br:     clampInt(r.br, 4, 11, d.br),
      ang:    clampInt(r.ang, 5, 80, d.ang),
      rnd:    clampInt(r.rnd, 0, 100, d.rnd),
      fol:    clampInt(r.fol, 0, 100, d.fol),
      wind:   clampInt(r.wind, -100, 100, 0),
      ink:    INKS.indexOf(r.ink) >= 0 ? r.ink : "pencil",
      ground: GROUNDS.indexOf(r.ground) >= 0 ? r.ground : "grass"
    };
  }

  // The sliders of a species, keeping everything else.
  function withSpecies(r, sp) {
    var x = normRecipe(r) || defaultRecipe(), d = SP[sp] || SP.oak;
    x.sp = SP[sp] ? sp : "oak";
    x.br = d.br; x.ang = d.ang; x.rnd = d.rnd; x.fol = d.fol;
    return x;
  }

  function defaultRecipe() {
    return normRecipe({ seed: "orOS", sp: "oak", season: "summer", ink: "pencil", ground: "grass" });
  }

  function sameRecipe(a, b) { return JSON.stringify(normRecipe(a)) === JSON.stringify(normRecipe(b)); }

  // ---------- 2. Random numbers ----------
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function prng(seed) {               // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SYL = ["ka", "lo", "mi", "ra", "ne", "to", "su", "vi", "an", "el", "or", "is",
             "ze", "pa", "ro", "di", "mu", "fe", "ly", "no"];
  // A pronounceable seed; r() is a random number source (Math.random).
  function randomSeed(r) {
    r = r || Math.random;
    var s = "";
    for (var i = 0; i < 3; i++) s += SYL[Math.floor(r() * SYL.length)];
    return s + "-" + (100 + Math.floor(r() * 900));
  }

  // ---------- 3. Growing ----------
  function angDiff(to, from) {
    var d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // Grows the tree of a recipe. Branches are grown a level at a time
  // (breadth first), so a tree that would be too big stops evenly.
  function grow(recipe) {
    var R = normRecipe(recipe) || defaultRecipe();
    var S = SP[R.sp];
    var rnd = prng(hash32("tree|" + R.seed + "|" + R.sp));
    function rr(a, b) { return a + (b - a) * rnd(); }
    var chaos = R.rnd / 100, spread = R.ang * Math.PI / 180, wind = R.wind / 100;
    var depthMax = R.br;
    var segs = [], leaves = [], blooms = [], snow = [], fallen = [], flakes = [];
    var ends = [];                      // twig ends and leafy segments, for leaves

    // A branch: { x, y, a, len, w, d }
    var queue = [{ x: 0, y: 0, a: UP + rr(-0.06, 0.06) * (0.5 + chaos), len: S.trunk, w: S.width, d: 0 }];
    var qi = 0;
    while (qi < queue.length) {
      var b = queue[qi++];
      var frac = depthMax > 0 ? b.d / depthMax : 1;          // 0 trunk … 1 twig
      var steps = b.d === 0 ? 5 : (b.d < 3 ? 3 : (b.d >= depthMax - 2 ? 1 : 2));
      var x = b.x, y = b.y, a = b.a, w = b.w;
      var wEnd = b.w * (b.d === 0 ? 0.72 : 0.78);
      var sl = b.len / steps;
      var midDone = false;
      for (var s = 0; s < steps; s++) {
        a += rr(-1, 1) * S.twist * (0.35 + chaos) * (b.d === 0 ? 0.5 : 1);
        a += angDiff(UP, a) * S.up * (1 - frac * 0.5) * 0.35;
        if (S.droop) a += angDiff(Math.PI / 2, a) * S.droop * Math.pow(frac, 1.6) * 0.45;
        if (wind) {
          var target = UP + (wind > 0 ? 1 : -1) * Math.PI / 2 * 0.85;
          a += angDiff(target, a) * Math.abs(wind) * 0.07 * (0.25 + frac);
        }
        var x2 = x + Math.cos(a) * sl, y2 = y + Math.sin(a) * sl;
        if (y2 > -0.002 && b.d > 0) { y2 = Math.min(y2, -0.002); }   // twigs stay above the ground
        var w2 = w + (wEnd - w) / (steps - s);
        segs.push({ x1: x, y1: y, x2: x2, y2: y2, w1: w, w2: w2, d: b.d });
        if (b.d >= (S.leafFrom !== undefined ? S.leafFrom : depthMax - (S.ever ? 3 : 2))) ends.push({ x: x2, y: y2, a: a, d: b.d, tip: false });
        // a side branch half way
        if (!midDone && s === Math.floor(steps / 2) && b.d > 0 && b.d < depthMax - 1 &&
            rnd() < S.mid * (0.6 + chaos * 0.6) && segs.length + (queue.length - qi) * 2 < MAX_SEGS) {
          midDone = true;
          var side = rnd() < 0.5 ? -1 : 1;
          queue.push({ x: x2, y: y2, a: a + side * spread * rr(0.7, 1.3), len: b.len * S.ratio * rr(0.45, 0.7),
                       w: w2 * 0.55, d: b.d + 2 });
        }
        x = x2; y = y2; w = w2;
      }
      if (b.d >= depthMax || segs.length + (queue.length - qi) * 2 > MAX_SEGS) {
        ends.push({ x: x, y: y, a: a, d: b.d, tip: true });
        continue;
      }
      var k = S.kids[0];
      if (S.kids[1] > k && rnd() < S.p3 * (0.7 + chaos * 0.6)) k++;
      if (S.kids[1] > k + 1 && rnd() < S.p3 * 0.5) k++;
      for (var c = 0; c < k; c++) {
        var off = k === 1 ? rr(-0.5, 0.5) * spread : (-spread + 2 * spread * c / (k - 1));
        off += rr(-0.5, 0.5) * spread * chaos;
        var main = Math.abs(off) < spread * 0.35;
        var len = b.len * S.ratio * rr(1 - 0.3 * chaos, 1 + 0.12 * chaos) * (main && S.up > 0.2 ? 1.08 : 1);
        queue.push({ x: x, y: y, a: a + off, len: len, w: wEnd * rr(0.66, 0.82), d: b.d + 1 });
      }
    }

    // A cypress keeps the shape of a flame: widest low, narrow at the top.
    if (S.flame) {
      var top = 0, far = 0.01;
      segs.forEach(function (g) { top = Math.min(top, g.y2); far = Math.max(far, Math.abs(g.x2)); });
      var Ht = Math.max(0.2, -top), squeeze = 0.17 * Ht / far;
      var env = function (y) {
        var t = Math.max(0, Math.min(1, -y / Ht));
        return Math.max(0.12, Math.sin(Math.PI * (0.12 + 0.88 * t))) * (1 - 0.3 * t) * squeeze;
      };
      segs.forEach(function (g) { g.x1 *= env(g.y1); g.x2 *= env(g.y2); g.w1 = Math.min(g.w1, 0.06); });
      ends.forEach(function (en) { en.x *= env(en.y); });
    }

    // How tall and wide the tree grew.
    var box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    segs.forEach(function (g) {
      box.x0 = Math.min(box.x0, g.x1, g.x2); box.x1 = Math.max(box.x1, g.x1, g.x2);
      box.y0 = Math.min(box.y0, g.y1, g.y2); box.y1 = Math.max(box.y1, g.y1, g.y2);
    });
    var H = Math.max(0.2, -box.y0);

    // Leaves: how many, which colours.
    var deciduous = !S.ever;
    var leafSet = R.sp === "olive" ? "olive" :
      (R.season === "autumn" && deciduous ? "autumn" :
       R.season === "winter" ? "winter" :
       R.season === "spring" ? "spring" : "summer");
    var amount = R.fol / 100;
    if (deciduous) amount *= R.season === "spring" ? 0.55 : (R.season === "autumn" ? 0.7 : (R.season === "winter" ? 0 : 1));
    var leafR = S.leaf * (0.8 + 0.4 * (1 - amount));
    var perTip = 2 + Math.round(amount * 6), perEnd = Math.round(amount * 2.2);
    // spread evenly: a big tree gets fewer leaves per twig, not bare tips
    var nTips = 0;
    ends.forEach(function (en) { if (en.tip) nTips++; });
    var expect = nTips * perTip + (ends.length - nTips) * amount * perEnd;
    var share = expect > 0 ? Math.min(1, MAX_LEAVES * 0.96 / expect) : 1;
    function some(n) { var v = n * share, f = Math.floor(v); return f + (rnd() < v - f ? 1 : 0); }
    if (amount > 0) {
      for (var e = 0; e < ends.length && leaves.length < MAX_LEAVES; e++) {
        var en = ends[e], n = some(en.tip ? perTip : (rnd() < amount ? perEnd : 0));
        var spreadR = (en.tip ? 2.4 : 1.6) * leafR;
        for (var l = 0; l < n && leaves.length < MAX_LEAVES; l++) {
          var la = rnd() * TAU, ld = Math.sqrt(rnd()) * spreadR;
          var lx = en.x + Math.cos(la) * ld, ly = en.y + Math.sin(la) * ld * (R.sp === "bonsai" ? 0.45 : 1);
          if (ly > -0.004) continue;
          var rot = R.sp === "willow" ? Math.PI / 2 + rr(-0.35, 0.35) + wind * 0.4 : (en.a + rr(-1.2, 1.2));
          leaves.push({ x: lx, y: ly, r: leafR * rr(0.75, 1.25), q: S.q * rr(0.85, 1.15), rot: rot,
                        c: Math.floor(rnd() * 4), s: Math.min(1, Math.pow(-ly / H, 1.5)) });
        }
      }
    }

    // Spring blossoms at the tips; autumn leaves on the ground.
    if (R.season === "spring" && R.fol > 0) {
      var nb = Math.min(MAX_BLOOMS, Math.round(ends.length * 0.5 * (0.3 + R.fol / 100)));
      for (var i = 0; i < nb; i++) {
        var t = ends[Math.floor(rnd() * ends.length)];
        if (!t || t.y > -0.01) continue;
        blooms.push({ x: t.x + rr(-1, 1) * leafR * 1.5, y: t.y + rr(-1, 1) * leafR * 1.5,
                      r: leafR * rr(0.45, 0.75) * (R.sp === "olive" ? 0.6 : 1), c: Math.floor(rnd() * 3) });
      }
    }
    var crownW = Math.max(0.15, box.x1 - box.x0);
    var cx = (box.x0 + box.x1) / 2;
    if (R.season === "autumn" && R.fol > 0) {
      var nf = Math.round((deciduous ? 70 : 12) * (0.3 + R.fol / 100));
      for (i = 0; i < nf; i++) {
        var air = rnd() < 0.18;
        fallen.push({ x: cx + rr(-0.6, 0.6) * crownW + (air ? wind * 0.15 : 0),
                      y: air ? -rr(0.03, H * 0.6) : rr(-0.012, 0.012),
                      r: S.leaf * rr(0.8, 1.2), rot: rr(0, TAU), c: Math.floor(rnd() * 4), air: air });
      }
    }
    if (R.season === "winter") {
      segs.forEach(function (g) {
        var dx = g.x2 - g.x1, dy = g.y2 - g.y1, L = Math.sqrt(dx * dx + dy * dy) || 1;
        var level = Math.abs(dx) / L;                  // 1 = flat: snow stays on it
        if (g.d < depthMax - 1 && level > 0.45 && rnd() < level) {
          snow.push({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, w: Math.max(g.w1, g.w2) * (0.5 + level * 0.5) });
        }
      });
      if (S.ever) {
        leaves.forEach(function (lf) { if (rnd() < 0.18 && lf.s > 0.25) lf.snow = 1; });
      }
      for (i = 0; i < 90; i++) {
        flakes.push({ x: cx + rr(-1.1, 1.1) * Math.max(crownW, H * 0.8), y: -rr(0, H * 1.15), r: rr(0.003, 0.008) });
      }
    }

    // box of everything drawn, leaves included
    leaves.concat(blooms).forEach(function (p) {
      box.x0 = Math.min(box.x0, p.x - p.r); box.x1 = Math.max(box.x1, p.x + p.r);
      box.y0 = Math.min(box.y0, p.y - p.r);
    });
    H = Math.max(0.2, -box.y0);
    segs.forEach(function (g) { g.s = Math.min(1, Math.pow(Math.max(0, -Math.min(g.y1, g.y2)) / H, 1.5)) * (g.d / Math.max(1, depthMax)); });
    leaves.forEach(function (lf) { lf.s = Math.min(1, Math.pow(-lf.y / H, 1.5)); });

    return {
      seed: R.seed, sp: R.sp, season: R.season, ink: R.ink, ground: R.ground, wind: R.wind,
      leafSet: leafSet, ever: S.ever,
      segs: segs, leaves: leaves, blooms: blooms, snow: snow, fallen: fallen, flakes: flakes,
      box: box, height: H
    };
  }

  // Scale and origin that fit the tree into w × h pixels with the
  // ground at a fixed line. Returns { k, ox, oy } (screen = o + unit * k).
  function fit(model, w, h, o) {
    o = o || {};
    var b = model.box;
    var groundY = h * (o.ground !== undefined ? o.ground : 0.88);
    var top = h * (o.top !== undefined ? o.top : 0.06);
    var bw = Math.max(0.2, b.x1 - b.x0), bh = Math.max(0.2, -b.y0);
    var k = Math.min((groundY - top) / bh, (w * (o.width !== undefined ? o.width : 0.9)) / bw);
    var cx = o.cx !== undefined ? w * o.cx : w / 2;
    return { k: k, ox: cx - (b.x0 + b.x1) / 2 * k, oy: groundY };
  }

  // ---------- 4. Looks ----------
  // Colours of the four drawing styles. leaf[set] = 4 colours;
  // bg = [top, bottom] of the picture.
  var LEAF_COLOUR = {
    spring: ["#9ccc65", "#7cb342", "#c5e1a5", "#aed581"],
    summer: ["#2e7d32", "#43a047", "#388e3c", "#66bb6a"],
    autumn: ["#e65100", "#f9a825", "#c62828", "#ef6c00"],
    winter: ["#1b5e20", "#2e5d3a", "#33691e", "#28533a"],
    olive:  ["#8a9a5b", "#a3b18a", "#6b7f4e", "#b5c19a"]
  };
  var SKY = {
    spring: ["#dceff9", "#fbf6ea"], summer: ["#bfe0f6", "#f4fbff"],
    autumn: ["#f3dcc0", "#fbf3e6"], winter: ["#d6e0ea", "#f3f6f9"]
  };
  function fill4(c) { return [c, c, c, c]; }
  function look(ink, season) {
    season = SEASONS.indexOf(season) >= 0 ? season : "summer";
    if (ink === "ink") {
      var ik = "#1d1b19";
      return { ink: "ink", bg: ["#fbfaf6", "#fbfaf6"], line: ik, trunk: ik,
               leaf: { spring: fill4(ik), summer: fill4(ik), autumn: fill4(ik), winter: fill4(ik), olive: fill4(ik) },
               bloom: [ik, ik, ik], ground: ik, grass: ik, snow: null, flake: ik, paper: true };
    }
    if (ink === "chalk") {
      var ch = "#f1efe6";
      return { ink: "chalk", bg: ["#2a3d33", "#22322a"], line: ch, trunk: ch,
               leaf: { spring: ["#d7f2b8", "#eef8d8", "#c8e8a0", "#e2f5c6"],
                       summer: ["#bfe6b0", "#d8f0cc", "#a8dc98", "#cdebc0"],
                       autumn: ["#ffd29a", "#ffb08a", "#ffe6a0", "#f7c08e"],
                       winter: ["#c6e2cf", "#b6d8c0", "#d6ecdc", "#bcd9c6"],
                       olive:  ["#dbe4c4", "#cfdab3", "#e6ecd4", "#c4d0a6"] },
               bloom: ["#ffd1e1", "#ffffff", "#ffc0d6"], ground: ch, grass: "#cfe8c0", snow: "#ffffff", flake: "#ffffff", paper: false };
    }
    if (ink === "colour") {
      return { ink: "colour", bg: SKY[season], line: "#5d4037", trunk: "#6d4c35",
               leaf: LEAF_COLOUR, bloom: ["#f8bbd0", "#ffffff", "#f48fb1"],
               ground: season === "winter" ? "#f4f6f8" : (season === "autumn" ? "#a1887f" : "#7cb342"),
               grass: season === "winter" ? "#cfd8dc" : (season === "autumn" ? "#8d6e63" : "#558b2f"),
               snow: "#ffffff", flake: "#ffffff", paper: false };
    }
    var pc = "#3b3a38";                 // pencil
    return { ink: "pencil", bg: ["#f6f1e5", "#f2ecdf"], line: pc, trunk: pc,
             leaf: { spring: fill4("#5a5955"), summer: fill4("#4a4946"), autumn: fill4("#5a5955"), winter: fill4("#4a4946"), olive: fill4("#5a5955") },
             bloom: ["#6a6965", "#6a6965", "#6a6965"], ground: pc, grass: pc, snow: null, flake: "#6a6965", paper: true };
  }

  // ---------- 5. Painting ----------
  // A pen draws in screen pixels:
  //   stroke(pts, w, col, a)            open polyline [x0, y0, x1, y1, …]
  //   fill(pts, col, a)                 closed polygon
  //   ell(x, y, rx, ry, rot, col, a, lw) ellipse: filled when lw is 0
  // o = { k, ox, oy, upto (0..1 how much has grown), sway(x, y, s) → dx, w, h }
  // The jitter of the sketch comes from the seed, in drawing order,
  // so a part looks the same in every frame.
  function paint(model, L, pen, o) {
    var k = o.k, ox = o.ox, oy = o.oy;
    var rnd = prng(hash32("paint|" + model.seed + "|" + L.ink));
    function J(a) { return (rnd() * 2 - 1) * a; }
    var sway = o.sway || null;
    var upto = o.upto === undefined ? 1 : o.upto;
    var nSeg = model.segs.length;
    var segCount = Math.floor(nSeg * Math.min(1, upto / 0.75));
    var leafPart = Math.max(0, Math.min(1, (upto - 0.6) / 0.4));
    function X(x, y, s) { return ox + x * k + (sway && s ? sway(x, y, s) : 0); }
    function Y(y) { return oy + y * k; }
    var px = Math.max(0.35, k / 900);   // a hair line, in pixels

    paintGround(model, L, pen, o, rnd);

    // Branches
    for (var i = 0; i < nSeg; i++) {
      var g = model.segs[i];
      var x1 = X(g.x1, g.y1, g.s * 0.6), y1 = Y(g.y1), x2 = X(g.x2, g.y2, g.s), y2 = Y(g.y2);
      var w1 = Math.max(px * 1.6, g.w1 * k), w2 = Math.max(px * 1.4, g.w2 * k);
      var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var jit = [J(1), J(1), J(1), J(1), J(1), J(1)];
      if (i >= segCount) continue;
      if (L.ink === "colour" || L.ink === "ink") {
        var col = L.ink === "colour" ? shade(L.trunk, g.d) : L.line;
        pen.fill([x1 + nx * w1 / 2, y1 + ny * w1 / 2, x2 + nx * w2 / 2, y2 + ny * w2 / 2,
                  x2 - nx * w2 / 2, y2 - ny * w2 / 2, x1 - nx * w1 / 2, y1 - ny * w1 / 2], col, 1);
        if (w2 > 1.2) pen.ell(x2, y2, w2 / 2, w2 / 2, 0, col, 1, 0);
        if (L.ink === "ink" && w1 > 6) {          // a few lines of bark
          pen.stroke([x1 + nx * w1 * 0.15, y1 + ny * w1 * 0.15, x2 + nx * w2 * 0.1 + jit[0], y2 + ny * w2 * 0.1], px * 1.2, "#fbfaf6", 0.55);
        }
      } else {
        // pencil and chalk: edges for thick parts, wobbly strokes for thin
        var a = L.ink === "chalk" ? 0.85 : 0.78;
        var j = Math.min(1.6, 0.3 + w1 * 0.06);
        if (w1 > 4) {
          pen.stroke([x1 + nx * w1 / 2 + jit[0] * j, y1 + ny * w1 / 2 + jit[1] * j, x2 + nx * w2 / 2 + jit[2] * j, y2 + ny * w2 / 2 + jit[3] * j], px * 2, L.line, a);
          pen.stroke([x1 - nx * w1 / 2 + jit[4] * j, y1 - ny * w1 / 2 + jit[5] * j, x2 - nx * w2 / 2 + jit[1] * j, y2 - ny * w2 / 2 + jit[0] * j], px * 2, L.line, a);
          // hatching across the bark on one side
          var hn = Math.min(14, Math.floor(len / Math.max(4, w1 * 0.35)));
          for (var hcount = 0; hcount < hn; hcount++) {
            var t = (hcount + 0.5) / hn, ww = w1 + (w2 - w1) * t;
            var hx = x1 + dx * t, hy = y1 + dy * t;
            pen.stroke([hx - nx * ww * 0.45, hy - ny * ww * 0.45, hx - nx * ww * 0.05 + dx / len * ww * 0.25, hy - ny * ww * 0.05 + dy / len * ww * 0.25],
                       px * 1.2, L.line, a * 0.55);
          }
          if (L.ink === "chalk") pen.fill([x1 + nx * w1 / 2, y1 + ny * w1 / 2, x2 + nx * w2 / 2, y2 + ny * w2 / 2,
                                           x2 - nx * w2 / 2, y2 - ny * w2 / 2, x1 - nx * w1 / 2, y1 - ny * w1 / 2], L.line, 0.14);
        } else {
          var lw = Math.max(px * 1.4, (w1 + w2) / 2);
          pen.stroke([x1, y1, (x1 + x2) / 2 + nx * jit[0] * j, (y1 + y2) / 2 + ny * jit[0] * j, x2, y2], lw, L.line, a);
          if (L.ink === "chalk" || w1 > 1.8) pen.stroke([x1 + jit[2] * 0.6, y1 + jit[3] * 0.6, x2 + jit[4] * 0.6, y2 + jit[5] * 0.6], Math.max(px, lw * 0.5), L.line, a * 0.45);
        }
      }
    }

    // Snow on the branches
    if (L.snow && segCount >= nSeg) {
      model.snow.forEach(function (s) {
        var sx1 = X(s.x1, s.y1, 0), sy1 = Y(s.y1), sx2 = X(s.x2, s.y2, 0), sy2 = Y(s.y2);
        var sw = Math.max(1.2, Math.min(s.w * k * 0.4, k * 0.007));     // a thin cap of snow
        var lift = Math.min(s.w * k * 0.45, sw * 2);
        pen.stroke([sx1, sy1 - lift, sx2, sy2 - lift], sw, L.snow, 0.92);
      });
    }

    // Leaves
    var set = L.leaf[model.leafSet] || L.leaf.summer;
    var nl = Math.floor(model.leaves.length * leafPart);
    var la = Math.min(0.75, Math.max(0.3, 1500 / Math.max(1, model.leaves.length)));   // dense trees: lighter loops
    for (i = 0; i < model.leaves.length; i++) {
      var lf = model.leaves[i];
      var jj = J(1);
      if (i >= nl) continue;
      var lx = X(lf.x, lf.y, lf.s), ly = Y(lf.y), r = Math.max(0.9, lf.r * k);
      var c = lf.snow && L.snow ? L.snow : set[lf.c % set.length];
      if (L.ink === "colour") pen.ell(lx, ly, r, Math.max(0.6, r * lf.q), lf.rot, c, 0.88, 0);
      else if (L.ink === "ink") {
        if (lf.c === 0 || r < 2) pen.ell(lx, ly, r, Math.max(0.5, r * lf.q), lf.rot, c, 0.95, 0);
        else pen.ell(lx, ly, r, Math.max(0.5, r * lf.q), lf.rot, c, Math.min(0.9, la + 0.15), px * 1.3);
      } else if (L.ink === "chalk") {
        pen.ell(lx, ly, r, Math.max(0.6, r * lf.q), lf.rot + jj * 0.2, c, 0.7, 0);
      } else {
        // pencil: a scribbled loop, some shaded
        pen.ell(lx, ly, r, Math.max(0.6, r * lf.q), lf.rot + jj * 0.3, c, la, px * 1.3);
        if (lf.c === 1) pen.ell(lx, ly, r * 0.8, Math.max(0.5, r * lf.q * 0.8), lf.rot, c, 0.25, 0);
      }
    }

    // Blossoms
    var nbl = Math.floor(model.blooms.length * leafPart);
    for (i = 0; i < nbl; i++) {
      var bl = model.blooms[i], bx = X(bl.x, bl.y, 0.6), by = Y(bl.y), br = Math.max(1, bl.r * k);
      var bc = L.bloom[bl.c % L.bloom.length];
      if (L.paper) pen.ell(bx, by, br, br, 0, bc, 0.8, px * 1.2);
      else {
        pen.ell(bx, by, br, br, 0, bc, 0.92, 0);
        if (br > 2.5) pen.ell(bx, by, br * 0.3, br * 0.3, 0, L.ink === "colour" ? "#f9a825" : "#fff6b0", 0.9, 0);
      }
    }

    // Leaves that fell, and snowflakes
    if (leafPart >= 1) {
      var aset = L.leaf.autumn || set;
      model.fallen.forEach(function (f) {
        var fc = (model.ever ? set : aset)[f.c % 4];
        var fx = X(f.x, f.y, 0), fy = Y(f.y), fr = Math.max(1, f.r * k);
        if (L.paper) pen.ell(fx, fy, fr, fr * 0.55, f.rot, fc, 0.7, px * 1.2);
        else pen.ell(fx, fy, fr, fr * 0.55, f.rot, fc, 0.85, 0);
      });
      model.flakes.forEach(function (f) {
        var fx = X(f.x, f.y, 0), fy = Y(f.y), fr = Math.max(0.8, f.r * k);
        if (fy < 0 || fy > oy) return;
        if (L.paper) pen.ell(fx, fy, fr, fr, 0, L.flake, 0.6, px * 1.1);
        else pen.ell(fx, fy, fr, fr, 0, L.flake, 0.85, 0);
      });
    }
  }

  function paintGround(model, L, pen, o, rnd) {
    if (model.ground === "none") return;
    var k = o.k, ox = o.ox, oy = o.oy, W = o.w || (ox * 2), px = Math.max(0.35, k / 900);
    var winter = model.season === "winter";
    if (model.ground === "hill") {
      var hw = Math.max(W * 0.65, (model.box.x1 - model.box.x0) * k * 0.9), hh = Math.min(k * 0.09, hw * 0.12);
      var cx = ox, pts = [], n = 40, i;
      for (i = 0; i <= n; i++) {
        var t = i / n, xx = cx - hw + 2 * hw * t;
        pts.push(xx, oy + hh * (1 - Math.sin(Math.PI * t)) - hh * 0.15 + (rnd() * 2 - 1) * px);
      }
      if (L.paper || L.ink === "chalk") {
        pen.stroke(pts, px * 2.2, L.ground, 0.8);
        for (i = 0; i < 26; i++) {                      // a few strokes of shade
          var s = 0.15 + rnd() * 0.7, sx = cx - hw + 2 * hw * s;
          var sy = oy + hh * (1 - Math.sin(Math.PI * s)) - hh * 0.15;
          pen.stroke([sx, sy + 3, sx + 7, sy + 7], px * 1.2, L.ground, 0.4);
        }
      } else {
        var poly = pts.concat([cx + hw, oy + hh * 4, cx - hw, oy + hh * 4]);
        pen.fill(poly, L.ground, 1);
      }
    } else {
      var gw = Math.max(W * 0.42, (model.box.x1 - model.box.x0) * k * 0.7);
      pen.stroke([ox - gw, oy + 1, ox - gw * 0.3, oy + (rnd() * 2 - 1) * px * 2, ox + gw * 0.4, oy + (rnd() * 2 - 1) * px * 2, ox + gw, oy + 1],
                 px * (L.paper ? 2 : 2.6), winter && L.snow ? L.snow : L.ground, L.paper ? 0.75 : 0.9);
      var tufts = Math.round(gw / 7);
      for (var q = 0; q < tufts; q++) {
        var gx = ox - gw + rnd() * gw * 2, gh = (2 + rnd() * 5) * Math.max(1, k / 420);
        var lean = (model.wind / 100) * gh * 0.6 + (rnd() * 2 - 1) * gh * 0.3;
        pen.stroke([gx, oy, gx + lean, oy - gh], px * 1.3, winter && L.snow ? L.snow : L.grass, L.paper ? 0.6 : 0.85);
      }
    }
  }

  // Older branches darker, twigs lighter (colour style).
  function shade(hex, d) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    var v = parseInt(m[1], 16), f = Math.min(0.35, d * 0.04);
    var r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    r = Math.round(r + (200 - r) * f * 0.6); g = Math.round(g + (170 - g) * f * 0.6); b = Math.round(b + (140 - b) * f * 0.6);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // A pen that draws on a canvas 2D context.
  function canvasPen(ctx) {
    function path(pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    }
    return {
      stroke: function (pts, w, col, a) {
        path(pts);
        ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.stroke();
      },
      fill: function (pts, col, a) {
        path(pts); ctx.closePath();
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fill();
      },
      ell: function (x, y, rx, ry, rot, col, a, lw) {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
        ctx.globalAlpha = a;
        if (lw) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); }
      }
    };
  }

  // A pen that writes SVG elements; .out() returns them.
  function svgPen() {
    var parts = [];
    function n(v) { return (Math.round(v * 10) / 10).toString(); }
    function al(a) { return a < 1 ? ' opacity="' + (Math.round(a * 100) / 100) + '"' : ""; }
    return {
      stroke: function (pts, w, col, a) {
        var d = "M" + n(pts[0]) + " " + n(pts[1]);
        for (var i = 2; i < pts.length; i += 2) d += "L" + n(pts[i]) + " " + n(pts[i + 1]);
        parts.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + n(Math.max(0.2, w)) +
                   '" stroke-linecap="round" stroke-linejoin="round"' + al(a) + "/>");
      },
      fill: function (pts, col, a) {
        var d = "M" + n(pts[0]) + " " + n(pts[1]);
        for (var i = 2; i < pts.length; i += 2) d += "L" + n(pts[i]) + " " + n(pts[i + 1]);
        parts.push('<path d="' + d + 'Z" fill="' + col + '"' + al(a) + "/>");
      },
      ell: function (x, y, rx, ry, rot, col, a, lw) {
        var t = rot ? ' transform="rotate(' + n(rot * 180 / Math.PI) + " " + n(x) + " " + n(y) + ')"' : "";
        var paintAttr = lw ? 'fill="none" stroke="' + col + '" stroke-width="' + n(lw) + '"' : 'fill="' + col + '"';
        parts.push('<ellipse cx="' + n(x) + '" cy="' + n(y) + '" rx="' + n(rx) + '" ry="' + n(ry) + '" ' + paintAttr + t + al(a) + "/>");
      },
      out: function () { return parts.join("\n"); },
      count: function () { return parts.length; }
    };
  }

  // The whole picture as an SVG document (w × h pixels).
  function toSVG(recipe, w, h, title) {
    var R = normRecipe(recipe) || defaultRecipe();
    var model = grow(R), L = look(R.ink, R.season);
    var f = fit(model, w, h);
    var pen = svgPen();
    paint(model, L, pen, { k: f.k, ox: f.ox, oy: f.oy, w: w, h: h });
    var esc = String(title || "Tree").replace(/[<>&"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[c];
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">\n' +
      "<title>" + esc + "</title>\n" +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + L.bg[0] +
      '"/><stop offset="1" stop-color="' + L.bg[1] + '"/></linearGradient></defs>\n' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#bg)"/>\n' +
      pen.out() + "\n</svg>\n";
  }

  // ---------- 6. Saved trees ----------
  function cleanName(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_LEN);
  }

  function normTree(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    if (!isInt(raw.m) || raw.m < 0) return null;
    var r = normRecipe(raw.r);
    if (!r) return null;
    return { id: raw.id, m: raw.m, name: cleanName(raw.name) || r.seed, r: r };
  }

  function mergeTrees(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.trees, b.trees].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var t = normTree(raw);
        if (!t) return;
        var cur = best[t.id];
        if (!cur || t.m > cur.m ||
            (t.m === cur.m && JSON.stringify(t) > JSON.stringify(cur))) best[t.id] = t;
      });
    });
    var trees = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      trees.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, trees: trees, tombs: sortedTombs };
  }

  function findTree(dat, id) {
    for (var i = 0; i < dat.trees.length; i++) if (dat.trees[i].id === id) return dat.trees[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(r) {
    var s = "t";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  function fileName(name, ext) {
    var base = String(name || "").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "").slice(0, 50);
    return "tree-" + (base || "sketch") + "." + ext;
  }

  // ---------- 7. Wallpaper bridge ----------
  // The Wallpaper Generator's "Tree" style keeps the shape of the
  // tree in recipe.tree; density and chaos stand for foliage and
  // randomness, and the colours come from the wallpaper palette.
  function wallParams(t) {
    if (!t || typeof t !== "object" || Array.isArray(t)) t = {};
    var sp = SPECIES.indexOf(t.sp) >= 0 ? t.sp : "oak", d = SP[sp];
    return {
      sp:     sp,
      season: SEASONS.indexOf(t.season) >= 0 ? t.season : "summer",
      br:     clampInt(t.br, 4, 11, d.br),
      ang:    clampInt(t.ang, 5, 80, d.ang),
      wind:   clampInt(t.wind, -100, 100, 0),
      ink:    INKS.indexOf(t.ink) >= 0 ? t.ink : "colour",
      ground: GROUNDS.indexOf(t.ground) >= 0 ? t.ground : "hill"
    };
  }

  // Tree Sketcher recipe → wallpaper recipe (palette chosen to suit).
  var WALL_PAL = {
    pencil: ["mono", 1], ink: ["mono", 1], chalk: ["forest", 0],
    spring: ["pastel", 1], summer: ["forest", 1], autumn: ["ember", 1], winter: ["ocean", 0]
  };
  function toWallRecipe(recipe) {
    var R = normRecipe(recipe) || defaultRecipe();
    var p = R.ink === "colour" ? WALL_PAL[R.season] : WALL_PAL[R.ink];
    return {
      seed: R.seed, style: "tree", pal: p[0], dens: R.fol, chaos: R.rnd,
      grain: R.ink === "pencil" || R.ink === "chalk" ? 1 : 0, light: p[1],
      tree: wallParams({ sp: R.sp, season: R.season, br: R.br, ang: R.ang, wind: R.wind, ink: R.ink, ground: R.ground })
    };
  }

  // Wallpaper recipe → Tree Sketcher recipe.
  function fromWallRecipe(w) {
    if (!w || typeof w !== "object") return null;
    var t = wallParams(w.tree);
    return normRecipe({ seed: w.seed, sp: t.sp, season: t.season, br: t.br, ang: t.ang,
                        rnd: w.chaos, fol: w.dens, wind: t.wind, ink: t.ink, ground: t.ground });
  }

  // The look of a wallpaper tree, from the wallpaper colours
  // C = { bg, ink[], light } (OrosWallArt.colors).
  function wallLook(C, t, mix) {
    var p = wallParams(t);
    var dark = !C.light;
    var line = mix(C.ink[2] || C.ink[0], dark ? "#ffffff" : "#000000", dark ? 0.55 : 0.6);
    var inks = C.ink.slice(0, 4);
    while (inks.length < 4) inks.push(C.ink[0]);
    var warm = [C.ink[0], C.ink[3] || C.ink[1], C.ink[1], C.ink[4] || C.ink[2]];
    var sketch = p.ink === "pencil" || p.ink === "ink";
    var leafCol = sketch ? [line, line, line, line] : inks;
    return {
      ink: p.ink, bg: [C.bg, C.bg], line: line, trunk: line,
      leaf: { spring: leafCol, summer: leafCol, autumn: sketch ? leafCol : warm, winter: leafCol, olive: leafCol },
      bloom: [mix(C.ink[1] || C.ink[0], "#ffffff", 0.5), "#ffffff", mix(C.ink[0], "#ffffff", 0.3)],
      ground: mix(C.bg, line, 0.35), grass: mix(C.bg, line, 0.55),
      snow: dark || p.ink === "colour" ? "#ffffff" : null, flake: dark ? "#ffffff" : line,
      paper: sketch && !dark
    };
  }

  var api = {
    VER: DATA_VER, MAX_TREES: MAX_TREES, SEED_LEN: SEED_LEN, NAME_LEN: NAME_LEN,
    SPECIES: SPECIES.slice(), SEASONS: SEASONS.slice(), INKS: INKS.slice(), GROUNDS: GROUNDS.slice(),
    speciesDefaults: function (sp) { var d = SP[sp] || SP.oak; return { br: d.br, ang: d.ang, rnd: d.rnd, fol: d.fol }; },
    isEvergreen: function (sp) { return !!(SP[sp] && SP[sp].ever); },
    normRecipe: normRecipe, defaultRecipe: defaultRecipe, withSpecies: withSpecies, sameRecipe: sameRecipe,
    hash32: hash32, prng: prng, randomSeed: randomSeed,
    grow: grow, fit: fit, look: look, paint: paint, canvasPen: canvasPen, svgPen: svgPen, toSVG: toSVG,
    cleanName: cleanName, normTree: normTree, mergeTrees: mergeTrees, findTree: findTree,
    newestFirst: newestFirst, newId: newId, fileName: fileName,
    wallParams: wallParams, toWallRecipe: toWallRecipe, fromWallRecipe: fromWallRecipe, wallLook: wallLook
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TreesCore = api;
})(typeof window !== "undefined" ? window : this);
