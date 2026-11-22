// ============================================================
// orOS Mockups — goods/analog.js (v1.0.0)
// Cassette, VHS and vinyl: the pure part (no DOM, no three.js;
// Node-tested in tests/mockups.test.js). Registers "tape", "vhs" and
// "vinyl" with MockCore.addGood(); sheets in the shape of
// MockCore.template() (print.js draws them), round labels as
// T.circle. Sizes are the common published ones (J-card 101.6 mm
// high: front 65, spine 12.7, flap 15; cassette label 89 × 51; VHS
// slip sleeve 105 × 192 with a 27 mm spine; LP jacket 314 mm, inner
// sleeve 302, record 302 Ø with a 100 mm label; 7″ jacket 184, record
// 175 Ø, label 84); the plant's own template always wins.
// The 3D part is goods/analog3d.js.
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  var MM = root.MockMedia || (typeof require === "function" ? require("./media.js") : null);
  if (!C || !MM) return;
  var pick = MM.pick, bit = MM.bit, sheet = MM.sheet, bleedOf = MM.bleedOf, safeOf = MM.safeOf, r3 = C.round3;

  // A round label (record label): print Ø d, hole Ø hole.
  function roundSheet(kind, slot, d, hole) {
    return {
      kind: kind, W: d, H: d, bleed: 0, spine: 0, sheet: { w: d, h: d },
      parts: [{ k: slot, a: slot, x: 0, w: d }], folds: [], bar: null, warn: [], trims: [], punch: [], safe: [],
      circle: { c: d / 2, print: d, hub: hole, hole: hole, safeOut: r3(d - 6), safeIn: r3(hole + 6) }
    };
  }

  // ---------- Cassette ----------
  var TAPE_PACKS = ["norelco", "ocard", "none"];
  var SHELLS = ["clear", "white", "black", "smoke"];
  var JPANELS = [3, 4, 5];
  function tapeNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return {
      pack: pick(g.pack, TAPE_PACKS, "norelco"),
      shell: pick(g.shell, SHELLS, "clear"),
      jp: pick(g.jp, JPANELS, 3),
      beside: bit(g.beside)
    };
  }
  // The case stands like a book: w × h × d (mm).
  function tapeDims(g) {
    g = tapeNorm(g);
    return { w: 69.5, h: 110, d: 17, tape: { w: 100.4, h: 63.8, d: 12 }, label: { w: 89, h: 51 }, j: { front: 65, spine: 12.7, flap: 15, h: 101.6 } };
  }
  function tapeSheets(p) {
    var k = p.g.pack;
    return k === "norelco" ? ["jcard", "tlabel"] : k === "ocard" ? ["ocard", "tlabel"] : ["tlabel"];
  }
  function tapeTemplate(p, s) {
    var g = p.g, D = tapeDims(g), bl = bleedOf(p), sf = safeOf(p);
    if (s === "tlabel") return sheet("tlabel", [["sideA", "sideA", D.label.w], ["sideB", "sideB", D.label.w]], D.label.h, bl, sf);
    if (s === "ocard") return sheet("ocard", [["back", "back", 70], ["spine", "spine", 17.5, 1], ["front", "front", 70], ["side", "", 17.5]], 110.5, bl, sf);
    var parts = [["front", "front", D.j.front], ["spine", "spine", D.j.spine, 1], ["flap", "back", D.j.flap]];
    if (g.jp >= 4) parts.push(["in1", "inside", D.j.front]);
    if (g.jp >= 5) parts.push(["in2", "inside", D.j.front]);
    return sheet("jcard", parts, D.j.h, bl, sf);
  }

  // ---------- VHS ----------
  var VHS_PACKS = ["slip", "clam", "none"];
  var VCOLS = ["black", "white", "clear"];
  function vhsNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { pack: pick(g.pack, VHS_PACKS, "slip"), col: pick(g.col, VCOLS, "black"), beside: bit(g.beside) };
  }
  function vhsDims(g) {
    g = vhsNorm(g);
    var tape = { w: 187, h: 102, d: 25 };
    if (g.pack === "clam") return { w: 135, h: 205, d: 32, panel: 129, spine: 30, sh: 198, tape: tape };
    return { w: 105, h: 192, d: 27, panel: 105, spine: 27, sh: 192, tape: tape };
  }
  function vhsSheets(p) { return p.g.pack === "slip" ? ["vslip", "vface", "vspine"] : p.g.pack === "clam" ? ["vclam", "vface", "vspine"] : ["vface", "vspine"]; }
  function vhsTemplate(p, s) {
    var D = vhsDims(p.g), bl = bleedOf(p), sf = safeOf(p);
    if (s === "vface") return sheet("vface", [["face", "face", 78]], 46, bl, sf);
    if (s === "vspine") return sheet("vspine", [["tspine", "spine", 147]], 18, bl, Math.min(sf, 2));
    if (s === "vclam") return sheet("vclam", [["back", "back", D.panel], ["spine", "spine", D.spine, 1], ["front", "front", D.panel]], D.sh, bl, sf);
    // the slip sleeve: back, spine, front, the closed side and the glue flap
    return sheet("vslip", [["back", "back", D.panel], ["spine", "spine", D.spine, 1], ["front", "front", D.panel], ["side", "", D.spine], ["glue", "", 10]], D.sh, bl, sf);
  }

  // ---------- Vinyl ----------
  var VSIZES = ["lp", "7in"];
  var VJACKETS = ["single", "gatefold"];
  var VRCOLS = ["black", "clear", "red", "blue", "white", "marble"];
  var INNERS = ["white", "black", "printed"];
  function vinylNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return {
      size: pick(g.size, VSIZES, "lp"),
      jk: pick(g.jk, VJACKETS, "single"),
      rc: pick(g.rc, VRCOLS, "black"),
      inner: pick(g.inner, INNERS, "white"),
      big: bit(g.big),                 // a 7″ with the big (38 mm) hole
      beside: bit(g.beside)
    };
  }
  function vinylDims(g) {
    g = vinylNorm(g);
    if (g.size === "7in") return { w: 184, h: 184, d: g.jk === "gatefold" ? 4 : 2.5, spine: g.jk === "gatefold" ? 4 : 2.5, inner: 178, rec: 175, label: 84, hole: g.big ? 38.2 : 7.24, t: 1.4 };
    return { w: 314, h: 314, d: g.jk === "gatefold" ? 6 : 4, spine: g.jk === "gatefold" ? 6 : 4, inner: 302, rec: 302, label: 100, hole: 7.24, t: 1.8 };
  }
  function vinylSheets(p) {
    var o = [p.g.jk === "gatefold" ? "gatefold" : "jacket"];
    if (p.g.inner === "printed") o.push("inner");
    o.push("labelA", "labelB");
    return o;
  }
  function vinylTemplate(p, s) {
    var g = p.g, D = vinylDims(g), bl = bleedOf(p), sf = safeOf(p);
    if (s === "labelA") return roundSheet("labelA", "labelA", D.label, D.hole);
    if (s === "labelB") return roundSheet("labelB", "labelB", D.label, D.hole);
    if (s === "inner") return sheet("inner", [["innerB", "innerB", D.inner], ["innerF", "innerF", D.inner]], D.inner, bl, sf);
    if (s === "gatefold") return sheet("gatefold", [["back", "back", D.w], ["spine", "spine", D.spine, 1], ["front", "front", D.w]], D.h, bl, sf);
    return sheet("jacket", [["back", "back", D.w], ["spine", "spine", D.spine, 1], ["front", "front", D.w]], D.h, bl, sf);
  }

  var A = {
    VERSION: "1.0.0", TAPE_PACKS: TAPE_PACKS, SHELLS: SHELLS, JPANELS: JPANELS, VHS_PACKS: VHS_PACKS, VCOLS: VCOLS,
    VSIZES: VSIZES, VJACKETS: VJACKETS, VRCOLS: VRCOLS, INNERS: INNERS,
    tapeNorm: tapeNorm, tapeDims: tapeDims, vhsNorm: vhsNorm, vhsDims: vhsDims, vinylNorm: vinylNorm, vinylDims: vinylDims
  };
  C.addGood("tape", { group: "music", slots: ["inside", "sideA", "sideB"], norm: tapeNorm, dims: tapeDims, sheets: tapeSheets, template: tapeTemplate, wrap: false });
  C.addGood("vhs", { group: "music", slots: ["face"], norm: vhsNorm, dims: vhsDims, sheets: vhsSheets, template: vhsTemplate, wrap: false });
  C.addGood("vinyl", { group: "music", slots: ["labelA", "labelB", "innerF", "innerB"], norm: vinylNorm, dims: vinylDims, sheets: vinylSheets, template: vinylTemplate, wrap: true });
  root.MockAnalog = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
