// ============================================================
// orOS Mockups — goods/media.js (v1.0.0)
// CD and DVD / Blu-ray: the pure part of the two products (no DOM,
// no three.js; Node-tested in tests/mockups.test.js). Registers
// "cd" and "dvd" with MockCore.addGood().
//   - norm(g): the product's own settings with safe defaults
//   - dims(g): the case, the disc, the printed parts in mm
//   - sheets(p) / template(p, sheet): the printer's sheets, in the
//     shape MockCore.template() gives for a book cover (so print.js
//     draws, saves and sends them to Atelier the same way); a disc
//     label is a round sheet (T.circle)
// Sizes are the common ones the pressing plants publish (jewel case
// booklet 120 × 120, tray card 151 × 118 with 6.5 mm spines, disc
// label 118 Ø on a 120 Ø disc with a 15 Ø hole, DVD sleeve 273 × 183
// with a 14 mm spine); the plant's own template always wins.
// The 3D part is goods/media3d.js.
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  if (!C) return;
  var r3 = C.round3;

  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function bit(v) { return v === 1 || v === true ? 1 : 0; }

  // ---------- The disc ----------
  var DISC = { d: 120, print: 118, hole: 15 };
  var HUBS = [15, 22, 36];                 // where the label's print starts (Ø mm)
  var DBASES = ["silver", "white", "black"];
  function discSheet(g) {
    var D = DISC.d;
    return {
      kind: "disc", W: D, H: D, bleed: 0, spine: 0, sheet: { w: D, h: D },
      parts: [{ k: "disc", a: "disc", x: 0, w: D }], folds: [], bar: null, warn: [], trims: [], punch: [],
      safe: [],
      circle: { c: D / 2, print: DISC.print, hub: g.hub, hole: DISC.hole, safeOut: DISC.print - 6, safeIn: g.hub + 6 }
    };
  }

  // A flat sheet of panels side by side (back, spine, front…).
  // parts: [[k, art slot, w, spine text?]]; bl: bleed; safe: mm.
  function sheet(kind, parts, H, bl, safe) {
    var x = 0, P = [], folds = [], sf = [];
    parts.forEach(function (q) { P.push({ k: q[0], a: q[1], x: r3(x), w: r3(q[2]), txt: q[3] ? 1 : 0 }); x += q[2]; });
    for (var i = 1; i < P.length; i++) folds.push({ x: P[i].x, k: "fold" });
    P.forEach(function (p) {
      if (p.txt || p.w < 20) return;
      if (p.w - 2 * safe > 1) sf.push({ k: p.k, x: r3(p.x + safe), y: r3(safe), w: r3(p.w - 2 * safe), h: r3(H - 2 * safe) });
    });
    var W = r3(x);
    return {
      kind: kind, W: W, H: r3(H), bleed: bl, spine: 0, sheet: { w: r3(W + 2 * bl), h: r3(H + 2 * bl) },
      parts: P, folds: folds, safe: sf, bar: null, warn: [], trims: [{ x: 0, w: W }], punch: []
    };
  }
  function bleedOf(p) { return p.art && p.art.bleed >= 0 ? p.art.bleed : 3; }
  function safeOf(p) { return Math.min(p.tpl ? p.tpl.safe : 3, 10); }

  // ---------- CD ----------
  var CD_PACKS = ["jewel", "slim", "digi", "sleeve"];
  var TRAYS = ["black", "clear", "white"];
  function cdNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return {
      pack: pick(g.pack, CD_PACKS, "jewel"),
      tray: pick(g.tray, TRAYS, "black"),
      disc: pick(g.disc, DBASES, "silver"),
      hub: pick(g.hub, HUBS, 22),
      beside: bit(g.beside)
    };
  }
  // w × h × d of the closed pack (mm), and its printed panels.
  function cdDims(g) {
    g = cdNorm(g);
    if (g.pack === "jewel") return { w: 142, h: 125, d: 10.4, lid: 1.6, booklet: 120, inlay: { w: 138, h: 118, spine: 6.5 } };
    if (g.pack === "slim") return { w: 142, h: 125, d: 5.2, lid: 1.2, booklet: 120, inlay: null };
    if (g.pack === "digi") return { w: 139.7, h: 125.4, d: 6.5, board: 1.2, spine: 6.5 };
    return { w: 125, h: 125, d: 4, board: 0.6 };
  }
  function cdSheets(p) {
    var k = p.g.pack;
    if (k === "jewel") return ["booklet", "inlay", "disc"];
    if (k === "slim") return ["booklet", "disc"];
    if (k === "digi") return ["digi", "digiIn", "disc"];
    return ["sleeve", "disc"];
  }
  function cdTemplate(p, s) {
    var g = p.g, d = cdDims(g), bl = bleedOf(p), sf = safeOf(p);
    if (s === "disc") return discSheet(g);
    if (s === "booklet") return sheet("booklet", [["inside", "inside", 120], ["front", "front", 120]], 120, bl, sf);
    if (s === "inlay") return sheet("inlay", [["spineL", "spine", 6.5, 1], ["back", "back", 138], ["spineR", "spine", 6.5, 1]], 118, bl, sf);
    if (s === "digi") return sheet("digi", [["back", "back", d.w], ["spine", "spine", d.spine, 1], ["front", "front", d.w]], d.h, bl, sf);
    if (s === "digiIn") return sheet("digiIn", [["inside", "inside", d.w], ["spineIn", "", d.spine], ["tray", "tray", d.w]], d.h, bl, sf);
    return sheet("sleeve", [["back", "back", d.w], ["front", "front", d.w]], d.h, bl, sf);
  }

  // ---------- DVD / Blu-ray ----------
  var FMTS = ["dvd", "bd"];
  var CASES = ["std", "slim"];
  var DCOLS = ["black", "clear", "blue"];
  function dvdNorm(g) {
    g = g && typeof g === "object" ? g : {};
    var fmt = pick(g.fmt, FMTS, "dvd");
    return {
      fmt: fmt,
      cs: pick(g.cs, CASES, "std"),
      col: pick(g.col, DCOLS, fmt === "bd" ? "blue" : "black"),
      disc: pick(g.disc, DBASES, "silver"),
      hub: pick(g.hub, HUBS, 22),
      beside: bit(g.beside)
    };
  }
  // The case (h × w × d) and its sleeve (panel w, spine, h), mm.
  function dvdDims(g) {
    g = dvdNorm(g);
    var bd = g.fmt === "bd", slim = g.cs === "slim";
    var d = bd ? (slim ? 8 : 12) : (slim ? 7 : 14);
    return { w: 135, h: bd ? 171.5 : 190, d: d, panel: bd ? 129 : 129.5, spine: bd ? (slim ? 8 : 12) : (slim ? 7 : 14), sh: bd ? 148 : 183 };
  }
  function dvdSheets() { return ["sleeve", "disc"]; }
  function dvdTemplate(p, s) {
    if (s === "disc") return discSheet(p.g);
    var d = dvdDims(p.g);
    return sheet("dvd", [["back", "back", d.panel], ["spine", "spine", d.spine, 1], ["front", "front", d.panel]], d.sh, bleedOf(p), safeOf(p));
  }

  var M = {
    VERSION: "1.0.0", DISC: DISC, HUBS: HUBS, DBASES: DBASES,
    CD_PACKS: CD_PACKS, TRAYS: TRAYS, FMTS: FMTS, CASES: CASES, DCOLS: DCOLS,
    cdNorm: cdNorm, cdDims: cdDims, dvdNorm: dvdNorm, dvdDims: dvdDims,
    // shared with the other product modules (goods/analog.js)
    sheet: sheet, bleedOf: bleedOf, safeOf: safeOf, pick: pick, bit: bit
  };
  C.addGood("cd", {
    group: "music", slots: ["disc", "inside", "tray"], norm: cdNorm, dims: cdDims,
    sheets: cdSheets, template: cdTemplate, wrap: false
  });
  C.addGood("dvd", {
    group: "music", slots: ["disc"], norm: dvdNorm, dims: dvdDims,
    sheets: dvdSheets, template: dvdTemplate, wrap: true
  });
  root.MockMedia = M;
  if (typeof module !== "undefined" && module.exports) module.exports = M;
})(typeof window !== "undefined" ? window : globalThis);
