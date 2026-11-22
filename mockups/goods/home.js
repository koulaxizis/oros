// ============================================================
// orOS Mockups — goods/home.js (v1.0.0)
// Mug, framed poster and postcard / greeting card: the pure part (no
// DOM, no three.js; Node-tested in tests/mockups.test.js). Registers
// "mug", "poster" and "card" with MockCore.addGood(); sheets in the
// shape of MockCore.template() (print.js draws them), options
// described for the app's generated form (as goods/small.js).
// Sizes are common published ones (11 oz mug Ø 82 × 95 mm with a
// 216 × 89 mm wrap, 15 oz Ø 86 × 117 mm with 216 × 100; ISO A and
// photo poster sizes; A6, A5, DL and square cards); the maker's own
// template always wins. The 3D part is goods/home3d.js.
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  var MM = root.MockMedia || (typeof require === "function" ? require("./media.js") : null);
  if (!C || !MM) return;
  var pick = MM.pick, bit = MM.bit, sheet = MM.sheet, bleedOf = MM.bleedOf, safeOf = MM.safeOf;

  // ---------- Mug ----------
  var OZ = [11, 15];
  var MCOLS = ["white", "black", "red", "blue", "yellow", "green"];
  var MFINS = ["gloss", "matte"];
  function mugNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { oz: pick(g.oz, OZ, 11), inner: pick(g.inner, MCOLS, "white"), handle: pick(g.handle, MCOLS, "white"), fin: pick(g.fin, MFINS, "gloss") };
  }
  function mugDims(g) {
    g = mugNorm(g);
    return g.oz === 15 ? { w: 86, h: 117, d: 86, print: { w: 216, h: 100 } } : { w: 82, h: 95, d: 82, print: { w: 216, h: 89 } };
  }
  function mugTemplate(p) {
    var D = mugDims(p.g);
    return sheet("mugwrap", [["wrap", "wrap", D.print.w]], D.print.h, bleedOf(p), safeOf(p));
  }

  // ---------- Framed poster ----------
  var PSIZES = ["a4", "a3", "a2", "a1", "30x40", "50x70", "61x91"];
  var PMM = { a4: [210, 297], a3: [297, 420], a2: [420, 594], a1: [594, 841], "30x40": [300, 400], "50x70": [500, 700], "61x91": [610, 915] };
  var ORIENTS = ["portrait", "landscape"];
  var FRAMES = ["black", "white", "oak", "walnut", "alu", "none"];
  var WALLS = ["none", "light", "dark"];
  function posterNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { size: pick(g.size, PSIZES, "a3"), orient: pick(g.orient, ORIENTS, "portrait"), frame: pick(g.frame, FRAMES, "black"), mat: bit(g.mat), wall: pick(g.wall, WALLS, "light") };
  }
  function posterDims(g) {
    g = posterNorm(g);
    var s = PMM[g.size], w = s[0], h = s[1];
    if (g.orient === "landscape") { w = s[1]; h = s[0]; }
    var mat = g.mat ? Math.round(Math.min(w, h) * 0.12) : 0, bar = g.frame === "none" ? 0 : Math.max(15, Math.round(Math.min(w, h) * 0.05));
    // the mat window covers 4 mm of the poster's edge
    return { w: w + 2 * mat + 2 * bar, h: h + 2 * mat + 2 * bar, d: g.frame === "none" ? 1 : 22, poster: { w: w, h: h }, mat: mat, bar: bar, lip: mat ? 4 : 5 };
  }
  function posterTemplate(p) {
    var D = posterDims(p.g);
    var T = sheet("poster", [["front", "front", D.poster.w]], D.poster.h, bleedOf(p), safeOf(p));
    T.hidden = p.g.frame === "none" ? 0 : D.lip;    // mm of the edge under the frame or the mat
    return T;
  }

  // ---------- Postcard / greeting card ----------
  var CSIZES = ["a6", "a5", "dl", "sq"];
  var CMM = { a6: [105, 148], a5: [148, 210], dl: [99, 210], sq: [148, 148] };
  var CKINDS = ["flat", "folded"];
  var ENVS = ["none", "white", "kraft", "black"];
  function cardNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { ck: pick(g.ck, CKINDS, "flat"), size: pick(g.size, CSIZES, "a6"), orient: pick(g.orient, ORIENTS, "portrait"), env: pick(g.env, ENVS, "none") };
  }
  // w × h of one panel (the closed card), mm
  function cardDims(g) {
    g = cardNorm(g);
    var s = CMM[g.size], w = s[0], h = s[1];
    if (g.orient === "landscape") { w = s[1]; h = s[0]; }
    return { w: w, h: h, d: g.ck === "folded" ? 0.7 : 0.35, env: { w: w + 6, h: h + 6 } };
  }
  function cardSheets(p) { return p.g.ck === "folded" ? ["gcout", "gcin"] : ["pcfront", "pcback"]; }
  function cardTemplate(p, s) {
    var D = cardDims(p.g), bl = bleedOf(p), sf = safeOf(p);
    if (p.g.ck === "folded") {
      if (s === "gcin") return sheet("gcin", [["inside", "inside", D.w], ["inside2", "inside2", D.w]], D.h, bl, sf);
      return sheet("gcout", [["back", "back", D.w], ["front", "front", D.w]], D.h, bl, sf);
    }
    if (s === "pcback") return sheet("pcback", [["back", "back", D.w]], D.h, bl, sf);
    return sheet("pcfront", [["front", "front", D.w]], D.h, bl, sf);
  }

  var OPTS = {
    mug: [{ k: "oz", t: "seg", v: OZ, p: "oz.", l: "f.oz" }, { k: "inner", t: "sel", v: MCOLS, p: "col.", l: "f.minner" },
      { k: "handle", t: "sel", v: MCOLS, p: "col.", l: "f.mhandle" }, { k: "fin", t: "seg", v: MFINS, p: "fin.", l: "f.fin" }],
    poster: [{ k: "size", t: "sel", v: PSIZES, p: "psize.", l: "f.gsize" }, { k: "orient", t: "seg", v: ORIENTS, p: "orient.", l: "f.orient" },
      { k: "frame", t: "sel", v: FRAMES, p: "frame.", l: "f.frame" }, { k: "mat", t: "chk", l: "f.pmat", when: function (g) { return g.frame !== "none"; } },
      { k: "wall", t: "seg", v: WALLS, p: "wall.", l: "f.wall" }],
    card: [{ k: "ck", t: "seg", v: CKINDS, p: "ck.", l: "f.ck" }, { k: "size", t: "seg", v: CSIZES, p: "csize.", l: "f.gsize" },
      { k: "orient", t: "seg", v: ORIENTS, p: "orient.", l: "f.orient" }, { k: "env", t: "sel", v: ENVS, p: "env.", l: "f.env" }]
  };

  var A = {
    VERSION: "1.0.0", OZ: OZ, MCOLS: MCOLS, PSIZES: PSIZES, PMM: PMM, FRAMES: FRAMES, WALLS: WALLS, CSIZES: CSIZES, CMM: CMM, CKINDS: CKINDS, ENVS: ENVS,
    mugNorm: mugNorm, mugDims: mugDims, posterNorm: posterNorm, posterDims: posterDims, cardNorm: cardNorm, cardDims: cardDims
  };
  C.addGood("mug", { group: "home", slots: [], norm: mugNorm, dims: mugDims, sheets: function () { return ["mugwrap"]; }, template: mugTemplate,
    wrap: false, opts: OPTS.mug, noOpen: true, cam: { th: -24, ph: 14 }, shown: function () { return ["wrap"]; } });
  C.addGood("poster", { group: "home", slots: [], norm: posterNorm, dims: posterDims, sheets: function () { return ["poster"]; }, template: posterTemplate,
    wrap: false, opts: OPTS.poster, noOpen: true, cam: { th: -14, ph: 6 }, shown: function () { return ["front"]; } });
  C.addGood("card", { group: "home", slots: ["inside", "inside2"], norm: cardNorm, dims: cardDims, sheets: cardSheets, template: cardTemplate,
    wrap: false, opts: OPTS.card, noOpen: function (g) { return g.ck !== "folded"; }, openLbl: "f.openCard", place: "lean", shown: function (g) { return g.ck === "folded" ? ["front", "back", "inside", "inside2"] : ["front", "back"]; } });
  root.MockHome = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
